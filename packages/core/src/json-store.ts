import fs from "node:fs";
import path from "node:path";
import { BlobNotFoundError, BlobPreconditionFailedError, del, get, head, put } from "@vercel/blob";
import Redis from "ioredis";

function repoRoot(): string {
  if (process.env.REALCLANKER_ROOT) return process.env.REALCLANKER_ROOT;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function localPath(name: string) {
  const dir = process.env.REALCLANKER_DATA
    ? process.env.REALCLANKER_DATA
    : process.env.VERCEL
      ? path.join("/tmp", "realclanker")
      : path.join(repoRoot(), ".data");
  fs.mkdirSync(dir, { recursive: true });
  return { file: path.join(dir, name), lock: path.join(dir, `.${name}.lock`) };
}

function redisUrl() {
  return process.env.REALCLANKER_REDIS_URL || process.env.realclanker_REDIS_URL || "";
}

function onRedis() {
  return Boolean(redisUrl());
}

function onBlob() {
  return Boolean(process.env.VERCEL && process.env.BLOB_READ_WRITE_TOKEN);
}

const cache = new Map<string, { at: number; raw: string }>();
const CACHE_MS = 1000;

let redisClient: Redis | null = null;

function redis() {
  if (!redisClient) {
    const url = redisUrl();
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 2,
      connectTimeout: 10_000,
      tls: url.startsWith("rediss://") ? {} : undefined,
    });
  }
  return redisClient;
}

function redisKey(name: string) {
  return `realclanker:${name}`;
}

function blobPath(name: string) {
  return `realclanker/${name}`;
}

async function readBlob<T>(name: string, fallback: T): Promise<T> {
  try {
    const downloaded = await get(blobPath(name), { access: "private", useCache: false });
    if (!downloaded || downloaded.statusCode !== 200 || !downloaded.stream) return structuredClone(fallback);
    return JSON.parse(await new Response(downloaded.stream).text()) as T;
  } catch (error) {
    if (error instanceof BlobNotFoundError) return structuredClone(fallback);
    throw error;
  }
}

function readLocal<T>(name: string, fallback: T): T {
  const { file } = localPath(name);
  if (!fs.existsSync(file)) return structuredClone(fallback);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return structuredClone(fallback);
  }
}

export async function deleteJson(name: string): Promise<void> {
  cache.delete(name);
  if (onRedis()) {
    await enqueueRedisWrite(async () => {
      cache.delete(name);
      await redis().del(redisKey(name));
    });
    return;
  }
  if (onBlob()) {
    try {
      await del(blobPath(name));
    } catch (error) {
      if (!(error instanceof BlobNotFoundError)) throw error;
    }
    return;
  }
  const { file } = localPath(name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export async function readJson<T>(name: string, fallback: T): Promise<T> {
  if (onRedis()) return readRedis(name, fallback);
  return onBlob() ? readBlob(name, fallback) : readLocal(name, fallback);
}

export async function withJson<T, R>(name: string, fallback: T, mutate: (value: T) => R): Promise<R> {
  if (onRedis()) return withRedis(name, fallback, mutate);
  if (onBlob()) return withBlob(name, fallback, mutate);
  return withLocal(name, fallback, mutate);
}

async function readRedis<T>(name: string, fallback: T): Promise<T> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_MS) return JSON.parse(hit.raw) as T;
  const raw = await redis().get(redisKey(name));
  if (!raw) return structuredClone(fallback);
  cache.set(name, { at: Date.now(), raw });
  return JSON.parse(raw) as T;
}

let redisWrites: Promise<unknown> = Promise.resolve();

function enqueueRedisWrite<T>(work: () => Promise<T>): Promise<T> {
  const run = redisWrites.then(work, work);
  redisWrites = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function withRedis<T, R>(name: string, fallback: T, mutate: (value: T) => R): Promise<R> {
  return enqueueRedisWrite(() => writeRedis(name, fallback, mutate));
}

async function writeRedis<T, R>(name: string, fallback: T, mutate: (value: T) => R): Promise<R> {
  const client = redis();
  const key = redisKey(name);
  for (let attempt = 0; attempt < 24; attempt++) {
    await client.watch(key);
    try {
      const raw = await client.get(key);
      const value = raw ? (JSON.parse(raw) as T) : structuredClone(fallback);
      const result = mutate(value);
      const next = JSON.stringify(value);
      const exec = await client.multi().set(key, next).exec();
      if (!exec) {
        await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
        continue;
      }
      cache.set(name, { at: Date.now(), raw: next });
      return result;
    } catch (error) {
      await client.unwatch();
      throw error;
    }
  }
  throw new Error(`Could not store ${name}.`);
}

function withLocal<T, R>(name: string, fallback: T, mutate: (value: T) => R): R {
  const { file, lock } = localPath(name);
  for (let attempt = 0; attempt < 400; attempt++) {
    try {
      fs.mkdirSync(lock);
    } catch {
      const end = Date.now() + 10;
      while (Date.now() < end) {
        /* another process is writing this file */
      }
      continue;
    }
    try {
      const value = readLocal(name, fallback);
      const result = mutate(value);
      fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
      return result;
    } finally {
      fs.rmSync(lock, { recursive: true, force: true });
    }
  }
  throw new Error(`Could not store ${name}.`);
}

function blobConflict(error: unknown): boolean {
  if (error instanceof BlobPreconditionFailedError) return true;
  const message = error instanceof Error ? error.message : "";
  return /conditional request|conflicting operation|precondition failed|etag mismatch/i.test(message);
}

async function withBlob<T, R>(name: string, fallback: T, mutate: (value: T) => R): Promise<R> {
  const pathname = blobPath(name);
  for (let attempt = 0; attempt < 24; attempt++) {
    let etag: string | undefined;
    let value = structuredClone(fallback);
    try {
      const meta = await head(pathname);
      etag = meta.etag;
      value = await readBlob(name, fallback);
    } catch (error) {
      if (!(error instanceof BlobNotFoundError)) throw error;
    }
    const result = mutate(value);
    try {
      await put(pathname, JSON.stringify(value), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 0,
        ...(etag ? { ifMatch: etag } : {}),
      });
      return result;
    } catch (error) {
      if (!blobConflict(error) || attempt === 23) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * attempt + Math.floor(Math.random() * 80)));
    }
  }
  throw new Error(`Could not store ${name}.`);
}

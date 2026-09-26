import fs from "node:fs";
import path from "node:path";
import type { State } from "./types";

const EMPTY: State = { concerts: [], agents: [], grants: [], attempts: [] };

export function repoRoot(): string {
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

function locations() {
  const dir = process.env.REALCLANKER_DATA || path.join(repoRoot(), ".data");
  fs.mkdirSync(dir, { recursive: true });
  return {
    file: path.join(dir, "state.json"),
    lock: path.join(dir, ".lock"),
  };
}

function readFile(file: string): State {
  if (!fs.existsSync(file)) return structuredClone(EMPTY);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as State;
    return {
      concerts: parsed.concerts ?? [],
      agents: parsed.agents ?? [],
      grants: parsed.grants ?? [],
      attempts: parsed.attempts ?? [],
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

function sleep(ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* serialize cross-process writers */
  }
}

export function readState(): State {
  return readFile(locations().file);
}

export function withState<T>(mutate: (state: State) => T): T {
  const { file, lock } = locations();
  for (let attempt = 0; attempt < 400; attempt++) {
    try {
      fs.mkdirSync(lock);
    } catch {
      sleep(10);
      continue;
    }
    try {
      const state = readFile(file);
      const result = mutate(state);
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
      return result;
    } finally {
      fs.rmSync(lock, { recursive: true, force: true });
    }
  }
  throw new Error("Could not lock RealClanker state");
}

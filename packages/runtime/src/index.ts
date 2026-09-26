import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { config } from "dotenv";
import {
  deleteBytes,
  deleteJson,
  getBytes,
  putBytes,
  readJson,
  readState,
  repoRoot,
  withJson,
  withState,
  type Agent,
  type Attempt,
  type Concert,
  type Grant,
  type State,
} from "@realclanker/core";
import { decide } from "@realclanker/core";
import {
  avatarDataUri,
  ensureAgentEvmWallet,
  ethBalance,
  grantRecordKey,
  mintEns,
  resolveAgent,
  ticketRecordKey,
  writeTextRecord,
} from "@realclanker/ens";
import { createPool, ensureAgentWallet, fundAgentWallet, fundFromFaucet, settleTicket, suiBalance, suiConfigured, ticketHash, TICKET_GAS_RESERVE, waitForBalance } from "@realclanker/settlement";
import { devMode, verifyIdToken } from "@realclanker/worldid";

config({ path: path.join(repoRoot(), ".env") });

const nid = (prefix: string) => `${prefix}_${randomBytes(6).toString("hex")}`;

export async function snapshot(): Promise<State & { devMode: boolean; hosted: boolean; mcpUrl: string }> {
  const mcpUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL}/api/mcp`
    : process.env.MCP_URL || "http://127.0.0.1:8787/mcp";
  return { ...(await readState()), devMode: devMode(), hosted: Boolean(process.env.VERCEL), mcpUrl };
}

export async function createConcert(input: {
  name: string;
  venue: string;
  supply: number;
  priceMist: string;
  maxPerHuman: number;
  saleStartsAt?: number;
  saleEndsAt: number;
}): Promise<Concert> {
  const createdAt = Date.now();
  const concert: Concert = {
    id: nid("show"),
    name: input.name.trim(),
    venue: input.venue.trim(),
    supply: input.supply,
    sold: 0,
    priceMist: input.priceMist,
    maxPerHuman: input.maxPerHuman,
    saleStartsAt: input.saleStartsAt ?? createdAt,
    saleEndsAt: input.saleEndsAt,
    createdAt,
  };
  if (!concert.name || concert.supply < 1 || concert.maxPerHuman < 1) {
    throw new Error("Concert needs a name, supply, and a per-human cap.");
  }
  if (concert.saleEndsAt <= (concert.saleStartsAt ?? createdAt)) {
    throw new Error("Sale end must be after the sale start.");
  }
  await withState((state) => {
    state.concerts.unshift(concert);
  });
  const created = await createPool({
    supply: concert.supply,
    priceMist: BigInt(concert.priceMist),
  });
  if (created.poolId) concert.suiPoolId = created.poolId;
  if (created.error) concert.suiPoolError = created.error;
  if (created.poolId || created.error) {
    await withState((state) => {
      const found = state.concerts.find((item) => item.id === concert.id);
      if (!found) return;
      if (created.poolId) found.suiPoolId = created.poolId;
      if (created.error) found.suiPoolError = created.error;
    });
  }
  return concert;
}

const ART_LIMIT = 4_000_000;
export const BACKDROP_CHUNK = 3_000_000;
export const BACKDROP_LIMIT = 20_000_000;

type BackdropParts = {
  contentType: string;
  totalBytes: number;
  chunkSize: number;
  received: number[];
};

const EMPTY_PARTS: BackdropParts = { contentType: "", totalBytes: 0, chunkSize: BACKDROP_CHUNK, received: [] };

function backdropPartName(concertId: string, part: number) {
  return `backdrop-${concertId}.part.${part}`;
}

export async function setConcertArt(
  concertId: string,
  file: { contentType: string; bytes: Uint8Array },
): Promise<Concert> {
  const contentType = file.contentType.toLowerCase();
  const kind = contentType.startsWith("image/") ? "image" : contentType.startsWith("video/") ? "video" : null;
  if (!kind) throw new Error("Art must be a picture or a video.");
  if (file.bytes.byteLength < 1 || file.bytes.byteLength > ART_LIMIT) {
    throw new Error("Art must be a file under 4 MB.");
  }
  const current = await readState();
  const existing = current.concerts.find((item) => item.id === concertId);
  if (!existing) throw new Error("Concert not found.");
  const updatedAt = Date.now();
  await withJson(`art-${concertId}.json`, { contentType: "", data: "" }, (art) => {
    art.contentType = contentType;
    art.data = Buffer.from(file.bytes).toString("base64");
  });
  await withState((state) => {
    const concert = state.concerts.find((item) => item.id === concertId);
    if (!concert) return;
    concert.art = { kind, contentType, updatedAt };
  });
  return { ...existing, art: { kind, contentType, updatedAt } };
}

export async function readConcertArt(concertId: string): Promise<{ contentType: string; bytes: Buffer } | null> {
  const art = await readJson(`art-${concertId}.json`, { contentType: "", data: "" });
  if (!art.data || !art.contentType) return null;
  return { contentType: art.contentType, bytes: Buffer.from(art.data, "base64") };
}

export async function saveBackdropPart(
  concertId: string,
  file: { contentType: string; bytes: Uint8Array; part: number; parts: number; totalBytes: number },
): Promise<Concert> {
  const contentType = file.contentType.toLowerCase();
  if (!contentType.startsWith("video/")) throw new Error("The background must be a video.");
  if (file.totalBytes < 1 || file.totalBytes > BACKDROP_LIMIT) {
    throw new Error("The video must be an mp4 or webm under 20 MB.");
  }
  if (!Number.isInteger(file.parts) || file.parts < 1 || file.parts > 8) {
    throw new Error("Could not store the video.");
  }
  if (!Number.isInteger(file.part) || file.part < 0 || file.part >= file.parts) {
    throw new Error("Could not store the video.");
  }
  const expected = file.part === file.parts - 1 ? file.totalBytes - file.part * BACKDROP_CHUNK : BACKDROP_CHUNK;
  if (expected < 1 || file.bytes.byteLength !== expected) throw new Error("The upload was incomplete. Try again.");
  const current = await readState();
  const existing = current.concerts.find((item) => item.id === concertId);
  if (!existing) throw new Error("Concert not found.");
  await putBytes(backdropPartName(concertId, file.part), Buffer.from(file.bytes));
  const complete = await withJson(`backdrop-${concertId}.parts.json`, EMPTY_PARTS, (stored) => {
    if (
      file.part === 0 ||
      stored.totalBytes !== file.totalBytes ||
      stored.contentType !== contentType ||
      stored.received.length !== file.parts
    ) {
      stored.contentType = contentType;
      stored.totalBytes = file.totalBytes;
      stored.chunkSize = BACKDROP_CHUNK;
      stored.received = Array(file.parts).fill(0);
    }
    stored.received[file.part] = file.bytes.byteLength;
    return stored.received.every((size) => size > 0);
  });
  if (!complete) return existing;
  const updatedAt = Date.now();
  await withState((state) => {
    const concert = state.concerts.find((item) => item.id === concertId);
    if (!concert) return;
    concert.backdrop = { contentType, updatedAt };
  });
  await deleteJson(`backdrop-${concertId}.json`);
  for (let index = file.parts; index < 8; index++) await deleteBytes(backdropPartName(concertId, index));
  return { ...existing, backdrop: { contentType, updatedAt } };
}

export async function deleteConcert(concertId: string): Promise<void> {
  const current = await readState();
  if (!current.concerts.some((item) => item.id === concertId)) throw new Error("Concert not found.");
  await withState((state) => {
    state.concerts = state.concerts.filter((item) => item.id !== concertId);
    state.grants = state.grants.filter((item) => item.concertId !== concertId);
    state.attempts = state.attempts.filter((item) => item.concertId !== concertId);
  });
  await deleteJson(`art-${concertId}.json`);
  await deleteJson(`backdrop-${concertId}.json`);
  await deleteJson(`backdrop-${concertId}.parts.json`);
  for (let index = 0; index < 8; index++) await deleteBytes(backdropPartName(concertId, index));
}

export async function backdropSize(concertId: string): Promise<{ contentType: string; total: number } | null> {
  const parts = await readJson(`backdrop-${concertId}.parts.json`, EMPTY_PARTS);
  if (parts.totalBytes > 0 && parts.contentType && parts.received.length > 0 && parts.received.every((size) => size > 0)) {
    return { contentType: parts.contentType, total: parts.totalBytes };
  }
  const stored = await readJson(`backdrop-${concertId}.json`, { contentType: "", data: "" });
  if (!stored.data || !stored.contentType) return null;
  const padding = stored.data.endsWith("==") ? 2 : stored.data.endsWith("=") ? 1 : 0;
  return { contentType: stored.contentType, total: Math.floor((stored.data.length * 3) / 4) - padding };
}

export async function readBackdropRange(
  concertId: string,
  start: number,
  end: number,
): Promise<{ contentType: string; total: number; bytes: Buffer } | null> {
  const parts = await readJson(`backdrop-${concertId}.parts.json`, EMPTY_PARTS);
  if (parts.totalBytes > 0 && parts.contentType && parts.received.length > 0 && parts.received.every((size) => size > 0)) {
    if (start < 0 || end < start || start >= parts.totalBytes) return null;
    const last = Math.min(end, parts.totalBytes - 1);
    const pieces: Buffer[] = [];
    const firstIndex = Math.floor(start / BACKDROP_CHUNK);
    const lastIndex = Math.floor(last / BACKDROP_CHUNK);
    for (let index = firstIndex; index <= lastIndex; index++) {
      const chunk = await getBytes(backdropPartName(concertId, index));
      if (!chunk) return null;
      const origin = index * BACKDROP_CHUNK;
      const from = Math.max(start, origin) - origin;
      const to = Math.min(last, origin + chunk.length - 1) - origin;
      pieces.push(chunk.subarray(from, to + 1));
    }
    return { contentType: parts.contentType, total: parts.totalBytes, bytes: Buffer.concat(pieces) };
  }
  const stored = await readJson(`backdrop-${concertId}.json`, { contentType: "", data: "" });
  if (!stored.data || !stored.contentType) return null;
  const bytes = Buffer.from(stored.data, "base64");
  if (start < 0 || end < start || start >= bytes.length) return null;
  const last = Math.min(end, bytes.length - 1);
  return { contentType: stored.contentType, total: bytes.length, bytes: bytes.subarray(start, last + 1) };
}

export async function registerAgent(
  ensName: string,
  options?: { mint?: boolean; fund?: boolean },
): Promise<Agent & { minted: boolean; balanceMist?: string; fundingSource?: string; fundingError?: string }> {
  const name = ensName.trim().toLowerCase();
  if (!name.endsWith(".eth")) throw new Error("Agent identity must be an ENS name.");
  const profile =
    name.endsWith(".realclanker.eth") && process.env.ENS_RESOLVE_SYNTHETIC !== "true"
      ? { avatarUrl: avatarDataUri(name), address: undefined }
      : await resolveAgent(name);
  const evm = await ensureAgentEvmWallet(name);
  const wallet = await ensureAgentWallet(name);
  const mintedName = options?.mint ? await mintEns(name, evm.address) : undefined;
  const agent = await withState((state) => {
    const existing = state.agents.find((agent) => agent.ensName === name);
    const minted = !existing;
    const address = mintedName?.owner ?? profile.address ?? evm.address;
    const ensMint = mintedName
      ? mintedName.minted
        ? "minted"
        : mintedName.kind === "owned"
          ? "owned"
          : mintedName.error
            ? "failed"
            : "skipped"
      : undefined;
    if (existing) {
      existing.avatarUrl = profile.avatarUrl;
      existing.address = address;
      existing.evmAddress = evm.address;
      existing.suiAddress = wallet.suiAddress;
      if (ensMint) existing.ensMint = ensMint;
      if (mintedName?.txHash) existing.ensMintTx = mintedName.txHash;
      if (mintedName) existing.ensMintError = mintedName.error;
      return { ...existing, minted };
    }
    const agent: Agent = {
      ensName: name,
      address,
      evmAddress: evm.address,
      suiAddress: wallet.suiAddress,
      avatarUrl: profile.avatarUrl,
      records: {},
      chainWrite: "skipped",
      ensMint,
      ensMintTx: mintedName?.txHash,
      ensMintError: mintedName?.error,
      createdAt: Date.now(),
    };
    state.agents.push(agent);
    return { ...agent, minted };
  });
  if (options?.fund === false) return agent;
  const funded = await fundAgent(name);
  return {
    ...agent,
    suiAddress: funded.suiAddress,
    balanceMist: funded.balanceMist,
    fundingSource: funded.source,
    fundingError: funded.error,
  };
}

export async function fundAgent(ensName: string, minimumMist = 200_000_000n): Promise<{
  ensName: string;
  suiAddress: string;
  balanceMist: string;
  source: "faucet" | "treasury" | "already-funded";
  error?: string;
}> {
  const name = ensName.trim().toLowerCase();
  if (!name.endsWith(".eth")) throw new Error("Agent identity must be an ENS name.");
  const wallet = await ensureAgentWallet(name);
  await withState((state) => {
    const agent = state.agents.find((item) => item.ensName === name);
    if (agent) agent.suiAddress = wallet.suiAddress;
  });
  const before = (await suiBalance(wallet.suiAddress)) ?? 0n;
  if (before >= minimumMist) {
    return { ensName: name, suiAddress: wallet.suiAddress, balanceMist: before.toString(), source: "already-funded" };
  }
  const faucet = before > 0n ? { ok: false as const, error: undefined } : await fundFromFaucet(wallet.suiAddress);
  const afterFaucet = faucet.ok ? await waitForBalance(wallet.suiAddress, minimumMist) : before;
  if ((afterFaucet ?? 0n) >= minimumMist) {
    return {
      ensName: name,
      suiAddress: wallet.suiAddress,
      balanceMist: (afterFaucet ?? 0n).toString(),
      source: "faucet",
    };
  }
  const short = minimumMist - (afterFaucet ?? 0n);
  const topped = await fundAgentWallet(wallet.suiAddress, short);
  if (topped.error) {
    return {
      ensName: name,
      suiAddress: wallet.suiAddress,
      balanceMist: (afterFaucet ?? before).toString(),
      source: "faucet",
      error: faucet.error || topped.error,
    };
  }
  const afterTreasury = (await waitForBalance(wallet.suiAddress, minimumMist)) ?? afterFaucet ?? 0n;
  return {
    ensName: name,
    suiAddress: wallet.suiAddress,
    balanceMist: afterTreasury.toString(),
    source: "treasury",
    error: afterTreasury > 0n ? undefined : topped.error,
  };
}

export async function agentWallet(ensName: string): Promise<{
  ensName: string;
  suiAddress: string;
  balanceMist: string | null;
  evmAddress: string;
  ethBalanceWei: string | null;
}> {
  const name = ensName.trim().toLowerCase();
  if (!name.endsWith(".eth")) throw new Error("Agent identity must be an ENS name.");
  const evm = await ensureAgentEvmWallet(name);
  const wallet = await ensureAgentWallet(name);
  await withState((state) => {
    const agent = state.agents.find((item) => item.ensName === name);
    if (!agent) return;
    agent.suiAddress = wallet.suiAddress;
    agent.evmAddress = evm.address;
  });
  const balance = await suiBalance(wallet.suiAddress);
  const eth = await ethBalance(evm.address);
  return {
    ensName: name,
    suiAddress: wallet.suiAddress,
    balanceMist: balance === null ? null : balance.toString(),
    evmAddress: evm.address,
    ethBalanceWei: eth === null ? null : eth.toString(),
  };
}

export async function issueGrant(input: {
  ensName: string;
  concertId: string;
  maxTickets: number;
  expiresAt?: number;
  idToken?: string;
  devSubject?: string;
  publish?: boolean;
  verified?: { sub: string; issuer: string; idToken?: string; claims?: Grant["claims"] };
}): Promise<Grant> {
  const ensName = input.ensName.trim().toLowerCase();
  let worldIdSub: string;
  let issuer: string;
  let source: Grant["source"];
  let idToken = input.idToken;
  let claims = input.verified?.claims;
  if (input.verified) {
    worldIdSub = input.verified.sub;
    issuer = input.verified.issuer;
    source = "oidc";
    idToken = input.verified.idToken ?? idToken;
  } else if (input.idToken) {
    const verified = await verifyIdToken(input.idToken);
    worldIdSub = verified.sub;
    issuer = verified.issuer;
    claims = verified.claims;
    source = "oidc";
  } else if (devMode()) {
    worldIdSub =
      input.devSubject ?? `sandbox:${createHash("sha256").update(ensName).digest("hex").slice(0, 32)}`;
    issuer = "https://sandbox.auth.world.org";
    source = "dev";
  } else {
    throw new Error("A verified World ID token is required.");
  }

  const grant: Grant = {
    id: nid("grant"),
    worldIdSub,
    issuer,
    ensName,
    concertId: input.concertId,
    permission: "ticket.buy",
    maxTickets: input.maxTickets,
    expiresAt: input.expiresAt ?? Date.now() + 15 * 60 * 1000,
    issuedAt: Date.now(),
    source,
    idToken: source === "oidc" ? idToken : undefined,
    claims: source === "oidc" ? claims : undefined,
  };

  await withState((state) => {
    if (!state.concerts.some((concert) => concert.id === input.concertId)) {
      throw new Error("Concert not found.");
    }
    if (!state.agents.some((agent) => agent.ensName === ensName)) {
      throw new Error("Register the ENS agent before delegating.");
    }
    state.grants.push(grant);
    const agent = state.agents.find((item) => item.ensName === ensName);
    if (agent) {
      agent.records[grantRecordKey(input.concertId)] = JSON.stringify({
        worldIdSub,
        permission: grant.permission,
        maxTickets: grant.maxTickets,
        expiresAt: grant.expiresAt,
      });
    }
  });

  if (input.publish !== false) await publishIdentity(ensName, input.concertId);
  return grant;
}

export async function publishIdentity(
  ensName: string,
  concertId: string,
  options?: { pointAddress?: boolean },
): Promise<void> {
  const name = ensName.trim().toLowerCase();
  const current = await readState();
  const grant = [...current.grants].reverse().find((item) => item.ensName === name && item.concertId === concertId);
  if (!grant) return;
  const evm = await ensureAgentEvmWallet(name);
  const minted = await mintEns(name, evm.address, options);
  const record = JSON.stringify({
    approved: true,
    sub: grant.worldIdSub,
    issuer: grant.issuer,
    source: grant.source,
    permission: grant.permission,
    concertId,
    maxTickets: grant.maxTickets,
    expiresAt: grant.expiresAt,
  });
  const worldWrite = await writeTextRecord({
    ensName: name,
    key: "realclanker.worldid",
    value: record,
  });
  await withState((state) => {
    const agent = state.agents.find((item) => item.ensName === name);
    if (!agent) return;
    agent.records[grantRecordKey(concertId)] = record;
    agent.records["realclanker.worldid"] = record;
    agent.chainWrite = worldWrite.wrote ? "written" : "failed";
    agent.chainWriteError = worldWrite.error;
    agent.ensRecordTx = worldWrite.txHash;
    if (minted.txHash) agent.ensMintTx = minted.txHash;
    agent.ensMint = minted.minted ? "minted" : minted.kind === "owned" ? "owned" : minted.error ? "failed" : agent.ensMint;
    if (minted.error) agent.ensMintError = minted.error;
  });
}

function suiExplorerAccount(address: string) {
  const network = process.env.SUI_NETWORK || "devnet";
  return `https://suiscan.xyz/${network}/account/${address}`;
}

function suiExplorerObject(objectId: string) {
  const network = process.env.SUI_NETWORK || "devnet";
  return `https://suiscan.xyz/${network}/object/${objectId}`;
}

function realSuiObject(objectId?: string) {
  return Boolean(objectId && !objectId.startsWith("0xsim"));
}

function purchaseDescription(attempts: Attempt[]) {
  return attempts
    .map((item) => {
      const identity = item.worldIdSub ? `World ID ${item.worldIdSub} approved` : "World ID approved";
      const link = item.suiAddress
        ? ` ${suiExplorerAccount(item.suiAddress)}`
        : realSuiObject(item.suiObjectId)
          ? ` ${suiExplorerObject(item.suiObjectId!)}`
          : "";
      return `${identity}. Ticket ${item.ticketHash}.${link}`;
    })
    .join(" ");
}

export async function settleRecordedPurchase(ensName: string, concertId: string): Promise<{ objectId?: string; error?: string }> {
  const name = ensName.trim().toLowerCase();
  const current = await readState();
  const attempt = current.attempts.find(
    (item) => item.ensName === name && item.concertId === concertId && item.outcome === "PURCHASE_COMPLETE" && item.ticketHash,
  );
  const concert = current.concerts.find((item) => item.id === concertId);
  if (!attempt?.ticketHash || !attempt.worldIdSub || !concert) return { error: "Purchase not found." };
  if (realSuiObject(attempt.suiObjectId)) return { objectId: attempt.suiObjectId };
  try {
  let poolId = concert.suiPoolId;
  if (!poolId && suiConfigured()) {
    const created = await createPool({ supply: concert.supply, priceMist: BigInt(concert.priceMist) });
    poolId = created.poolId;
    if (poolId) {
      await withState((state) => {
        const found = state.concerts.find((item) => item.id === concertId);
        if (found) found.suiPoolId = poolId;
      });
    }
  }
  const wallet = await ensureAgentWallet(name);
  const need = BigInt(concert.priceMist) + TICKET_GAS_RESERVE;
  const balance = (await suiBalance(wallet.suiAddress)) ?? 0n;
  if (balance < need) await fundAgent(name, need);
  const settled = await settleTicket({
    poolId,
    concertId,
    ensName: name,
    worldIdSub: attempt.worldIdSub,
    priceMist: BigInt(concert.priceMist),
    hash: attempt.ticketHash,
    payerSecret: wallet.secretKey,
  });
  if (!realSuiObject(settled.objectId)) {
    const error = settled.error || "Sui did not mint a ticket.";
    await withState((state) => {
      revertUnsettled(state, attempt.id, error);
    });
    return { error };
  }
  await withState((state) => {
    const found = state.attempts.find((item) => item.id === attempt.id);
    if (!found) return;
    found.settlement = "sui";
    found.suiObjectId = settled.objectId;
    found.settlementError = undefined;
  });
  return { objectId: settled.objectId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sui settlement failed.";
    await withState((state) => {
      revertUnsettled(state, attempt.id, message);
    });
    return { error: message };
  }
}

function revertUnsettled(state: State, attemptId: string, error: string) {
  const found = state.attempts.find((item) => item.id === attemptId);
  if (!found || found.outcome !== "PURCHASE_COMPLETE" || realSuiObject(found.suiObjectId)) return;
  const concert = state.concerts.find((item) => item.id === found.concertId);
  if (concert && concert.sold > 0) concert.sold -= 1;
  found.outcome = "PURCHASE_DENIED";
  found.reason = error;
  found.settlement = "none";
  found.settlementError = error;
  found.suiObjectId = undefined;
  found.ticketHash = undefined;
}

export async function publishBuyer(
  ensName: string,
  concertId: string,
  options?: { pointAddress?: boolean },
): Promise<void> {
  const name = ensName.trim().toLowerCase();
  await publishIdentity(name, concertId, options);
  const current = await readState();
  const attempt = current.attempts.find(
    (item) => item.ensName === name && item.concertId === concertId && item.outcome === "PURCHASE_COMPLETE" && item.ticketHash,
  );
  if (!attempt?.ticketHash) return;
  const ticket = JSON.stringify({
    ticketHash: attempt.ticketHash,
    concertId,
    worldIdSub: attempt.worldIdSub,
    settlement: attempt.settlement,
    ...(attempt.suiObjectId && !attempt.suiObjectId.startsWith("0xsim") ? { suiObjectId: attempt.suiObjectId } : {}),
  });
  const ticketWrite = await writeTextRecord({
    ensName: name,
    key: ticketRecordKey(concertId),
    value: ticket,
  });
  const purchases = current.attempts.filter(
    (item) => item.ensName === name && item.outcome === "PURCHASE_COMPLETE" && item.ticketHash && realSuiObject(item.suiObjectId),
  );
  const description = purchaseDescription(purchases);
  const descriptionWrite = description
    ? await writeTextRecord({ ensName: name, key: "description", value: description })
    : undefined;
  await withState((state) => {
    const agent = state.agents.find((item) => item.ensName === name);
    if (!agent) return;
    agent.records[ticketRecordKey(concertId)] = ticket;
    if (description) agent.records.description = description;
    if (!ticketWrite.wrote || (descriptionWrite && !descriptionWrite.wrote)) {
      agent.chainWrite = "failed";
      agent.chainWriteError = ticketWrite.error || descriptionWrite?.error || agent.chainWriteError;
      return;
    }
    agent.chainWrite = "written";
    agent.ensRecordTx = descriptionWrite?.txHash || ticketWrite.txHash || agent.ensRecordTx;
    agent.chainWriteError = undefined;
  });
}

export async function buyTicket(
  ensName: string,
  concertId: string,
  options?: { chain?: boolean; publish?: boolean },
): Promise<Attempt> {
  const name = ensName.trim().toLowerCase();
  const now = Date.now();
  const wallet = await ensureAgentWallet(name);
  const reserved = await withState((state) => {
    const concert = state.concerts.find((item) => item.id === concertId);
    const agent = state.agents.find((item) => item.ensName === name);
    if (agent) agent.suiAddress = wallet.suiAddress;
    const decision = decide({
      now,
      concertId,
      concert,
      grantsForAgent: state.grants.filter((grant) => grant.ensName === name),
      completedByHuman: (worldIdSub) =>
        state.attempts.filter(
          (attempt) =>
            attempt.outcome === "PURCHASE_COMPLETE" &&
            attempt.concertId === concertId &&
            attempt.worldIdSub === worldIdSub,
        ).length,
    });

    const attempt: Attempt = {
      id: nid("try"),
      ensName: name,
      avatarUrl: agent?.avatarUrl ?? "",
      concertId,
      worldIdSub: decision.worldIdSub,
      outcome: decision.outcome,
      reason: decision.reason,
      settlement: "none",
      suiAddress: wallet.suiAddress,
      at: now,
    };

    if (decision.outcome === "PURCHASE_COMPLETE" && concert && decision.worldIdSub) {
      concert.sold += 1;
      const hash = ticketHash({
        concertId,
        worldIdSub: decision.worldIdSub,
        ensName: name,
        serial: concert.sold,
      });
      attempt.ticketHash = hash;
      attempt.ensRecordKey = ticketRecordKey(concertId);
      attempt.settlement = "pending";
    }

    state.attempts.unshift(attempt);
    return {
      attempt,
      poolId: concert?.suiPoolId,
      priceMist: concert?.priceMist ?? "0",
    };
  });

  if (reserved.attempt.outcome !== "PURCHASE_COMPLETE" || !reserved.attempt.ticketHash || !reserved.attempt.worldIdSub) {
    return reserved.attempt;
  }
  if (options?.chain === false) return reserved.attempt;

  const settled = await settleRecordedPurchase(name, concertId);
  if (!settled.objectId) {
    reserved.attempt.outcome = "PURCHASE_DENIED";
    reserved.attempt.reason = settled.error || "Sui did not mint a ticket.";
    reserved.attempt.settlement = "none";
    reserved.attempt.settlementError = settled.error;
    reserved.attempt.suiObjectId = undefined;
    reserved.attempt.ticketHash = undefined;
    return reserved.attempt;
  }
  reserved.attempt.settlement = "sui";
  reserved.attempt.suiObjectId = settled.objectId;
  reserved.attempt.settlementError = undefined;
  if (options?.publish !== false) await publishBuyer(name, concertId);
  return reserved.attempt;
}

export function devAuthorized(): boolean {
  return devMode();
}

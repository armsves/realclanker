import { randomBytes } from "node:crypto";
import path from "node:path";
import { config } from "dotenv";
import {
  readState,
  repoRoot,
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

export async function registerAgent(
  ensName: string,
  options?: { mint?: boolean },
): Promise<Agent & { minted: boolean }> {
  const name = ensName.trim().toLowerCase();
  if (!name.endsWith(".eth")) throw new Error("Agent identity must be an ENS name.");
  const profile =
    name.endsWith(".realclanker.eth") && process.env.ENS_RESOLVE_SYNTHETIC !== "true"
      ? { avatarUrl: avatarDataUri(name), address: undefined }
      : await resolveAgent(name);
  const evm = await ensureAgentEvmWallet(name);
  const wallet = await ensureAgentWallet(name);
  const mintedName = options?.mint ? await mintEns(name, evm.address) : undefined;
  return await withState((state) => {
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
}

export async function fundAgent(ensName: string): Promise<{
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
  if (before > 0n) {
    return { ensName: name, suiAddress: wallet.suiAddress, balanceMist: before.toString(), source: "already-funded" };
  }
  const faucet = await fundFromFaucet(wallet.suiAddress);
  const afterFaucet = faucet.ok ? await waitForBalance(wallet.suiAddress, 1n) : before;
  if ((afterFaucet ?? 0n) > 0n) {
    return {
      ensName: name,
      suiAddress: wallet.suiAddress,
      balanceMist: (afterFaucet ?? 0n).toString(),
      source: "faucet",
    };
  }
  const topped = await fundAgentWallet(wallet.suiAddress, 200_000_000n);
  if (topped.error) {
    return {
      ensName: name,
      suiAddress: wallet.suiAddress,
      balanceMist: "0",
      source: "faucet",
      error: faucet.error || topped.error,
    };
  }
  const afterTreasury = (await waitForBalance(wallet.suiAddress, 1n)) ?? 0n;
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
  expiresAt: number;
  idToken?: string;
  devSubject?: string;
  verified?: { sub: string; issuer: string };
}): Promise<Grant> {
  const ensName = input.ensName.trim().toLowerCase();
  let worldIdSub: string;
  let issuer: string;
  let source: Grant["source"];
  if (input.verified) {
    worldIdSub = input.verified.sub;
    issuer = input.verified.issuer;
    source = "oidc";
  } else if (input.idToken) {
    const verified = await verifyIdToken(input.idToken);
    worldIdSub = verified.sub;
    issuer = verified.issuer;
    source = "oidc";
  } else if (devMode() && input.devSubject) {
    worldIdSub = input.devSubject;
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
    expiresAt: input.expiresAt,
    issuedAt: Date.now(),
    source,
  };

  await withState((state) => {
    if (!state.concerts.some((concert) => concert.id === input.concertId) && source === "oidc") {
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

  void writeTextRecord({
    ensName,
    key: grantRecordKey(input.concertId),
    value: JSON.stringify({
      sub: worldIdSub,
      permission: "ticket.buy",
      maxTickets: grant.maxTickets,
      expiresAt: grant.expiresAt,
    }),
  }).then(async (result) => {
    await withState((state) => {
      const agent = state.agents.find((item) => item.ensName === ensName);
      if (!agent) return;
      agent.chainWrite = result.wrote ? "written" : agent.chainWrite;
    });
  });

  return grant;
}

export async function buyTicket(ensName: string, concertId: string): Promise<Attempt> {
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
      attempt.settlement = "simulated";
      attempt.suiObjectId = `0xsim${hash.slice(0, 16)}`;
      if (agent) agent.records[ticketRecordKey(concertId)] = hash;
    }

    state.attempts.unshift(attempt);
    return {
      attempt,
      poolId: concert?.suiPoolId,
      priceMist: concert?.priceMist ?? "0",
    };
  });

  if (reserved.attempt.outcome === "PURCHASE_COMPLETE" && reserved.attempt.ticketHash && reserved.attempt.worldIdSub) {
    let fundingError: string | undefined;
    if (suiConfigured() && reserved.poolId) {
      const need = BigInt(reserved.priceMist) + TICKET_GAS_RESERVE;
      const balance = (await suiBalance(wallet.suiAddress)) ?? 0n;
      if (balance < need) {
        const funded = await fundAgentWallet(wallet.suiAddress, need - balance);
        fundingError = funded.error;
      }
    }
    const settled = fundingError
      ? {
          mode: "simulated" as const,
          ticketHash: reserved.attempt.ticketHash,
          objectId: `0xsim${reserved.attempt.ticketHash.slice(0, 16)}`,
          error: fundingError,
        }
      : await settleTicket({
          poolId: reserved.poolId,
          concertId,
          ensName: name,
          worldIdSub: reserved.attempt.worldIdSub,
          priceMist: BigInt(reserved.priceMist),
          hash: reserved.attempt.ticketHash,
          payerSecret: wallet.secretKey,
        });
    const record = await writeTextRecord({
      ensName: name,
      key: ticketRecordKey(concertId),
      value: reserved.attempt.ticketHash,
    });
    await withState((state) => {
      const attempt = state.attempts.find((item) => item.id === reserved.attempt.id);
      const agent = state.agents.find((item) => item.ensName === name);
      if (attempt) {
        attempt.settlement = settled.mode;
        attempt.suiObjectId = settled.objectId ?? attempt.suiObjectId;
        attempt.settlementError = settled.error;
      }
      if (agent) agent.chainWrite = record.wrote ? "written" : agent.chainWrite;
    });
    reserved.attempt.settlement = settled.mode;
    reserved.attempt.suiObjectId = settled.objectId ?? reserved.attempt.suiObjectId;
    reserved.attempt.settlementError = settled.error;
  }

  return reserved.attempt;
}

export function devAuthorized(): boolean {
  return devMode();
}

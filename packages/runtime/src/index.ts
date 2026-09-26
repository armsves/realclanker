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
  grantRecordKey,
  resolveAgent,
  ticketRecordKey,
  writeTextRecord,
} from "@realclanker/ens";
import { createPool, settleTicket, ticketHash } from "@realclanker/settlement";
import { devMode, verifyIdToken } from "@realclanker/worldid";

config({ path: path.join(repoRoot(), ".env") });

const nid = (prefix: string) => `${prefix}_${randomBytes(6).toString("hex")}`;

export function snapshot(): State & { devMode: boolean; hosted: boolean } {
  return { ...readState(), devMode: devMode(), hosted: Boolean(process.env.VERCEL) };
}

export function createConcert(input: {
  name: string;
  venue: string;
  supply: number;
  priceMist: string;
  maxPerHuman: number;
  saleEndsAt: number;
}): Concert {
  const concert: Concert = {
    id: nid("show"),
    name: input.name.trim(),
    venue: input.venue.trim(),
    supply: input.supply,
    sold: 0,
    priceMist: input.priceMist,
    maxPerHuman: input.maxPerHuman,
    saleEndsAt: input.saleEndsAt,
    createdAt: Date.now(),
  };
  if (!concert.name || concert.supply < 1 || concert.maxPerHuman < 1) {
    throw new Error("Concert needs a name, supply, and a per-human cap.");
  }
  withState((state) => {
    state.concerts.unshift(concert);
  });
  void createPool({
    supply: concert.supply,
    priceMist: BigInt(concert.priceMist),
  }).then((created) => {
    if (!created.poolId && !created.error) return;
    withState((state) => {
      const found = state.concerts.find((item) => item.id === concert.id);
      if (!found) return;
      if (created.poolId) found.suiPoolId = created.poolId;
    });
  });
  return concert;
}

export async function registerAgent(ensName: string): Promise<Agent> {
  const name = ensName.trim().toLowerCase();
  if (!name.endsWith(".eth")) throw new Error("Agent identity must be an ENS name.");
  const profile =
    name.endsWith(".realclanker.eth") && process.env.ENS_RESOLVE_SYNTHETIC !== "true"
      ? { avatarUrl: avatarDataUri(name), address: undefined }
      : await resolveAgent(name);
  return withState((state) => {
    const existing = state.agents.find((agent) => agent.ensName === name);
    if (existing) {
      existing.avatarUrl = profile.avatarUrl;
      existing.address = profile.address;
      return existing;
    }
    const agent: Agent = {
      ensName: name,
      address: profile.address,
      avatarUrl: profile.avatarUrl,
      records: {},
      chainWrite: "skipped",
      createdAt: Date.now(),
    };
    state.agents.push(agent);
    return agent;
  });
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

  withState((state) => {
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
  }).then((result) => {
    withState((state) => {
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
  const reserved = withState((state) => {
    const concert = state.concerts.find((item) => item.id === concertId);
    const agent = state.agents.find((item) => item.ensName === name);
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
    const settled = await settleTicket({
      poolId: reserved.poolId,
      concertId,
      ensName: name,
      worldIdSub: reserved.attempt.worldIdSub,
      priceMist: BigInt(reserved.priceMist),
      hash: reserved.attempt.ticketHash,
    });
    const record = await writeTextRecord({
      ensName: name,
      key: ticketRecordKey(concertId),
      value: reserved.attempt.ticketHash,
    });
    withState((state) => {
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

import type { Concert, Decision, Grant } from "./types";

export function decide(input: {
  now: number;
  concertId: string;
  concert?: Concert;
  grantsForAgent: Grant[];
  completedByHuman: (worldIdSub: string) => number;
}): Decision {
  const { concert, grantsForAgent, now, concertId } = input;

  if (!concert) {
    return { outcome: "PURCHASE_DENIED", reason: "Concert does not exist." };
  }
  if (now > concert.saleEndsAt) {
    return { outcome: "PURCHASE_DENIED", reason: "Ticket sale has ended." };
  }
  if (grantsForAgent.length === 0) {
    return {
      outcome: "WORLD_ID_NOT_DETECTED",
      reason: "No World ID authorization is bound to this ENS agent.",
    };
  }

  const scoped = grantsForAgent.filter(
    (grant) => grant.concertId === concertId && grant.permission === "ticket.buy",
  );
  if (scoped.length === 0) {
    return {
      outcome: "PURCHASE_DENIED",
      reason: "World ID authorization is not valid for this concert.",
    };
  }

  const live = scoped
    .filter((grant) => grant.expiresAt > now)
    .sort((a, b) => b.issuedAt - a.issuedAt);
  if (live.length === 0) {
    return {
      outcome: "PURCHASE_DENIED",
      reason: "World ID authorization has expired.",
      worldIdSub: scoped[0]?.worldIdSub,
    };
  }

  const grant = live[0]!;
  const cap = Math.min(grant.maxTickets, concert.maxPerHuman);
  if (input.completedByHuman(grant.worldIdSub) >= cap) {
    return {
      outcome: "IDENTITY_ALREADY_USED",
      reason: "This World ID already bought the allowed ticket for this concert.",
      worldIdSub: grant.worldIdSub,
      grantId: grant.id,
    };
  }
  if (concert.sold >= concert.supply) {
    return {
      outcome: "PURCHASE_DENIED",
      reason: "Ticket supply is exhausted.",
      worldIdSub: grant.worldIdSub,
      grantId: grant.id,
    };
  }

  return {
    outcome: "PURCHASE_COMPLETE",
    reason: "World ID grant is valid for this ENS agent, concert, and window.",
    worldIdSub: grant.worldIdSub,
    grantId: grant.id,
  };
}

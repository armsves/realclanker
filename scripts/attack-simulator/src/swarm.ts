import { buyTicket, createConcert, issueGrant, registerAgent } from "@realclanker/runtime";

const ADJECTIVES = ["swift", "silent", "amber", "neon", "velvet", "lunar", "rapid", "bold", "quiet", "wild"];
const ANIMALS = ["otter", "fox", "crane", "moth", "wolf", "heron", "koi", "lynx", "hawk", "eel"];

type Kind = "valid" | "duplicate" | "expired" | "wrong" | "bare";
type Plan = { ensName: string; kind: Kind; subject?: string };

function ensName(index: number) {
  const adjective = ADJECTIVES[index % ADJECTIVES.length];
  const animal = ANIMALS[Math.floor(index / ADJECTIVES.length) % ANIMALS.length];
  return `${adjective}-${animal}-${index}.realclanker.eth`;
}

function planSwarm(total: number): Plan[] {
  const validCount = Math.max(1, Math.round(total * 0.2));
  const duplicates = Math.max(1, Math.round(total * 0.16));
  const expired = Math.max(1, Math.round(total * 0.12));
  const wrong = Math.max(1, Math.round(total * 0.12));
  const bare = Math.max(0, total - validCount - duplicates - expired - wrong);
  const plans: Plan[] = [];
  const subjects: string[] = [];
  let cursor = 0;
  for (let i = 0; i < validCount; i += 1) {
    const subject = `dev:human-${i}`;
    subjects.push(subject);
    plans.push({ ensName: ensName(cursor), kind: "valid", subject });
    cursor += 1;
  }
  for (let i = 0; i < duplicates; i += 1) {
    plans.push({
      ensName: ensName(cursor),
      kind: "duplicate",
      subject: subjects[i % subjects.length],
    });
    cursor += 1;
  }
  for (let i = 0; i < expired; i += 1) {
    plans.push({ ensName: ensName(cursor), kind: "expired", subject: `dev:expired-${i}` });
    cursor += 1;
  }
  for (let i = 0; i < wrong; i += 1) {
    plans.push({ ensName: ensName(cursor), kind: "wrong", subject: `dev:wrong-${i}` });
    cursor += 1;
  }
  for (let i = 0; i < bare; i += 1) {
    plans.push({ ensName: ensName(cursor), kind: "bare" });
    cursor += 1;
  }
  return plans;
}

export async function runSwarm(input: { agents: number; concertId: string }) {
  const total = Math.max(4, Math.min(80, input.agents));
  const decoy = await createConcert({
    name: "Decoy Scope",
    venue: "Elsewhere",
    supply: 10,
    priceMist: "0",
    maxPerHuman: 1,
    saleEndsAt: Date.now() + 180 * 60_000,
  });
  const plans = planSwarm(total);
  for (const plan of plans) {
    await registerAgent(plan.ensName, { mint: false });
  }
  const now = Date.now();
  for (const plan of plans) {
    if (!plan.subject) continue;
    await issueGrant({
      ensName: plan.ensName,
      concertId: plan.kind === "wrong" ? decoy.id : input.concertId,
      maxTickets: 1,
      expiresAt: plan.kind === "expired" ? now - 60_000 : now + 15 * 60_000,
      devSubject: plan.subject,
    });
  }
  const attempts = await Promise.all(
    plans.map((plan) => buyTicket(plan.ensName, input.concertId)),
  );
  return {
    agents: total,
    concertId: input.concertId,
    PURCHASE_COMPLETE: attempts.filter((item) => item.outcome === "PURCHASE_COMPLETE").length,
    IDENTITY_ALREADY_USED: attempts.filter((item) => item.outcome === "IDENTITY_ALREADY_USED").length,
    WORLD_ID_NOT_DETECTED: attempts.filter((item) => item.outcome === "WORLD_ID_NOT_DETECTED").length,
    PURCHASE_DENIED: attempts.filter((item) => item.outcome === "PURCHASE_DENIED").length,
  };
}

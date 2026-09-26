import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ADJECTIVES = ["swift", "silent", "amber", "neon", "velvet", "lunar", "rapid", "bold", "quiet", "wild"];
const ANIMALS = ["otter", "fox", "crane", "moth", "wolf", "heron", "koi", "lynx", "hawk", "eel"];

type Kind = "valid" | "duplicate" | "expired" | "wrong" | "bare";
type Plan = { ensName: string; kind: Kind; subject?: string };

function flag(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1];
}

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

async function connect() {
  const endpoint = process.env.MCP_URL || "http://127.0.0.1:8787/mcp";
  const client = new Client({ name: "realclanker-swarm", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  await client.connect(transport);
  return client;
}

async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  const block = result.content?.find((item) => item.type === "text");
  if (!block || block.type !== "text") throw new Error(`${name} returned no text`);
  return JSON.parse(block.text) as T;
}

async function main() {
  const total = Math.max(4, Math.min(80, Number(flag("agents", "50"))));
  const client = await connect();
  let concertId = flag("concert");
  if (!concertId) {
    const created = await call<{ id: string }>(client, "create_concert", {
      name: "Midnight Signal",
      venue: "Shibuya",
      supply: Math.max(12, Math.round(total * 0.25)),
      priceMist: "100000000",
      maxPerHuman: 1,
      saleMinutes: 180,
    });
    concertId = created.id;
  }
  const decoy = await call<{ id: string }>(client, "create_concert", {
    name: "Decoy Scope",
    venue: "Elsewhere",
    supply: 10,
    priceMist: "0",
    maxPerHuman: 1,
    saleMinutes: 180,
  });

  const plans = planSwarm(total);
  for (const plan of plans) {
    await call(client, "register_agent", { ensName: plan.ensName });
  }

  const now = Date.now();
  for (const plan of plans) {
    if (!plan.subject) continue;
    await call(client, "issue_grant", {
      ensName: plan.ensName,
      concertId: plan.kind === "wrong" ? decoy.id : concertId,
      maxTickets: 1,
      expiresAt: plan.kind === "expired" ? now - 60_000 : now + 15 * 60_000,
      devSubject: plan.subject,
    });
  }

  const attempts = await Promise.all(
    plans.map((plan) => call<{ outcome: string }>(client, "buy_ticket", { ensName: plan.ensName, concertId })),
  );
  const summary = {
    agents: total,
    concertId,
    PURCHASE_COMPLETE: attempts.filter((item) => item.outcome === "PURCHASE_COMPLETE").length,
    IDENTITY_ALREADY_USED: attempts.filter((item) => item.outcome === "IDENTITY_ALREADY_USED").length,
    WORLD_ID_NOT_DETECTED: attempts.filter((item) => item.outcome === "WORLD_ID_NOT_DETECTED").length,
    PURCHASE_DENIED: attempts.filter((item) => item.outcome === "PURCHASE_DENIED").length,
  };
  console.log("SUMMARY " + JSON.stringify(summary));
  await client.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

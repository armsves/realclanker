import { after } from "next/server";
import { devAuthorized, publishIdentity } from "@realclanker/runtime";
import { runSwarm } from "@realclanker/attack-simulator/swarm";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!devAuthorized()) {
    return Response.json({ error: "The attack simulator is disabled." }, { status: 403 });
  }
  const body = (await request.json()) as { concertId?: string; agents?: number };
  const concertId = String(body.concertId ?? "");
  const requested = Math.max(4, Math.min(80, Number(body.agents) || 12));
  const agents = process.env.VERCEL ? Math.min(requested, 40) : requested;
  if (!concertId) return Response.json({ error: "Pick a concert first." }, { status: 400 });
  try {
    const summary = await runSwarm({ agents, concertId });
    const winners = summary.winners ?? [];
    after(async () => {
      for (const ensName of winners) {
        await publishIdentity(ensName, concertId, { pointAddress: false });
      }
    });
    return Response.json({ ok: true, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Simulator failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}

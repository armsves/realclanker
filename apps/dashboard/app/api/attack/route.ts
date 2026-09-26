import { spawn } from "node:child_process";
import { repoRoot } from "@realclanker/core";
import { devAuthorized } from "@realclanker/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (process.env.VERCEL) {
    return Response.json(
      {
        error:
          "The swarm runs on your machine, next to the MCP server. Clone the repo and use pnpm simulate.",
      },
      { status: 501 },
    );
  }
  if (!devAuthorized()) {
    return Response.json({ error: "The attack simulator is disabled." }, { status: 403 });
  }
  const body = (await request.json()) as { concertId?: string; agents?: number };
  const concertId = String(body.concertId ?? "");
  const agents = Math.max(4, Math.min(80, Number(body.agents) || 50));
  if (!concertId) return Response.json({ error: "Pick a concert first." }, { status: 400 });

  const child = spawn(
    "pnpm",
    [
      "--filter",
      "@realclanker/attack-simulator",
      "start",
      "--",
      "--agents",
      String(agents),
      "--concert",
      concertId,
    ],
    { cwd: repoRoot() },
  );

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });

  const code = await new Promise<number>((resolve) => {
    child.on("exit", (status) => resolve(status ?? 1));
  });
  if (code !== 0) {
    return Response.json({ error: output.slice(-800) || "Simulator failed." }, { status: 500 });
  }
  const summaryLine = output.split("\n").find((line) => line.startsWith("SUMMARY "));
  const summary = summaryLine ? JSON.parse(summaryLine.slice("SUMMARY ".length)) : {};
  return Response.json({ ok: true, summary });
}

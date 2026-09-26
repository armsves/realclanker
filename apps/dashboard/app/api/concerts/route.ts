import { createConcert } from "@realclanker/runtime";
import { callMcp } from "../../../lib/mcp";

export const dynamic = "force-dynamic";

type Created = { id: string; name: string };

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, string>;
  const minutes = Number(body.saleMinutes ?? 180);
  const priceSui = Number(body.priceSui ?? 0);
  const input = {
    name: String(body.name ?? ""),
    venue: String(body.venue ?? "Tokyo"),
    supply: Number(body.supply),
    priceMist: String(Math.round(priceSui * 1_000_000_000)),
    maxPerHuman: Number(body.maxPerHuman ?? 1),
    saleMinutes: minutes,
  };
  try {
    if (process.env.VERCEL) {
      const concert = await createConcert({
        ...input,
        saleEndsAt: Date.now() + minutes * 60_000,
      });
      return Response.json(concert);
    }
    const concert = await callMcp<Created>("create_concert", input);
    return Response.json(concert);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create concert.";
    const offline = /fetch failed|ECONNREFUSED|connect/i.test(message);
    return Response.json(
      { error: offline ? "MCP server is not running. Start it with pnpm dev." : message },
      { status: offline ? 503 : 400 },
    );
  }
}

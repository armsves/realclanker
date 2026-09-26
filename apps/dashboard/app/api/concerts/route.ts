import { createConcert } from "@realclanker/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, string>;
  const minutes = Number(body.saleMinutes ?? 180);
  const priceSui = Number(body.priceSui ?? 0);
  try {
    const concert = createConcert({
      name: String(body.name ?? ""),
      venue: String(body.venue ?? "Tokyo"),
      supply: Number(body.supply),
      priceMist: String(Math.round(priceSui * 1_000_000_000)),
      maxPerHuman: Number(body.maxPerHuman ?? 1),
      saleEndsAt: Date.now() + minutes * 60_000,
    });
    return Response.json(concert);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create concert.";
    return Response.json({ error: message }, { status: 400 });
  }
}

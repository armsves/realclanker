import { createConcert } from "@realclanker/runtime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, string>;
  const priceSui = Number(body.priceSui ?? 0);
  const saleStartsAt = Number(body.saleStartsAt);
  const saleEndsAt = Number(body.saleEndsAt);
  if (!Number.isFinite(saleStartsAt) || !Number.isFinite(saleEndsAt) || saleEndsAt <= saleStartsAt) {
    return Response.json({ error: "Sale end must be after the sale start." }, { status: 400 });
  }
  try {
    const concert = await createConcert({
      name: String(body.name ?? ""),
      venue: String(body.venue ?? "Tokyo"),
      supply: Number(body.supply),
      priceMist: String(Math.round(priceSui * 1_000_000_000)),
      maxPerHuman: Number(body.maxPerHuman ?? 1),
      saleStartsAt,
      saleEndsAt,
    });
    return Response.json(concert);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create concert.";
    return Response.json({ error: message }, { status: 400 });
  }
}

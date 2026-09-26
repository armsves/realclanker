import { deleteConcert } from "@realclanker/runtime";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    await deleteConcert(id);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete the concert.";
    return Response.json({ error: message }, { status: 400 });
  }
}

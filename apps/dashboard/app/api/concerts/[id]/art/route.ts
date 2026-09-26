import { readConcertArt, setConcertArt } from "@realclanker/runtime";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function contentType(file: File): string {
  const declared = file.type.toLowerCase();
  if (declared.startsWith("image/") || declared.startsWith("video/")) return declared;
  const extension = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "";
  return TYPES[extension] ?? "";
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const art = await readConcertArt(id);
  if (!art) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(art.bytes), {
    headers: {
      "content-type": art.contentType,
      "cache-control": "public, max-age=86400",
    },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose a picture or a video." }, { status: 400 });
  }
  const type = contentType(file);
  try {
    const concert = await setConcertArt(id, { contentType: type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json(concert);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not store the art.";
    return Response.json({ error: message }, { status: 400 });
  }
}

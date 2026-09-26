import { BACKDROP_CHUNK, backdropSize, readBackdropRange, saveBackdropPart } from "@realclanker/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function contentType(file: File): string {
  const declared = file.type.toLowerCase();
  if (declared.startsWith("video/")) return declared;
  const name = file.name.toLowerCase();
  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".webm")) return "video/webm";
  return "";
}

function numberField(form: FormData, name: string, fallback: number) {
  const raw = form.get(name);
  if (typeof raw !== "string" || raw === "") return fallback;
  return Number(raw);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const info = await backdropSize(id);
  if (!info) return new Response(null, { status: 404 });
  const total = info.total;
  const range = request.headers.get("range");
  let start = 0;
  let end = Math.min(total - 1, BACKDROP_CHUNK - 1);
  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    if (!match) return new Response(null, { status: 416 });
    start = Number(match[1]);
    const requested = match[2] ? Number(match[2]) : total - 1;
    if (start >= total || requested < start) return new Response(null, { status: 416 });
    end = Math.min(requested, start + BACKDROP_CHUNK - 1, total - 1);
  }
  const video = await readBackdropRange(id, start, end);
  if (!video) return new Response(null, { status: 404 });
  const bytes = video.bytes;
  const full = start === 0 && end === total - 1;
  return new Response(new Uint8Array(bytes), {
    status: full ? 200 : 206,
    headers: {
      "content-type": video.contentType,
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=86400",
      "content-length": String(bytes.length),
      ...(full ? {} : { "content-range": `bytes ${start}-${end}/${total}` }),
    },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose a video." }, { status: 400 });
  }
  const totalBytes = numberField(form, "total", file.size);
  const parts = numberField(form, "parts", 1);
  const part = numberField(form, "part", 0);
  try {
    const concert = await saveBackdropPart(id, {
      contentType: contentType(file),
      bytes: new Uint8Array(await file.arrayBuffer()),
      part,
      parts,
      totalBytes,
    });
    return Response.json({ ...concert, part, parts, done: Boolean(concert.backdrop) && part === parts - 1 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not store the video.";
    return Response.json({ error: message }, { status: 400 });
  }
}

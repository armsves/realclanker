import { readConcertBackdrop, setConcertBackdrop } from "@realclanker/runtime";

export const dynamic = "force-dynamic";

function contentType(file: File): string {
  const declared = file.type.toLowerCase();
  if (declared.startsWith("video/")) return declared;
  const name = file.name.toLowerCase();
  if (name.endsWith(".mp4")) return "video/mp4";
  if (name.endsWith(".webm")) return "video/webm";
  return "";
}

function media(bytes: Buffer, type: string, request: Request) {
  const range = request.headers.get("range");
  const size = bytes.length;
  const headers = {
    "content-type": type,
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=86400",
  };
  if (!range) {
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "content-length": String(size) } });
  }
  const match = /bytes=(\d+)-(\d*)/.exec(range);
  if (!match) return new Response(null, { status: 416 });
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (start >= size || end < start) return new Response(null, { status: 416 });
  const slice = bytes.subarray(start, end + 1);
  return new Response(new Uint8Array(slice), {
    status: 206,
    headers: {
      ...headers,
      "content-length": String(slice.length),
      "content-range": `bytes ${start}-${end}/${size}`,
    },
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const video = await readConcertBackdrop(id);
  if (!video) return new Response(null, { status: 404 });
  return media(video.bytes, video.contentType, request);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Choose a video." }, { status: 400 });
  }
  try {
    const concert = await setConcertBackdrop(id, {
      contentType: contentType(file),
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return Response.json(concert);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not store the video.";
    return Response.json({ error: message }, { status: 400 });
  }
}

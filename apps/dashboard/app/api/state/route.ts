import { snapshot } from "@realclanker/runtime";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(snapshot());
}

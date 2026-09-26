import { snapshot } from "@realclanker/runtime";
import { mcpReachable } from "../../../lib/mcp";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await snapshot();
  const mcp = await mcpReachable();
  return Response.json({ ...state, mcp });
}

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export function mcpEndpoint() {
  if (process.env.MCP_URL) return process.env.MCP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}/api/mcp`;
  return "http://127.0.0.1:8787/mcp";
}

export async function mcpReachable() {
  if (process.env.VERCEL) return true;
  const health = new URL(mcpEndpoint());
  health.pathname = "/health";
  health.search = "";
  try {
    const response = await fetch(health, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function callMcp<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const client = new Client({ name: "realclanker-dashboard", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpEndpoint()));
  await client.connect(transport);
  try {
    const result = await client.callTool({ name, arguments: args });
    const block = result.content?.find((item) => item.type === "text");
    if (!block || block.type !== "text") throw new Error(`${name} returned no text`);
    const parsed = JSON.parse(block.text) as T & { error?: string };
    if (result.isError) throw new Error(parsed.error || block.text);
    return parsed;
  } finally {
    await client.close();
  }
}

import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buyTicket, createConcert, issueGrant, registerAgent, snapshot } from "@realclanker/runtime";
import { z } from "zod";

const port = Number(process.env.MCP_PORT || 8787);

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function buildServer() {
  const server = new McpServer({ name: "realclanker", version: "0.1.0" });

  server.registerTool(
    "list_concerts",
    {
      title: "List concerts",
      description: "List ticket pools and how many seats have settled.",
      inputSchema: z.object({}),
    },
    async () => text(snapshot().concerts),
  );

  server.registerTool(
    "create_concert",
    {
      title: "Create concert",
      description: "Open a ticket pool with supply, price, per-human cap, and a sale window.",
      inputSchema: z.object({
        name: z.string(),
        venue: z.string().default("Tokyo"),
        supply: z.number().int().positive(),
        priceMist: z.string().default("0"),
        maxPerHuman: z.number().int().positive().default(1),
        saleMinutes: z.number().positive().default(180),
      }),
    },
    async (input) =>
      text(
        createConcert({
          name: input.name,
          venue: input.venue,
          supply: input.supply,
          priceMist: input.priceMist,
          maxPerHuman: input.maxPerHuman,
          saleEndsAt: Date.now() + input.saleMinutes * 60_000,
        }),
      ),
  );

  server.registerTool(
    "register_agent",
    {
      title: "Register ENS agent",
      description: "Create or refresh the ENS v2 identity an agent will buy with.",
      inputSchema: z.object({ ensName: z.string() }),
    },
    async ({ ensName }) => text(await registerAgent(ensName)),
  );

  server.registerTool(
    "issue_grant",
    {
      title: "Delegate a World ID grant",
      description:
        "Bind a verified human to one ENS agent, one concert, a ticket cap, and an expiry. Pass an ID token, or a devSubject when REALCLANKER_DEV_MODE=true.",
      inputSchema: z.object({
        ensName: z.string(),
        concertId: z.string(),
        maxTickets: z.number().int().positive().default(1),
        expiresAt: z.number().int(),
        idToken: z.string().optional(),
        devSubject: z.string().optional(),
      }),
    },
    async (input) => text(await issueGrant(input)),
  );

  server.registerTool(
    "buy_ticket",
    {
      title: "Buy a ticket",
      description:
        "Purchase one ticket for an ENS agent. Succeeds only when a live World ID grant covers this concert and the human has not already bought.",
      inputSchema: z.object({
        ensName: z.string(),
        concertId: z.string(),
      }),
    },
    async ({ ensName, concertId }) => text(await buyTicket(ensName, concertId)),
  );

  return server;
}

const httpServer = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "POST" && req.url === "/mcp") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString() || "{}";
    const body = JSON.parse(raw) as unknown;
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    return;
  }
  res.writeHead(404);
  res.end();
});

httpServer.listen(port, "127.0.0.1", () => {
  console.log(`RealClanker MCP listening on http://127.0.0.1:${port}/mcp`);
});

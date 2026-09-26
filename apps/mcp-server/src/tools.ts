import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { agentWallet, buyTicket, createConcert, fundAgent, issueGrant, registerAgent, snapshot } from "@realclanker/runtime";
import { z } from "zod";

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

export function createMcpServer() {
  const server = new McpServer({ name: "realclanker", version: "0.1.0" });

  server.registerTool(
    "list_concerts",
    {
      title: "List concerts",
      description: "List ticket pools and how many seats have settled.",
      inputSchema: z.object({}),
    },
    async () => text((await snapshot()).concerts),
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
        await createConcert({
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
      description:
        "Create the ENS v2 identity an agent buys with. The server keeps an EVM wallet and a Sui wallet for that name. With mint true, the platform EVM wallet pays Sepolia gas and the agent's EVM address owns the name.",
      inputSchema: z.object({
        ensName: z.string(),
        mint: z.boolean().default(true),
      }),
    },
    async ({ ensName, mint }) => text(await registerAgent(ensName, { mint })),
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
    "agent_wallet",
    {
      title: "Agent wallets",
      description:
        "Return the agent's Sui address and EVM address. Keys stay on the server. The EVM address owns the minted ENS name. The Sui address pays for tickets after the treasury tops it up.",
      inputSchema: z.object({ ensName: z.string() }),
    },
    async ({ ensName }) => text(await agentWallet(ensName)),
  );

  server.registerTool(
    "fund_agent",
    {
      title: "Fund the agent Sui wallet",
      description:
        "Request testnet SUI from the faucet for this agent's wallet. If the faucet is rate-limited, top up from the treasury key instead.",
      inputSchema: z.object({ ensName: z.string() }),
    },
    async ({ ensName }) => text(await fundAgent(ensName)),
  );

  server.registerTool(
    "buy_ticket",
    {
      title: "Buy a ticket",
      description:
        "Purchase one ticket for an ENS agent. Succeeds only when a live World ID grant covers this concert and the human has not already bought. Payment is signed by the agent's Sui wallet.",
      inputSchema: z.object({
        ensName: z.string(),
        concertId: z.string(),
      }),
    },
    async ({ ensName, concertId }) => text(await buyTicket(ensName, concertId)),
  );

  return server;
}

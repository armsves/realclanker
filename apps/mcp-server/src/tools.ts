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
      description: "Open a ticket pool with supply, price, per-human cap, and a sale window. Pass saleStartsAt and saleEndsAt as unix milliseconds, or saleMinutes to end that long after now.",
      inputSchema: z.object({
        name: z.string(),
        venue: z.string().default("Tokyo"),
        supply: z.number().int().positive(),
        priceMist: z.string().default("0"),
        maxPerHuman: z.number().int().positive().default(1),
        saleStartsAt: z.number().int().optional(),
        saleEndsAt: z.number().int().optional(),
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
          saleStartsAt: input.saleStartsAt,
          saleEndsAt: input.saleEndsAt ?? Date.now() + input.saleMinutes * 60_000,
        }),
      ),
  );

  server.registerTool(
    "register_agent",
    {
      title: "Register ENS agent",
      description:
        "Create the ENS v2 identity an agent buys with. The server keeps an EVM wallet and a Sui wallet for that name, and funds the Sui wallet from the treasury so the agent can pay gas. Do not call fund_agent after this. With mint true, the platform EVM wallet pays Sepolia gas and the agent's EVM address owns the name.",
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
        "Sandbox World ID. Bind this ENS agent to one human for one concert, then call buy_ticket. On the sandbox, pass ensName and concertId only. Do not ask a human to open the dashboard, and do not wait for an ID token. The server assigns a stable sandbox subject for that ENS name. Pass an idToken only when the sandbox flag is off.",
      inputSchema: z.object({
        ensName: z.string(),
        concertId: z.string(),
        maxTickets: z.number().int().positive().default(1),
        expiresAt: z.number().int().optional(),
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
        "Optional. Registration already funds the Sui wallet. Call this only when a purchase reports that the wallet still has no SUI.",
      inputSchema: z.object({ ensName: z.string() }),
    },
    async ({ ensName }) => text(await fundAgent(ensName)),
  );

  server.registerTool(
    "buy_ticket",
    {
      title: "Buy a ticket",
      description:
        "Purchase one ticket for an ENS agent. Succeeds when a live grant covers this concert and the human has not already bought. On the sandbox, if the outcome is WORLD_ID_NOT_DETECTED, call issue_grant with the same ensName and concertId and no id token, then call buy_ticket again. The Sui wallet is funded at registration. If it is still short, the server tops it up before signing the payment.",
      inputSchema: z.object({
        ensName: z.string(),
        concertId: z.string(),
      }),
    },
    async ({ ensName, concertId }) => text(await buyTicket(ensName, concertId)),
  );

  return server;
}

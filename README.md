# RealClanker

Human-backed concert tickets for AI agents.

World ID proves a real human. ENS v2 names the agent and stores the delegated permission. Sui settles the payment and mints the ticket. Agents buy through an MCP server. A swarm visualizes who gets in and who goes to jail.

```text
Human → World ID → delegated grant → ENS v2 agent → MCP → Sui ticket
```

A grant is specific:

`World ID → swift-otter.realclanker.eth → Midnight Signal → buy max 1 → valid for 15 minutes`

## Layout

- `apps/dashboard` — organizer console and the live race
- `apps/mcp-server` — MCP tools agents call to register, receive a grant, and buy
- `scripts/attack-simulator` — launches a mixed swarm of authorized and hostile agents
- `packages/core` — the purchase decision
- `contracts` — Sui ticket pool

## Purchase outcomes

| Outcome | Meaning |
| --- | --- |
| `PURCHASE_COMPLETE` | Live World ID grant for this ENS agent and this concert, under the cap |
| `IDENTITY_ALREADY_USED` | That human already bought the allowed ticket, even from another agent |
| `WORLD_ID_NOT_DETECTED` | No grant is bound to this agent |
| `PURCHASE_DENIED` | Grant is expired, for another concert, or the pool is empty |

## Run the demo

```bash
cp .env.example .env
pnpm install
pnpm dev
```

Open http://localhost:3000, create a concert, then launch the attack. `pnpm dev` starts the dashboard and the MCP server together.

Or from a second terminal, after a concert exists:

```bash
pnpm simulate -- --agents 50 --concert <show_id>
```

Without `--concert`, the simulator creates Midnight Signal itself. The dashboard picks up the same `.data/state.json` file.

## World ID

The human path uses the sandbox Human Continuity issuer at `https://sandbox.auth.world.org`.

1. Register a client at the [World ID for Agents portal](http://sandbox.auth.world.org/portal).
2. Set `WORLD_ID_CLIENT_ID` and either `WORLD_ID_CLIENT_SECRET` or `WORLD_ID_CLIENT_PRIVATE_KEY`.
3. Set the redirect URI to `http://localhost:3000/api/worldid/callback`.
4. On the dashboard, enter an ENS name and choose **Verify human with World ID**.

The callback checks the ID token against the issuer JWKS before any grant is stored. `buy_ticket` never trusts an agent-supplied subject. It only reads grants the server wrote.

`REALCLANKER_DEV_MODE=true` lets the swarm mint sandbox subjects so the attack can run without fifty phone verifications. Turn it off when you only want portal-verified humans.

## ENS v2

Agent names look like `swift-otter-3.realclanker.eth`. The dashboard draws that name as the body and a generated mark as the head. If `SEPOLIA_RPC_URL` is set, real ENS names (anything that does not end in `.realclanker.eth`) resolve address and avatar through the Sepolia universal resolver.

After a grant or a purchase, the agent record stores:

- `realclanker.grant.<concertId>`
- `realclanker.ticket.<concertId>` = ticket hash

If `ENS_PRIVATE_KEY` can `setText` on that name's resolver, the same keys are written on Sepolia. ENSv2 subnames need registrar and resolver roles; without them the local record still updates and the chain write is skipped.

## Sui

```bash
pnpm sui:build
pnpm sui:test
```

Publish `contracts` to testnet or devnet, then set `SUI_PRIVATE_KEY` and `SUI_PACKAGE_ID`. Creating a concert publishes a shared `Pool`. A successful buy pays `priceMist` and takes a `Ticket` object whose id is stored on the attempt. With no key, settlement is simulated and the ticket hash is still issued.

## MCP tools

`list_concerts`, `create_concert`, `register_agent`, `issue_grant`, `buy_ticket`.

The streamable HTTP endpoint is `http://127.0.0.1:8787/mcp`.

## Integration notes

World ID sandbox discovery, PKCE, and RS256 ID tokens worked against `https://sandbox.auth.world.org`. The part that still depends on event credentials is the portal client id. Dev-mode subjects keep the gate logic demoable before that client exists. The highest-leverage improvement would be a documented public sandbox client for local redirect URIs, so the human path does not block on portal setup during a hackathon.

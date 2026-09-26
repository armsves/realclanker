"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RaceCanvas, type Racer } from "./RaceCanvas";

type Outcome = Racer["outcome"];

type Concert = {
  id: string;
  name: string;
  venue: string;
  supply: number;
  sold: number;
  priceMist: string;
  maxPerHuman: number;
  saleEndsAt: number;
};

type Attempt = Racer & {
  concertId: string;
  outcome: Outcome;
  reason: string;
  ticketHash?: string;
  suiObjectId?: string;
  settlement: string;
  at: number;
};

type Snapshot = {
  devMode: boolean;
  hosted?: boolean;
  mcp?: boolean;
  mcpUrl?: string;
  concerts: Concert[];
  attempts: Attempt[];
  grants: { id: string }[];
};

type AttackSummary = {
  agents?: number;
  PURCHASE_COMPLETE?: number;
  IDENTITY_ALREADY_USED?: number;
  WORLD_ID_NOT_DETECTED?: number;
  PURCHASE_DENIED?: number;
};

const emptyForm = {
  name: "Midnight Signal",
  venue: "Shibuya",
  supply: "12",
  priceSui: "0.1",
  maxPerHuman: "1",
  saleMinutes: "180",
};

export function Dashboard() {
  const params = useSearchParams();
  const [data, setData] = useState<Snapshot | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [selected, setSelected] = useState("");
  const [ensName, setEnsName] = useState("my-agent.eth");
  const [agents, setAgents] = useState("50");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [attack, setAttack] = useState<AttackSummary | null>(null);
  const [mintNote, setMintNote] = useState("");
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    let stop = false;
    const pull = async () => {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (!response.ok || stop) return;
      const next = (await response.json()) as Snapshot;
      if (!stop) setData(next);
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 600);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (selected || !data?.concerts.length) return;
    const scored = [...data.concerts].sort((a, b) => {
      const score = (id: string) => data.attempts.filter((attempt) => attempt.concertId === id).length;
      return score(b.id) - score(a.id);
    });
    const best = scored[0];
    if (best) setSelected(best.id);
  }, [data, selected]);

  const concert = data?.concerts.find((item) => item.id === selected) ?? data?.concerts[0];
  const attempts = useMemo(
    () => (data?.attempts ?? []).filter((attempt) => !concert || attempt.concertId === concert.id),
    [data, concert],
  );
  const history = useMemo(() => [...attempts].sort((a, b) => a.at - b.at), [attempts]);
  const counts = countOutcomes(attempts);

  async function createConcert(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError("");
    setAttack(null);
    const response = await fetch("/api/concerts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const body = await response.json();
    setBusy("");
    if (!response.ok) {
      setError(body.error || "Could not create the concert.");
      return;
    }
    setSelected(body.id);
  }

  async function launchAttack() {
    if (!concert) return;
    setBusy("attack");
    setError("");
    setAttack(null);
    const response = await fetch("/api/attack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ concertId: concert.id, agents: Number(agents) }),
    });
    const body = await response.json();
    setBusy("");
    if (!response.ok) {
      setError(body.error || "The swarm did not start.");
      return;
    }
    setAttack(body.summary ?? null);
  }

  async function mintEns() {
    setBusy("mint");
    setError("");
    setMintNote("");
    const response = await fetch("/api/ens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ensName }),
    });
    const body = await response.json();
    setBusy("");
    if (!response.ok) {
      setError(body.error || "ENS mint failed.");
      return;
    }
    if (body.ensMintError) {
      setMintNote(body.evmAddress ? `EVM wallet ${body.evmAddress} is ready for ${body.ensName}.` : "");
      setError(body.ensMintError);
      return;
    }
    const owned = body.ensMint === "owned" ? "already owns" : "owns";
    setMintNote(`${body.evmAddress} ${owned} ${body.ensName}. The platform wallet paid the gas.`);
  }

  function verifyHuman() {
    if (!concert) return;
    const query = new URLSearchParams({ concertId: concert.id, ensName });
    window.location.href = `/api/worldid/start?${query.toString()}`;
  }

  const worldNote =
    params.get("worldid") === "ok"
      ? "World ID grant stored. That ENS agent can buy through the MCP server."
      : params.get("worldid") === "error"
        ? params.get("message") || "World ID verification did not complete."
        : "";

  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <h1 suppressHydrationWarning>RealClanker</h1>
          <p>Agents may buy a ticket. Only a verified human may clear one.</p>
        </div>
        <p className="chain">Human → World ID → ENS v2 agent → MCP → Sui ticket</p>
      </header>
      <section className="layout">
        <aside className="panel">
          <h2>Concert</h2>
          <form onSubmit={createConcert}>
            <label>
              Name
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label>
              Venue
              <input value={form.venue} onChange={(event) => setForm({ ...form, venue: event.target.value })} />
            </label>
            <div className="row2">
              <label>
                Supply
                <input value={form.supply} onChange={(event) => setForm({ ...form, supply: event.target.value })} />
              </label>
              <label>
                Price (SUI)
                <input value={form.priceSui} onChange={(event) => setForm({ ...form, priceSui: event.target.value })} />
              </label>
            </div>
            <div className="row2">
              <label>
                Max / human
                <input value={form.maxPerHuman} onChange={(event) => setForm({ ...form, maxPerHuman: event.target.value })} />
              </label>
              <label>
                Minutes
                <input value={form.saleMinutes} onChange={(event) => setForm({ ...form, saleMinutes: event.target.value })} />
              </label>
            </div>
            <div className="actions">
              <button
                className="primary"
                disabled={busy === "create" || (data?.hosted === false && data.mcp === false)}
              >
                {busy === "create" ? "Creating…" : "Create concert"}
              </button>
            </div>
          </form>
          <p className="note">
            {!data
              ? "Checking the MCP server…"
              : data.hosted
                ? `Agents connect at ${data.mcpUrl}. Concerts, wallets, and tickets stay on this deployment.`
                : data.mcp
                  ? "MCP is live. This form opens the concert through the MCP server."
                  : "MCP is offline. Start pnpm dev before creating a concert."}
          </p>
          {data && data.concerts.length > 0 && (
            <label>
              Watching
              <select
                value={concert?.id ?? ""}
                onChange={(event) => setSelected(event.target.value)}
              >
                {data.concerts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {concert && (
            <p className="rules">
              {concert.venue} · {concert.sold}/{concert.supply} sold · cap {concert.maxPerHuman} ·{" "}
              {(Number(concert.priceMist) / 1e9).toString()} SUI
            </p>
          )}

          <h2>Delegate</h2>
          <label>
            ENS v2 agent
            <input value={ensName} onChange={(event) => setEnsName(event.target.value)} />
          </label>
          <div className="actions">
            <button className="ghost" type="button" onClick={mintEns} disabled={busy === "mint"}>
              {busy === "mint" ? "Minting…" : "Mint ENS"}
            </button>
            <button className="ghost" type="button" onClick={verifyHuman} disabled={!concert}>
              Verify human with World ID
            </button>
          </div>
          <p className="note">
            Mint creates an EVM wallet for this name. The platform wallet pays Sepolia gas, and that EVM address keeps the name.
            A live grant is one human, one ENS agent, this concert, one ticket, and a short expiry.
            {data?.devMode ? " Dev mode also lets the swarm mint sandbox subjects." : ""}
          </p>
          {mintNote && <p className="toast">{mintNote}</p>}
          {worldNote && <p className="toast">{worldNote}</p>}

          <h2>Swarm</h2>
          <label>
            Agents
            <input value={agents} onChange={(event) => setAgents(event.target.value)} />
          </label>
          <div className="actions">
            <button
              className="primary"
              type="button"
              onClick={launchAttack}
              disabled={!concert || busy === "attack" || (!data?.hosted && data?.mcp === false)}
            >
              {busy === "attack" ? "Racing…" : "Launch attack"}
            </button>
          </div>
          <p className="note">
            {data?.hosted
              ? "The swarm runs here. A hosted launch uses up to 16 agents so it finishes inside the function limit."
              : "The swarm buys through MCP. About 20% carry a fresh World ID grant. The rest are duplicates, expired, scoped to another show, or have no human at all."}
          </p>
          {attack && (attack.agents ?? 0) > 0 && (
            <p className="toast">
              {attack.agents ?? 0} agents · {attack.PURCHASE_COMPLETE ?? 0} purchased ·{" "}
              {attack.IDENTITY_ALREADY_USED ?? 0} already used · {attack.WORLD_ID_NOT_DETECTED ?? 0} undetected ·{" "}
              {attack.PURCHASE_DENIED ?? 0} denied
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </aside>

        <section className="stage">
          <ul className="legend">
            <li className="ok">cleared</li>
            <li className="used">identity used</li>
            <li className="miss">no World ID</li>
            <li className="deny">denied</li>
          </ul>
          <RaceCanvas
            key={`${concert?.id ?? "pool"}-${replay}`}
            racers={history}
            sold={concert?.sold ?? 0}
            supply={concert?.supply ?? 0}
            title={concert?.name ?? "Ticket pool"}
          />
        </section>

        <aside className="panel">
          <h2>Gate</h2>
          <div className="counts">
            <div><strong>{counts.PURCHASE_COMPLETE}</strong><span className="ok">purchased</span></div>
            <div><strong>{counts.IDENTITY_ALREADY_USED}</strong><span className="used">already used</span></div>
            <div><strong>{counts.WORLD_ID_NOT_DETECTED}</strong><span className="miss">undetected</span></div>
            <div><strong>{counts.PURCHASE_DENIED}</strong><span className="deny">denied</span></div>
          </div>
          <div className="history-bar">
            <h2>Sale history</h2>
            <button className="ghost" type="button" onClick={() => setReplay((value) => value + 1)} disabled={history.length === 0}>
              Replay sale
            </button>
          </div>
          <p className="note">Saved attempts for this concert, in the order they happened. Replay runs that record again.</p>
          <ul className="feed">
            {history.map((attempt, index) => (
              <li key={attempt.id}>
                {attempt.avatarUrl ? <img src={attempt.avatarUrl} alt="" /> : <span className="ph" />}
                <div>
                  <strong>
                    {index + 1}. {attempt.ensName}
                  </strong>
                  <em className={tone(attempt.outcome)}>{attempt.outcome}</em>
                  <p>{attempt.reason}</p>
                  <code>
                    {clock(attempt.at)} · {settlementLabel(attempt)}
                  </code>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </section>
    </main>
  );
}

function countOutcomes(attempts: Attempt[]) {
  return {
    PURCHASE_COMPLETE: attempts.filter((item) => item.outcome === "PURCHASE_COMPLETE").length,
    IDENTITY_ALREADY_USED: attempts.filter((item) => item.outcome === "IDENTITY_ALREADY_USED").length,
    WORLD_ID_NOT_DETECTED: attempts.filter((item) => item.outcome === "WORLD_ID_NOT_DETECTED").length,
    PURCHASE_DENIED: attempts.filter((item) => item.outcome === "PURCHASE_DENIED").length,
  };
}

function clock(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function settlementLabel(attempt: Attempt) {
  if (attempt.settlement === "sui" && attempt.suiObjectId) return `sui ${attempt.suiObjectId.slice(0, 10)}`;
  if (attempt.settlement === "simulated") return "simulated";
  if (attempt.settlement === "none") return "no payment";
  return attempt.settlement;
}

function tone(outcome: Outcome) {
  if (outcome === "PURCHASE_COMPLETE") return "ok";
  if (outcome === "IDENTITY_ALREADY_USED") return "used";
  if (outcome === "WORLD_ID_NOT_DETECTED") return "miss";
  return "deny";
}

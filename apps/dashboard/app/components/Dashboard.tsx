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
  settlement: string;
  at: number;
};

type Snapshot = {
  devMode: boolean;
  concerts: Concert[];
  attempts: Attempt[];
  grants: { id: string }[];
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
  const counts = countOutcomes(attempts);

  async function createConcert(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError("");
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
    const response = await fetch("/api/attack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ concertId: concert.id, agents: Number(agents) }),
    });
    const body = await response.json();
    setBusy("");
    if (!response.ok) setError(body.error || "The swarm did not start.");
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
              <button className="primary" disabled={busy === "create"}>
                {busy === "create" ? "Creating…" : "Create concert"}
              </button>
            </div>
          </form>
          {data && data.concerts.length > 0 && (
            <label>
              Watching
              <select
                value={concert?.id ?? ""}
                onChange={(event) => setSelected(event.target.value)}
                style={{ background: "#0e0c0a", border: "1px solid rgba(240,214,176,0.16)", borderRadius: 12, padding: "10px 12px" }}
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
            <button className="ghost" type="button" onClick={verifyHuman} disabled={!concert}>
              Verify human with World ID
            </button>
          </div>
          <p className="note">
            A live grant is one human, one ENS agent, this concert, one ticket, and a short expiry.
            {data?.devMode ? " Dev mode also lets the swarm mint sandbox subjects." : ""}
          </p>
          {worldNote && <p className="toast">{worldNote}</p>}

          <h2>Swarm</h2>
          <label>
            Agents
            <input value={agents} onChange={(event) => setAgents(event.target.value)} />
          </label>
          <div className="actions">
            <button className="primary" type="button" onClick={launchAttack} disabled={!concert || busy === "attack"}>
              {busy === "attack" ? "Racing…" : "Launch attack"}
            </button>
          </div>
          <p className="note">
            About 20% carry a fresh World ID grant. The rest are duplicates, expired, scoped to another show, or have no human at all.
          </p>
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
            racers={attempts}
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
          <ul className="feed">
            {attempts.slice(0, 18).map((attempt) => (
              <li key={attempt.id}>
                {attempt.avatarUrl ? <img src={attempt.avatarUrl} alt="" /> : <span className="ph" />}
                <div>
                  <strong>{attempt.ensName}</strong>
                  <em className={tone(attempt.outcome)}>{attempt.outcome}</em>
                  <p>{attempt.reason}</p>
                  {attempt.ticketHash && (
                    <code>
                      {attempt.settlement} · {attempt.ticketHash.slice(0, 16)}
                    </code>
                  )}
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

function tone(outcome: Outcome) {
  if (outcome === "PURCHASE_COMPLETE") return "ok";
  if (outcome === "IDENTITY_ALREADY_USED") return "used";
  if (outcome === "WORLD_ID_NOT_DETECTED") return "miss";
  return "deny";
}

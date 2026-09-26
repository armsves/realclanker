"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ENS_MARK_PATHS, ensColor } from "./ensMark";
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
  saleStartsAt?: number;
  saleEndsAt: number;
  createdAt?: number;
  suiPoolId?: string;
  art?: {
    kind: "image" | "video";
    contentType: string;
    updatedAt: number;
  };
  backdrop?: {
    contentType: string;
    updatedAt: number;
  };
};

type Attempt = Racer & {
  concertId: string;
  outcome: Outcome;
  reason: string;
  ticketHash?: string;
  suiObjectId?: string;
  suiAddress?: string;
  settlement: string;
  at: number;
};

type Grant = {
  id: string;
  worldIdSub: string;
  issuer: string;
  ensName: string;
  concertId: string;
  maxTickets: number;
  expiresAt: number;
  issuedAt: number;
  source: "oidc" | "dev";
  idToken?: string;
  claims?: {
    iss: string;
    sub: string;
    aud?: string;
    iat?: number;
    exp?: number;
    nonce?: string;
  };
};

type Snapshot = {
  devMode: boolean;
  hosted?: boolean;
  mcp?: boolean;
  mcpUrl?: string;
  concerts: Concert[];
  attempts: Attempt[];
  grants: Grant[];
  agents: {
    ensName: string;
    evmAddress?: string;
    suiAddress?: string;
    chainWrite: string;
    chainWriteError?: string;
    ensRecordTx?: string;
    ensMintTx?: string;
    records: Record<string, string>;
  }[];
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
  ...defaultWindow(),
};

function defaultWindow() {
  const start = new Date();
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 180 * 60_000);
  return { saleStartsAt: toLocalInput(start), saleEndsAt: toLocalInput(end) };
}

function toLocalInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function Dashboard() {
  const params = useSearchParams();
  const [data, setData] = useState<Snapshot | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [selected, setSelected] = useState("");
  const [agents, setAgents] = useState("40");
  const [backdropFile, setBackdropFile] = useState<File | null>(null);
  const [backdropError, setBackdropError] = useState("");
  const [backdropPart, setBackdropPart] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [attack, setAttack] = useState<AttackSummary | null>(null);
  const [replay, setReplay] = useState(0);
  const [tab, setTab] = useState<"feed" | "shows" | "proof">(() => (params.get("worldid") ? "proof" : "feed"));

  useEffect(() => {
    let stop = false;
    let pending = false;
    const controller = new AbortController();
    const pull = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/api/state", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`State request failed: ${response.status}`);
        const next = (await response.json()) as Snapshot;
        if (stop) return;
        setLoadError("");
        setData(next);
      } catch {
        if (stop) return;
        setLoadError("Concerts could not be loaded.");
      } finally {
        pending = false;
      }
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 1500);
    return () => {
      stop = true;
      window.clearInterval(timer);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    setBackdropFile(null);
  }, [selected]);

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
  const proof = useMemo(() => {
    return (data?.grants ?? [])
      .filter((grant) => concert && grant.concertId === concert.id && grant.source === "oidc" && grant.idToken)
      .sort((a, b) => b.issuedAt - a.issuedAt)[0];
  }, [data, concert]);

  async function createConcert(event: React.FormEvent) {
    event.preventDefault();
    setBusy("create");
    setError("");
    setAttack(null);
    const saleStartsAt = new Date(form.saleStartsAt).getTime();
    const saleEndsAt = new Date(form.saleEndsAt).getTime();
    if (!Number.isFinite(saleStartsAt) || !Number.isFinite(saleEndsAt) || saleEndsAt <= saleStartsAt) {
      setBusy("");
      setError("Sale end must be after the sale start.");
      return;
    }
    const response = await fetch("/api/concerts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, saleStartsAt, saleEndsAt }),
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
    try {
      const response = await fetch("/api/attack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ concertId: concert.id, agents: Number(agents) }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; summary?: AttackSummary };
      if (!response.ok) {
        setError(body.error || "The swarm did not finish. The stage keeps any agents that already landed.");
        return;
      }
      setAttack(body.summary ?? null);
    } catch {
      setError("The swarm did not finish. The stage keeps any agents that already landed.");
    } finally {
      setBusy("");
    }
  }

  async function uploadArt(file: File | undefined) {
    if (!concert || !file) return;
    setBusy("art");
    setError("");
    const body = new FormData();
    body.set("file", file);
    const response = await fetch(`/api/concerts/${concert.id}/art`, { method: "POST", body });
    const payload = await response.json();
    setBusy("");
    if (!response.ok) setError(payload.error || "Could not store the art.");
  }

  async function removeConcert() {
    if (!concert) return;
    if (!window.confirm(`Delete ${concert.name}?`)) return;
    setBusy("delete");
    setError("");
    const response = await fetch(`/api/concerts/${concert.id}`, { method: "DELETE" });
    const payload = await response.json();
    setBusy("");
    if (!response.ok) {
      setError(payload.error || "Could not delete the concert.");
      return;
    }
    setSelected("");
  }

  async function uploadBackdrop(file: File | undefined) {
    if (!concert || !file) return;
    if (file.size > 20_000_000) {
      setBackdropError("The video must be an mp4 or webm under 20 MB.");
      return;
    }
    const chunkSize = 3_000_000;
    const parts = Math.ceil(file.size / chunkSize);
    setBusy("backdrop");
    setBackdropError("");
    const controller = new AbortController();
    try {
      for (let part = 0; part < parts; part++) {
        setBackdropPart(`${part + 1}/${parts}`);
        const slice = file.slice(part * chunkSize, Math.min(file.size, (part + 1) * chunkSize));
        const body = new FormData();
        body.set("file", new File([slice], file.name, { type: file.type }));
        body.set("part", String(part));
        body.set("parts", String(parts));
        body.set("total", String(file.size));
        const timer = window.setTimeout(() => controller.abort(), 45_000);
        const response = await fetch(`/api/concerts/${concert.id}/backdrop`, {
          method: "POST",
          body,
          signal: controller.signal,
        }).finally(() => window.clearTimeout(timer));
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) {
          setBackdropError(payload.error || "Could not store the video.");
          return;
        }
      }
      setBackdropFile(null);
    } catch {
      setBackdropError("The upload did not finish. Use an mp4 or webm under 20 MB.");
    } finally {
      setBackdropPart("");
      setBusy("");
    }
  }

  const mcpState = !data ? "checking" : data.hosted || data.mcp ? "live" : "offline";
  const attackRunning = busy === "attack";
  const feed = [...history].reverse();
  const totalAttempts = attempts.length;

  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <img className="logo" src="/realclanker-logo.svg" alt="" width={40} height={40} />
          <div>
            <h1 suppressHydrationWarning>RealClanker</h1>
            <p>Agents may buy a ticket. Only a verified human may clear one.</p>
          </div>
        </div>
        <ol className="chain" aria-label="Trust path">
          <li>Human</li>
          <li>World ID</li>
          <li>ENS v2 agent</li>
          <li>MCP</li>
          <li>Sui ticket</li>
        </ol>
        <p className={`status ${mcpState}`} title={data?.mcpUrl ?? undefined}>
          <i />
          MCP {mcpState === "checking" ? "checking" : mcpState}
          {data?.devMode ? <span>sandbox</span> : null}
        </p>
      </header>

      {loadError && data ? <p className="error" role="alert">{loadError} Retrying…</p> : null}

      <section className="layout">
        <aside className="panel controls">
          <section className={`control-section launch-card${attackRunning ? " running" : ""}`}>
            <div className="section-heading">
              <h2>Swarm attack</h2>
              <span className="step">01</span>
            </div>
            <p className="target">
              <span>Target</span>
              <strong>{concert?.name ?? "Create a concert first"}</strong>
            </p>
            <div className="swarm-size" role="group" aria-label="Agents in the swarm">
              {["12", "24", "40"].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={agents === value ? "on" : ""}
                  aria-pressed={agents === value}
                  onClick={() => setAgents(value)}
                >
                  {value}
                </button>
              ))}
              <input
                aria-label="Custom swarm size"
                inputMode="numeric"
                placeholder="custom"
                value={["12", "24", "40"].includes(agents) ? "" : agents}
                onChange={(event) => setAgents(event.target.value)}
              />
            </div>
            <button
              className={`launch${attackRunning ? " running" : ""}`}
              type="button"
              onClick={launchAttack}
              disabled={!concert || attackRunning || (!data?.hosted && data?.mcp === false)}
            >
              <span className="launch-hazard" aria-hidden="true" />
              <span className="launch-copy">
                <strong>{attackRunning ? "Swarm in flight" : "Launch attack"}</strong>
                <small>
                  {agents || 0} agents → {concert?.name ?? "no concert"}
                </small>
              </span>
              <span className="launch-icon" aria-hidden="true">
                <SwarmIcon />
              </span>
              <span className="launch-progress" aria-hidden="true" />
            </button>
            <p className="note">
              {data?.hosted ? "A hosted attack runs up to 40 agents." : "About 20% carry a fresh grant."}
            </p>
            {attack && (attack.agents ?? 0) > 0 && (
              <ul className="result" aria-label="Last attack">
                <li className="ok"><b>{attack.PURCHASE_COMPLETE ?? 0}</b>bought</li>
                <li className="used"><b>{attack.IDENTITY_ALREADY_USED ?? 0}</b>duplicate</li>
                <li className="miss"><b>{attack.WORLD_ID_NOT_DETECTED ?? 0}</b>no ID</li>
                <li className="deny"><b>{attack.PURCHASE_DENIED ?? 0}</b>denied</li>
              </ul>
            )}
            {error && <p className="error">{error}</p>}
          </section>

          <details className="control-section setup" open={data ? data.concerts.length === 0 : false}>
            <summary className="section-heading">
              <h2>Concert setup</h2>
              <span className="step">02</span>
            </summary>
            <form onSubmit={createConcert}>
              <label>
                Name
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </label>
              <label>
                Venue
                <input value={form.venue} onChange={(event) => setForm({ ...form, venue: event.target.value })} />
              </label>
              <div className="row3">
                <label>
                  Supply
                  <input value={form.supply} onChange={(event) => setForm({ ...form, supply: event.target.value })} />
                </label>
                <label>
                  Price SUI
                  <input value={form.priceSui} onChange={(event) => setForm({ ...form, priceSui: event.target.value })} />
                </label>
                <label>
                  Max / human
                  <input value={form.maxPerHuman} onChange={(event) => setForm({ ...form, maxPerHuman: event.target.value })} />
                </label>
              </div>
              <label>
                Sale starts
                <input
                  type="datetime-local"
                  value={form.saleStartsAt}
                  onChange={(event) => setForm({ ...form, saleStartsAt: event.target.value })}
                />
              </label>
              <label>
                Sale ends
                <input
                  type="datetime-local"
                  value={form.saleEndsAt}
                  onChange={(event) => setForm({ ...form, saleEndsAt: event.target.value })}
                />
              </label>
              <button
                className="primary"
                disabled={busy === "create" || (data?.hosted === false && data.mcp === false)}
              >
                {busy === "create" ? "Creating…" : "Create concert"}
              </button>
              <div className="file-row">
                <label className={`file${!concert || busy === "backdrop" ? " off" : ""}`}>
                  <span>{backdropFile ? backdropFile.name : "Stage video…"}</span>
                  <input
                    type="file"
                    accept="video/mp4,video/webm"
                    disabled={!concert || busy === "backdrop"}
                    onChange={(event) => setBackdropFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <button
                  className="ghost"
                  type="button"
                  disabled={!concert || !backdropFile || busy === "backdrop"}
                  onClick={() => void uploadBackdrop(backdropFile ?? undefined)}
                >
                  {busy === "backdrop" ? `Uploading ${backdropPart}…` : "Upload"}
                </button>
              </div>
              {backdropError && <p className="error">{backdropError}</p>}
              <button className="ghost danger" type="button" disabled={!concert || busy === "delete"} onClick={() => void removeConcert()}>
                {busy === "delete" ? "Deleting…" : concert ? `Delete ${concert.name}` : "Delete concert"}
              </button>
            </form>
            <p className="note">
              {!data
                ? "Checking the MCP server…"
                : data.hosted
                  ? `Agents connect at ${data.mcpUrl}.`
                  : data.mcp
                    ? "MCP is live."
                    : "MCP is offline. Start pnpm dev before creating a concert."}
            </p>
          </details>
        </aside>

        <section className={`stage${attackRunning ? " armed" : ""}`}>
          {concert?.backdrop ? (
            <video
              key={`${concert.id}-${concert.backdrop.updatedAt}`}
              className="stage-video"
              src={backdropUrl(concert)}
              autoPlay
              muted
              loop
              playsInline
            />
          ) : null}
          <RaceCanvas
            key={`${concert?.id ?? "pool"}-${replay}`}
            racers={history}
            sold={concert?.sold ?? 0}
            supply={concert?.supply ?? 0}
            title={concert?.name ?? "Ticket pool"}
            armed={attackRunning}
          />
          <div className="stage-head">
            <div className="stage-title">
              <span className="eyebrow">
                <span className="signal-dot" /> Live arena
              </span>
              <h2>{concert?.name ?? "The ticket race"}</h2>
              <p>
                {concert
                  ? `${concert.venue} · ${saleStatus(concert)} · ${concert.sold}/${concert.supply} sold`
                  : "Choose a concert to watch agents race for tickets."}
              </p>
              {concert ? (
                <span className="meter" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, (concert.sold / Math.max(1, concert.supply)) * 100)}%` }} />
                </span>
              ) : null}
              <ul className="legend" aria-label="Race outcomes">
                <li className="ok">cleared</li>
                <li className="used">identity used</li>
                <li className="miss">no World ID</li>
                <li className="deny">denied</li>
              </ul>
            </div>
            <div className="stage-tools">
              <button className="replay" type="button" onClick={() => setReplay((value) => value + 1)} disabled={history.length === 0}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M2 1.8v3.4h3.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Replay
              </button>
              {concert?.art ? <ConcertArt concert={concert} className="poster" /> : null}
            </div>
          </div>
          {attackRunning ? (
            <div className="inbound" role="status">
              <i /> Swarm inbound · {agents || 0} agents
            </div>
          ) : null}
        </section>

        <aside className="panel archive">
          <section className="scoreboard" aria-label="Outcomes for this concert">
            <div className="section-heading">
              <h2>Outcomes</h2>
              <span className="step">{totalAttempts} attempts</span>
            </div>
            <div className="split" aria-hidden="true">
              {(["PURCHASE_COMPLETE", "IDENTITY_ALREADY_USED", "WORLD_ID_NOT_DETECTED", "PURCHASE_DENIED"] as const).map((key) => (
                <span key={key} className={tone(key)} style={{ flexGrow: counts[key] }} />
              ))}
            </div>
            <div className="metrics">
              <Metric value={counts.PURCHASE_COMPLETE} total={totalAttempts} label="purchased" tone="ok" />
              <Metric value={counts.IDENTITY_ALREADY_USED} total={totalAttempts} label="already used" tone="used" />
              <Metric value={counts.WORLD_ID_NOT_DETECTED} total={totalAttempts} label="undetected" tone="miss" />
              <Metric value={counts.PURCHASE_DENIED} total={totalAttempts} label="denied" tone="deny" />
            </div>
          </section>

          <div className="tabs" role="tablist" aria-label="Details">
            {(
              [
                ["feed", "Live feed", history.length],
                ["shows", "Concerts", data?.concerts.length ?? 0],
                ["proof", "Proof", proof ? 1 : 0],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "on" : ""}
                onClick={() => setTab(key)}
              >
                {label}
                {key !== "proof" ? <span>{count}</span> : count ? <span className="ok">✓</span> : null}
              </button>
            ))}
          </div>

          {tab === "feed" ? (
            history.length > 0 ? (
              <ul className="feed">
                {feed.map((attempt) => (
                  <li key={attempt.id} title={attempt.reason}>
                    <EnsHead name={attempt.ensName} />
                    <div className="feed-copy">
                      <a
                        className="feed-name"
                        href={
                          agentRecorded(data?.agents, attempt.ensName)
                            ? ensRecords(attempt.ensName)
                            : ensExplorer(attempt.ensName)
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        {attempt.ensName.replace(".realclanker.eth", "")}
                      </a>
                      <code>
                        {clock(attempt.at)}
                        {attempt.settlement === "sui" && attempt.suiObjectId ? (
                          <>
                            {" · "}
                            <a href={suiObject(attempt.suiObjectId)} target="_blank" rel="noreferrer">
                              ticket ↗
                            </a>
                          </>
                        ) : (
                          <> · {settlementLabel(attempt)}</>
                        )}
                        {attempt.suiAddress ? (
                          <>
                            {" · "}
                            <a href={suiAccount(attempt.suiAddress)} target="_blank" rel="noreferrer">
                              wallet ↗
                            </a>
                          </>
                        ) : null}
                      </code>
                    </div>
                    <em className={`badge ${tone(attempt.outcome)}`}>{badge(attempt.outcome)}</em>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="note empty">No attempts for this concert yet. Launch the swarm to fill the feed.</p>
            )
          ) : null}

          {tab === "shows" ? (
            data && data.concerts.length > 0 ? (
              <ul className="shows">
                {data.concerts.map((item) => {
                  const attemptCount = (data.attempts ?? []).filter((attempt) => attempt.concertId === item.id).length;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={item.id === concert?.id ? "active" : ""}
                        onClick={() => setSelected(item.id)}
                      >
                        {item.art ? <ConcertArt concert={item} className="thumb" /> : <span className="thumb empty" />}
                        <span className="show-copy">
                          <strong>{item.name}</strong>
                          <span>
                            {saleStatus(item)} · {item.sold}/{item.supply} · {attemptCount} attempts
                          </span>
                          <span>
                            {when(item.saleStartsAt ?? item.createdAt ?? item.saleEndsAt)} → {when(item.saleEndsAt)}
                          </span>
                          <span className="meter" aria-hidden="true">
                            <span style={{ width: `${Math.min(100, (item.sold / Math.max(1, item.supply)) * 100)}%` }} />
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="note empty">{loadError || (data ? "No concerts yet." : "Loading concerts…")}</p>
            )
          ) : null}

          {tab === "proof" ? (
            <div className="proof">
              <h3>World ID</h3>
              {proof ? (
                <>
                  <p className="verified">
                    <i /> Verified human → <b>{proof.ensName}</b>
                  </p>
                  <ExplorerLinks links={proofLinks(proof, data?.agents)} />
                  <details className="receipt-wrap">
                    <summary>ID token receipt</summary>
                    <pre className="receipt">
                      {JSON.stringify(
                        {
                          claims: proof.claims,
                          send: {
                            tool: "issue_grant",
                            ensName: proof.ensName,
                            concertId: proof.concertId,
                            maxTickets: proof.maxTickets,
                            expiresAt: proof.expiresAt,
                            idToken: proof.idToken,
                          },
                          ens: {
                            name: proof.ensName,
                            tx: data?.agents?.find((agent) => agent.ensName === proof.ensName)?.ensRecordTx,
                            records: data?.agents?.find((agent) => agent.ensName === proof.ensName)?.records,
                          },
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </>
              ) : (
                <p className="note">
                  Verify a human for this concert. World returns an ID token, and that token is what the agent sends to issue_grant.
                </p>
              )}
              <h3>Status</h3>
              {concert ? (
                <>
                  <p className="rules">
                    {concert.name} · {concert.venue} · {saleStatus(concert)} · {concert.sold}/{concert.supply} sold
                    <br />
                    {when(concert.saleStartsAt ?? concert.createdAt ?? concert.saleEndsAt)} → {when(concert.saleEndsAt)}
                  </p>
                  {concert.suiPoolId ? (
                    <ExplorerLinks links={[{ label: "Sui pool", href: suiObject(concert.suiPoolId) }]} />
                  ) : null}
                  <label className="upload">
                    {busy === "art" ? "Uploading…" : concert.art ? "Replace picture or video" : "Upload picture or video"}
                    <input
                      type="file"
                      accept="image/*,video/mp4,video/webm"
                      disabled={busy === "art"}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        void uploadArt(file);
                      }}
                    />
                  </label>
                </>
              ) : (
                <p className="note">Select a concert.</p>
              )}
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function SwarmIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path className="chev c1" d="M4 7l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path className="chev c2" d="M10 7l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path className="chev c3" d="M16 7l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Metric({ value, total, label, tone: kind }: { value: number; total: number; label: string; tone: string }) {
  const shown = useTween(value);
  const share = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className={`metric ${kind}`}>
      <strong key={value}>{shown}</strong>
      <span>
        <i />
        {label}
      </span>
      <small>{share}%</small>
    </div>
  );
}

function useTween(value: number) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    const from = current.current;
    if (from === value) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 650);
      const next = Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3)));
      current.current = next;
      setShown(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

function badge(outcome: Outcome) {
  if (outcome === "PURCHASE_COMPLETE") return "Bought";
  if (outcome === "IDENTITY_ALREADY_USED") return "Duplicate";
  if (outcome === "WORLD_ID_NOT_DETECTED") return "No ID";
  return "Denied";
}


function EnsHead({ name }: { name: string }) {
  return (
    <svg className="ens-head" viewBox="0 0 128 128" aria-hidden="true">
      <circle cx="64" cy="64" r="64" fill={ensColor(name)} />
      {ENS_MARK_PATHS.map((path) => (
        <path key={path.slice(0, 24)} d={path} fill="#f7f4ee" />
      ))}
    </svg>
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

function when(at: number) {
  return new Date(at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function saleStatus(concert: Concert) {
  const now = Date.now();
  const start = concert.saleStartsAt ?? concert.createdAt ?? 0;
  if (now < start) return "upcoming";
  if (now > concert.saleEndsAt) return "ended";
  return "on sale";
}

function artUrl(concert: Concert) {
  return `/api/concerts/${concert.id}/art?v=${concert.art?.updatedAt ?? 0}`;
}

function backdropUrl(concert: Concert) {
  return `/api/concerts/${concert.id}/backdrop?v=${concert.backdrop?.updatedAt ?? 0}`;
}

function ConcertArt({ concert, className }: { concert: Concert; className: string }) {
  if (!concert.art) return null;
  if (concert.art.kind === "video") {
    return <video className={className} src={artUrl(concert)} controls={className === "poster"} muted playsInline />;
  }
  return <img className={className} src={artUrl(concert)} alt="" />;
}

function clock(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ExplorerLinks({ links }: { links: { label: string; href: string }[] }) {
  if (links.length === 0) return null;
  return (
    <p className="links">
      {links.map((link) => (
        <a key={link.href + link.label} href={link.href} target="_blank" rel="noreferrer">
          {link.label}
        </a>
      ))}
    </p>
  );
}

function proofLinks(
  proof: Grant,
  agents: Snapshot["agents"] | undefined,
): { label: string; href: string }[] {
  const agent = agents?.find((item) => item.ensName === proof.ensName);
  const links = [{ label: "ENS name", href: ensExplorer(proof.ensName) }];
  if (agent?.ensRecordTx || agent?.chainWrite === "written") {
    links.push({ label: "ENS identity", href: ensRecords(proof.ensName) });
  }
  if (agent?.ensMintTx) links.push({ label: "ENS mint", href: sepoliaTx(agent.ensMintTx) });
  if (agent?.ensRecordTx) links.push({ label: "ENS record", href: sepoliaTx(agent.ensRecordTx) });
  if (agent?.evmAddress) links.push({ label: "EVM wallet", href: sepoliaAddress(agent.evmAddress) });
  if (agent?.suiAddress) links.push({ label: "Sui wallet", href: suiAccount(agent.suiAddress) });
  return links;
}

function ensExplorer(name: string) {
  return `https://explorer.ens.dev/${name}`;
}

function ensRecords(name: string) {
  return `https://explorer.ens.dev/${name}/records`;
}

function agentRecorded(agents: Snapshot["agents"] | undefined, ensName: string) {
  const agent = agents?.find((item) => item.ensName === ensName);
  return Boolean(agent?.ensRecordTx || agent?.chainWrite === "written");
}

function sepoliaTx(hash: string) {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

function sepoliaAddress(address: string) {
  return `https://sepolia.etherscan.io/address/${address}`;
}

function suiObject(id: string) {
  return `https://suiscan.xyz/devnet/object/${id}`;
}

function suiAccount(address: string) {
  return `https://suiscan.xyz/devnet/account/${address}`;
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

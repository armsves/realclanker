"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [ensName, setEnsName] = useState("my-agent.eth");
  const [agents, setAgents] = useState("40");
  const [backdropFile, setBackdropFile] = useState<File | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [attack, setAttack] = useState<AttackSummary | null>(null);
  const [mintNote, setMintNote] = useState("");
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    let stop = false;
    const pull = async () => {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (stop) return;
      if (!response.ok) {
        setLoadError("Concerts could not be loaded.");
        return;
      }
      const next = (await response.json()) as Snapshot;
      setLoadError("");
      setData(next);
    };
    void pull();
    const timer = window.setInterval(() => void pull(), 1500);
    return () => {
      stop = true;
      window.clearInterval(timer);
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
    setBusy("backdrop");
    setError("");
    const body = new FormData();
    body.set("file", file);
    const response = await fetch(`/api/concerts/${concert.id}/backdrop`, { method: "POST", body });
    const payload = await response.json();
    setBusy("");
    if (!response.ok) setError(payload.error || "Could not store the video.");
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
            <label>
              Max / human
              <input value={form.maxPerHuman} onChange={(event) => setForm({ ...form, maxPerHuman: event.target.value })} />
            </label>
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
            <label>
              Background video
              <input
                type="file"
                accept="video/mp4,video/webm"
                disabled={!concert || busy === "backdrop"}
                onChange={(event) => setBackdropFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <div className="actions">
              <button
                className="ghost"
                type="button"
                disabled={!concert || !backdropFile || busy === "backdrop"}
                onClick={() => void uploadBackdrop(backdropFile ?? undefined)}
              >
                {busy === "backdrop" ? "Uploading…" : "Upload video"}
              </button>
              <button
                className="primary"
                disabled={busy === "create" || (data?.hosted === false && data.mcp === false)}
              >
                {busy === "create" ? "Creating…" : "Create concert"}
              </button>
              <button className="ghost" type="button" disabled={!concert || busy === "delete"} onClick={() => void removeConcert()}>
                {busy === "delete" ? "Deleting…" : concert ? `Delete ${concert.name}` : "Delete concert"}
              </button>
            </div>
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
            The platform wallet pays Sepolia gas. A grant is one human, this show, one ticket.
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
              ? "A hosted attack runs up to 40 agents."
              : "About 20% carry a fresh grant."}
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
          <button className="replay" type="button" onClick={() => setReplay((value) => value + 1)} disabled={history.length === 0}>
            Replay purchases
          </button>
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
          />
          {concert?.art ? <ConcertArt concert={concert} className="poster" /> : null}
        </section>

        <aside className="panel archive">
          <h2>Concerts</h2>
          {data && data.concerts.length > 0 ? (
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
                      {item.art ? (
                        <ConcertArt concert={item} className="thumb" />
                      ) : (
                        <span className="thumb empty" />
                      )}
                      <span className="show-copy">
                        <strong>{item.name}</strong>
                        <span>
                          {saleStatus(item)} · {item.sold}/{item.supply} · {attemptCount} attempts
                        </span>
                        <span>
                          {when(item.saleStartsAt ?? item.createdAt ?? item.saleEndsAt)} → {when(item.saleEndsAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="note">{loadError || (data ? "No concerts yet." : "Loading concerts…")}</p>
          )}
          <h2>World ID</h2>
          {proof ? (
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
          ) : (
            <p className="note">
              Verify a human for this concert. World returns an ID token, and that token is what the agent sends to issue_grant.
            </p>
          )}
          {proof ? <ExplorerLinks links={proofLinks(proof, data?.agents)} /> : null}
          <h2>Status</h2>
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
          <div className="counts">
            <div><strong>{counts.PURCHASE_COMPLETE}</strong><span className="ok">purchased</span></div>
            <div><strong>{counts.IDENTITY_ALREADY_USED}</strong><span className="used">already used</span></div>
            <div><strong>{counts.WORLD_ID_NOT_DETECTED}</strong><span className="miss">undetected</span></div>
            <div><strong>{counts.PURCHASE_DENIED}</strong><span className="deny">denied</span></div>
          </div>
          <h2>History</h2>
          {history.length > 0 ? (
            <ul className="feed">
              {history.map((attempt, index) => (
                <li key={attempt.id}>
                  <EnsHead name={attempt.ensName} />
                  <div>
                    <strong>
                      {index + 1}.{" "}
                      <a
                        href={
                          agentRecorded(data?.agents, attempt.ensName)
                            ? ensRecords(attempt.ensName)
                            : ensExplorer(attempt.ensName)
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        {attempt.ensName}
                      </a>
                    </strong>
                    <em className={tone(attempt.outcome)}>{attempt.outcome}</em>
                    <p>{attempt.reason}</p>
                    <code>
                      {clock(attempt.at)}
                      {attempt.settlement === "sui" && attempt.suiObjectId ? (
                        <>
                          {" · "}
                          <a href={suiObject(attempt.suiObjectId)} target="_blank" rel="noreferrer">
                            ticket
                          </a>
                        </>
                      ) : (
                        <> · {settlementLabel(attempt)}</>
                      )}
                      {attempt.suiAddress ? (
                        <>
                          {" · "}
                          <a href={suiAccount(attempt.suiAddress)} target="_blank" rel="noreferrer">
                            wallet
                          </a>
                        </>
                      ) : null}
                    </code>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">No attempts for this concert.</p>
          )}
        </aside>
      </section>
    </main>
  );
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

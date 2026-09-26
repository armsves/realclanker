"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ENS_MARK_PATHS, ensColor } from "./ensMark";

type Outcome =
  | "PURCHASE_COMPLETE"
  | "IDENTITY_ALREADY_USED"
  | "WORLD_ID_NOT_DETECTED"
  | "PURCHASE_DENIED";

export type Racer = {
  id: string;
  ensName: string;
  avatarUrl: string;
  outcome: Outcome;
};

type Phase = "approach" | "scan" | "enter" | "recoil" | "haul" | "gone";

type Point = { x: number; y: number };

type Swimmer = Racer & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  wobble: number;
  speed: number;
  scale: number;
  phase: Phase;
  t: number;
  gate: number;
  slot: number;
  judged: boolean;
  trail: Point[];
  from: Point;
  ctrl: Point;
  to: Point;
  span: number;
};

type Fx =
  | { kind: "spawn"; x: number; y: number; t: number; life: number }
  | { kind: "impact"; angle: number; t: number; life: number; color: string }
  | { kind: "ring"; from: number; to: number; t: number; life: number; color: string; width: number; delay: number }
  | { kind: "spark"; x: number; y: number; vx: number; vy: number; t: number; life: number; color: string }
  | { kind: "tag"; x: number; y: number; w: number; t: number; life: number; color: string; text: string };

type Arena = { x: number; y: number; r: number; shield: number; floor: number; width: number };

export const COLOR: Record<Outcome, string> = {
  PURCHASE_COMPLETE: "#5ee0a0",
  IDENTITY_ALREADY_USED: "#ffa24a",
  WORLD_ID_NOT_DETECTED: "#8ab4ff",
  PURCHASE_DENIED: "#ff4d67",
};

const VERDICT: Record<Outcome, string> = {
  PURCHASE_COMPLETE: "CLEARED",
  IDENTITY_ALREADY_USED: "DUPLICATE HUMAN",
  WORLD_ID_NOT_DETECTED: "NO WORLD ID",
  PURCHASE_DENIED: "DENIED",
};

const GOLD = "#f0b429";
const INK = "244, 239, 232";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const SCAN_MS = 540;
const ENTER_MS = 560;
const RECOIL_MS = 360;

export const WORLD_MARK_PATH =
  "M53.9 4.8C48.4 1.6 42.4 0 35.9 0C29.4 0 23.4 1.6 17.9 4.8C12.4 8 8 12.4 4.8 17.9C1.6 23.4 0 29.4 0 35.9C0 42.4 1.6 48.4 4.8 53.9C8 59.4 12.4 63.8 17.9 67C23.4 70.2 29.4 71.8 35.9 71.8C42.4 71.8 48.4 70.2 53.9 67C59.4 63.8 63.8 59.4 67 53.9C70.2 48.4 71.8 42.4 71.8 35.9C71.8 29.4 70.2 23.4 67 17.9C63.8 12.4 59.4 8 53.9 4.8ZM38.1 48.9C34 48.9 30.8 47.7 28.3 45.4C26.6 43.8 25.5 41.9 25 39.6H63.8C63.4 42.9 62.4 46 61 48.9H38.2H38.1ZM25 32.3C25.5 30.1 26.6 28.1 28.3 26.5C30.8 24.2 34 23 38.1 23H61C62.5 25.9 63.4 29 63.8 32.3H25ZM11.6 21.6C14.1 17.3 17.5 13.8 21.8 11.3C26.1 8.8 30.8 7.5 36 7.5C41.2 7.5 45.9 8.8 50.2 11.3C52.4 12.6 54.3 14.1 56.1 15.9H38C33.9 15.9 30.2 16.8 27 18.5C23.8 20.2 21.3 22.6 19.6 25.6C18.4 27.7 17.6 30 17.2 32.4H8.3C8.7 28.6 9.9 25 11.8 21.7L11.6 21.6ZM50.1 60.5C45.8 63 41.1 64.3 35.9 64.3C30.7 64.3 26 63 21.7 60.5C17.4 58 14 54.5 11.5 50.2C9.6 46.9 8.4 43.4 8 39.6H16.9C17.3 42 18.1 44.3 19.3 46.4C21.1 49.4 23.6 51.7 26.7 53.5C29.9 55.2 33.6 56.1 37.7 56.1H55.7C54 57.8 52.1 59.3 50 60.5H50.1Z";

export function RaceCanvas({
  racers,
  sold,
  supply,
  title,
  armed = false,
}: {
  racers: Racer[];
  sold: number;
  supply: number;
  title: string;
  armed?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const jailRef = useRef<HTMLElement>(null);
  const racersRef = useRef(racers);
  racersRef.current = racers;
  const cleared = racers.filter((racer) => racer.outcome === "PURCHASE_COMPLETE").length;
  const meta = useRef({ sold, supply, title, armed, cleared });
  meta.current = { sold, supply, title, armed, cleared };

  const [landed, setLanded] = useState<string[]>([]);
  const land = useCallback((id: string) => {
    setLanded((prev) => (prev.includes(id) ? prev : [id, ...prev]));
  }, []);
  const landRef = useRef(land);
  landRef.current = land;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const swimmers: Swimmer[] = [];
    const fx: Fx[] = [];
    const known = new Set<string>();
    const litAt: number[] = [];
    const timers: number[] = [];
    let entered = 0;
    let frame = 0;
    let last = performance.now();
    let sweep = -Math.PI / 2;
    let heat = 0;
    let kick = 0;
    let wasArmed = false;
    let spawned = 0;

    const size = () => {
      const rect = canvas.getBoundingClientRect();
      const floor = jailRef.current ? jailRef.current.offsetTop : rect.height;
      return { width: Math.max(1, rect.width), height: Math.max(1, rect.height), floor };
    };

    const spawn = (racer: Racer) => {
      const { width, height, floor } = size();
      const arena = layout(width, height, floor);
      const slot = spawned;
      spawned += 1;
      const start = spawnPoint(arena, slot);
      swimmers.push({
        ...racer,
        x: start.x,
        y: start.y,
        vx: 0,
        vy: 0,
        angle: start.angle,
        wobble: Math.random() * Math.PI * 2,
        speed: 0.085 + ((slot * 37) % 13) * 0.0042,
        scale: 0,
        phase: "approach",
        t: 0,
        gate: 0,
        slot,
        judged: false,
        trail: [],
        from: { x: 0, y: 0 },
        ctrl: { x: 0, y: 0 },
        to: { x: 0, y: 0 },
        span: 0,
      });
      fx.push({ kind: "spawn", x: start.x, y: start.y, t: 0, life: 520 });
    };

    const watch = window.setInterval(() => {
      const fresh = racersRef.current.filter((racer) => !known.has(racer.id));
      fresh.forEach((racer, index) => {
        known.add(racer.id);
        timers.push(window.setTimeout(() => spawn(racer), index * 140));
      });
    }, 200);

    const judge = (s: Swimmer, arena: Arena, now: number) => {
      s.judged = true;
      const color = COLOR[s.outcome];
      const hitX = arena.x + Math.cos(s.gate) * arena.shield;
      const hitY = arena.y + Math.sin(s.gate) * arena.shield;
      fx.push({ kind: "impact", angle: s.gate, t: 0, life: 760, color });
      if (s.outcome === "PURCHASE_COMPLETE") {
        s.phase = "enter";
        s.t = 0;
        s.from = { x: s.x, y: s.y };
        return;
      }
      heat = Math.min(1, heat + 0.34);
      s.phase = "recoil";
      s.t = 0;
      s.vx = Math.cos(s.gate) * 0.36;
      s.vy = Math.sin(s.gate) * 0.36;
      if (!reduced) {
        for (let index = 0; index < 7; index += 1) {
          const spread = s.gate + (Math.random() - 0.5) * 1.5;
          const speed = 0.08 + Math.random() * 0.22;
          fx.push({
            kind: "spark",
            x: hitX,
            y: hitY,
            vx: Math.cos(spread) * speed,
            vy: Math.sin(spread) * speed,
            t: 0,
            life: 380 + Math.random() * 260,
            color,
          });
        }
      }
      ctx.font = `600 9px ${MONO}`;
      setSpacing(ctx, "0.14em");
      const text = VERDICT[s.outcome];
      const w = ctx.measureText(text).width + 14;
      setSpacing(ctx, "0px");
      const countBox = { x: arena.x - 70, y: arena.y + arena.shield + 14, w: 140, h: 36 };
      const live = fx.filter((item): item is Extract<Fx, { kind: "tag" }> => item.kind === "tag" && item.t < item.life * 0.85);
      for (const out of [30, 60, 92]) {
        const x = hitX + Math.cos(s.gate) * out;
        const y = hitY + Math.sin(s.gate) * out;
        const box = { x: x - w / 2 - 4, y: y - 30, w: w + 8, h: 42 };
        if (overlap(box, countBox)) continue;
        if (live.some((item) => overlap(box, { x: item.x - item.w / 2, y: item.y - 30, w: item.w, h: 42 }))) continue;
        fx.push({ kind: "tag", x, y, w, t: 0, life: 1100, color, text });
        break;
      }
      void now;
    };

    const step = (s: Swimmer, arena: Arena, dt: number, now: number) => {
      s.t += dt;
      s.wobble += dt * 0.006;
      if (s.phase !== "gone") {
        s.trail.push({ x: s.x, y: s.y });
        if (s.trail.length > 18) s.trail.shift();
      }
      if (s.phase === "approach") {
        s.scale = Math.min(1, s.scale + dt / 260);
        const dx = arena.x - s.x;
        const dy = arena.y - s.y;
        const dist = Math.hypot(dx, dy) || 1;
        const target = Math.atan2(dy, dx) + Math.sin(s.wobble) * 0.32 * Math.min(1, dist / 220);
        s.angle = lerpAngle(s.angle, target, Math.min(1, 0.05 * (dt / 16)));
        const surge = 1 + Math.max(0, 1 - dist / 260) * 0.6;
        s.x += Math.cos(s.angle) * s.speed * surge * dt;
        s.y += Math.sin(s.angle) * s.speed * surge * dt;
        if (dist <= arena.shield + 16) {
          s.phase = "scan";
          s.t = 0;
          s.gate = Math.atan2(s.y - arena.y, s.x - arena.x);
          s.from = { x: s.x, y: s.y };
        }
      } else if (s.phase === "scan") {
        const hold = arena.shield + 16;
        const p = easeOut(Math.min(1, s.t / 180));
        s.x = lerp(s.from.x, arena.x + Math.cos(s.gate) * hold, p);
        s.y = lerp(s.from.y, arena.y + Math.sin(s.gate) * hold, p);
        if (s.t >= SCAN_MS) judge(s, arena, now);
      } else if (s.phase === "enter") {
        const p = Math.min(1, s.t / ENTER_MS);
        const e = easeInCubic(p);
        s.x = lerp(s.from.x, arena.x, e);
        s.y = lerp(s.from.y, arena.y, e);
        s.scale = 1 - e * 0.85;
        if (p >= 1) {
          s.phase = "gone";
          entered += 1;
          litAt.push(now);
          kick = 1;
          fx.push({ kind: "ring", from: arena.r * 0.7, to: arena.shield + 34, t: 0, life: 720, color: GOLD, width: 2, delay: 0 });
          if (!reduced) {
            for (let index = 0; index < 12; index += 1) {
              const angle = (index / 12) * Math.PI * 2 + Math.random() * 0.3;
              const speed = 0.1 + Math.random() * 0.14;
              fx.push({
                kind: "spark",
                x: arena.x + Math.cos(angle) * arena.r * 0.6,
                y: arena.y + Math.sin(angle) * arena.r * 0.6,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                t: 0,
                life: 520 + Math.random() * 300,
                color: index % 3 === 0 ? COLOR.PURCHASE_COMPLETE : GOLD,
              });
            }
          }
          fx.push({ kind: "tag", x: arena.x, y: arena.y - arena.r - 8, w: 80, t: 0, life: 1150, color: GOLD, text: "+1 TICKET" });
        }
      } else if (s.phase === "recoil") {
        const damp = Math.pow(0.9, dt / 16);
        s.vx *= damp;
        s.vy *= damp;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.t >= RECOIL_MS) {
          s.phase = "haul";
          s.t = 0;
          s.from = { x: s.x, y: s.y };
          const lane = 0.16 + (((s.slot * 7919) % 97) / 97) * 0.68;
          s.to = { x: arena.width * lane, y: arena.floor + 34 };
          const outward = s.x < arena.x ? -1 : 1;
          s.ctrl = {
            x: s.from.x + outward * Math.min(120, Math.abs(s.from.x - arena.x) * 0.5 + 40),
            y: Math.min(s.from.y, s.to.y) - 30,
          };
          s.span = 760 + Math.min(520, Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y) * 1.1);
        }
      } else if (s.phase === "haul") {
        const p = Math.min(1, s.t / s.span);
        const e = easeInOutCubic(p);
        const q = quad(s.from, s.ctrl, s.to, e);
        s.x = q.x;
        s.y = q.y;
        s.scale = 1 - e * 0.35;
        if (p >= 1) {
          s.phase = "gone";
          landRef.current(s.id);
        }
      }
    };

    const draw = (now: number) => {
      const dt = Math.min(34, now - last);
      last = now;
      const { width, height, floor } = size();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const arena = layout(width, height, floor);
      const { armed: isArmed, sold: soldNow, supply: total, cleared: clearedRacers } = meta.current;
      const inFlight = swimmers.some((s) => s.phase !== "gone");
      const hot = isArmed || inFlight;

      if (isArmed && !wasArmed && !reduced) {
        const reach = Math.hypot(width, height);
        fx.push({ kind: "ring", from: arena.shield, to: reach, t: 0, life: 1500, color: "#ff4d67", width: 1.5, delay: 0 });
        fx.push({ kind: "ring", from: arena.shield, to: reach, t: 0, life: 1500, color: GOLD, width: 1, delay: 220 });
      }
      wasArmed = isArmed;

      heat = Math.max(0, heat - dt * 0.0011);
      kick = Math.max(0, kick - dt * 0.0024);
      if (!reduced) sweep += dt * (hot ? 0.0021 : 0.00045);

      paintRadar(ctx, arena, sweep, hot, reduced);
      paintShield(ctx, arena, now, hot, heat);

      const base = Math.max(0, soldNow - clearedRacers);
      const lit = Math.min(total, base + entered);
      paintSupply(ctx, arena, total, lit, litAt, base, now);
      paintCore(ctx, arena, kick, now);
      paintCount(ctx, arena, lit, total);

      for (const s of swimmers) step(s, arena, dt, now);
      for (let index = swimmers.length - 1; index >= 0; index -= 1) {
        const s = swimmers[index];
        if (s.phase === "gone") {
          s.trail.shift();
          if (s.trail.length === 0) swimmers.splice(index, 1);
        }
      }

      for (const s of swimmers) paintTrail(ctx, s);
      paintFx(ctx, fx, arena, dt, "under");
      for (const s of swimmers) if (s.phase !== "gone") paintAgent(ctx, s, now);
      paintLabels(ctx, swimmers, arena);
      paintFx(ctx, fx, arena, dt, "over");

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(watch);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  const byId = useMemo(() => new Map(racers.map((racer) => [racer.id, racer])), [racers]);
  const jailed = landed.map((id) => byId.get(id)).filter((racer): racer is Racer => Boolean(racer));
  const tally = {
    used: jailed.filter((racer) => racer.outcome === "IDENTITY_ALREADY_USED").length,
    miss: jailed.filter((racer) => racer.outcome === "WORLD_ID_NOT_DETECTED").length,
    deny: jailed.filter((racer) => racer.outcome === "PURCHASE_DENIED").length,
  };

  return (
    <>
      <canvas ref={canvasRef} aria-label="Agents racing toward the ticket pool" />
      <aside ref={jailRef} className={`stage-jail${jailed.length > 0 ? " occupied" : ""}`}>
        <span key={jailed.length} className="jail-flash" aria-hidden="true" />
        <header>
          <div className="jail-title">
            <JailBars />
            <h3>Jail</h3>
            <b>{jailed.length}</b>
          </div>
          <ul className="jail-tally">
            <li className="used">
              <i /> duplicate <b>{tally.used}</b>
            </li>
            <li className="miss">
              <i /> no grant <b>{tally.miss}</b>
            </li>
            <li className="deny">
              <i /> denied <b>{tally.deny}</b>
            </li>
          </ul>
        </header>
        {jailed.length === 0 ? (
          <p className="empty">Empty. Agents without a live World ID grant are hauled here.</p>
        ) : (
          <ul className="jail-cells">
            {jailed.map((racer) => (
              <li key={racer.id}>
                <a
                  className={jailTone(racer.outcome)}
                  href={ensExplorer(racer.ensName)}
                  target="_blank"
                  rel="noreferrer"
                  title={`${racer.ensName} · ${jailReason(racer.outcome)}`}
                >
                  <MiniMark name={racer.ensName} />
                  <span className="jail-name">{shortName(racer.ensName)}</span>
                  <span className="jail-why">{jailReason(racer.outcome)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </>
  );
}

function JailBars() {
  return (
    <svg className="jail-bars" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 2v12M8 2v12M10.5 2v12" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function MiniMark({ name }: { name: string }) {
  return (
    <svg className="jail-mark" viewBox="0 0 128 128" aria-hidden="true">
      <circle cx="64" cy="64" r="64" fill={ensColor(name)} />
      {ENS_MARK_PATHS.map((path) => (
        <path key={path.slice(0, 24)} d={path} fill="#f7f4ee" />
      ))}
    </svg>
  );
}

function shortName(name: string) {
  return name.replace(".realclanker.eth", "");
}

function ensExplorer(name: string) {
  return `https://explorer.ens.dev/${name}`;
}

function jailReason(outcome: Outcome) {
  if (outcome === "IDENTITY_ALREADY_USED") return "duplicate";
  if (outcome === "WORLD_ID_NOT_DETECTED") return "no grant";
  return "denied";
}

function jailTone(outcome: Outcome) {
  if (outcome === "IDENTITY_ALREADY_USED") return "used";
  if (outcome === "WORLD_ID_NOT_DETECTED") return "miss";
  return "deny";
}

function layout(width: number, height: number, floor: number): Arena {
  const bottom = Math.max(220, Math.min(height, floor) - 14);
  const r = clamp(Math.min(width * 0.075, bottom * 0.105), 34, 64);
  const shield = r + 44;
  return {
    x: width * 0.5,
    y: Math.max(shield + 96, bottom * 0.54),
    r,
    shield,
    floor: Math.min(height, floor),
    width,
  };
}

function spawnPoint(arena: Arena, index: number) {
  const outward = index * 2.399963229728653 - Math.PI / 2;
  const ux = Math.cos(outward);
  const uy = Math.sin(outward);
  const minX = 14;
  const maxX = arena.width - 14;
  const minY = 14;
  const maxY = arena.floor - 18;
  let reach = Number.POSITIVE_INFINITY;
  if (ux > 0.02) reach = Math.min(reach, (maxX - arena.x) / ux);
  if (ux < -0.02) reach = Math.min(reach, (minX - arena.x) / ux);
  if (uy > 0.02) reach = Math.min(reach, (maxY - arena.y) / uy);
  if (uy < -0.02) reach = Math.min(reach, (minY - arena.y) / uy);
  const dist = Math.max(arena.shield + 70, reach - 8 - ((index * 13) % 5) * 6);
  const jitter = ((index * 17) % 11) - 5;
  return {
    x: arena.x + ux * dist - uy * jitter * 3,
    y: arena.y + uy * dist + ux * jitter * 3,
    angle: Math.atan2(-uy, -ux),
  };
}

function paintRadar(ctx: CanvasRenderingContext2D, a: Arena, sweep: number, hot: boolean, reduced: boolean) {
  ctx.save();
  const glow = ctx.createRadialGradient(a.x, a.y, a.r * 0.4, a.x, a.y, a.shield * 3.2);
  glow.addColorStop(0, "rgba(240, 180, 41, 0.10)");
  glow.addColorStop(0.45, "rgba(240, 180, 41, 0.035)");
  glow.addColorStop(1, "rgba(240, 180, 41, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(a.x - a.shield * 3.2, a.y - a.shield * 3.2, a.shield * 6.4, a.shield * 6.4);

  const rings = [a.shield * 1.75, a.shield * 2.6, a.shield * 3.5];
  ctx.lineWidth = 1;
  rings.forEach((radius, index) => {
    ctx.strokeStyle = `rgba(${INK}, ${0.065 - index * 0.015})`;
    ctx.setLineDash(index === 0 ? [] : [2, 6]);
    ctx.beginPath();
    ctx.arc(a.x, a.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  const tick = rings[0];
  for (let index = 0; index < 72; index += 1) {
    const angle = (index / 72) * Math.PI * 2;
    const major = index % 6 === 0;
    const len = major ? 7 : 3;
    ctx.strokeStyle = `rgba(${INK}, ${major ? 0.16 : 0.07})`;
    ctx.beginPath();
    ctx.moveTo(a.x + Math.cos(angle) * tick, a.y + Math.sin(angle) * tick);
    ctx.lineTo(a.x + Math.cos(angle) * (tick + len), a.y + Math.sin(angle) * (tick + len));
    ctx.stroke();
  }

  if (!reduced && "createConicGradient" in ctx) {
    const reach = rings[2];
    const cone = ctx.createConicGradient(sweep, a.x, a.y);
    const tint = hot ? "255, 77, 103" : "240, 180, 41";
    cone.addColorStop(0, `rgba(${tint}, 0)`);
    cone.addColorStop(0.88, `rgba(${tint}, 0)`);
    cone.addColorStop(1, `rgba(${tint}, ${hot ? 0.08 : 0.05})`);
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.arc(a.x, a.y, reach, 0, Math.PI * 2);
    ctx.arc(a.x, a.y, a.shield, 0, Math.PI * 2, true);
    ctx.fill();
    ctx.strokeStyle = `rgba(${tint}, ${hot ? 0.3 : 0.14})`;
    ctx.beginPath();
    ctx.moveTo(a.x + Math.cos(sweep) * a.shield, a.y + Math.sin(sweep) * a.shield);
    ctx.lineTo(a.x + Math.cos(sweep) * reach, a.y + Math.sin(sweep) * reach);
    ctx.stroke();
  }
  ctx.restore();
}

function paintShield(ctx: CanvasRenderingContext2D, a: Arena, now: number, hot: boolean, heat: number) {
  ctx.save();
  const breathe = 0.5 + Math.sin(now * 0.002) * 0.5;
  if (heat > 0.01) {
    ctx.shadowColor = `rgba(255, 77, 103, ${0.7 * heat})`;
    ctx.shadowBlur = 18 * heat;
  }
  ctx.strokeStyle = heat > 0.01
    ? `rgba(255, ${Math.round(140 - 60 * heat)}, ${Math.round(150 - 40 * heat)}, ${0.3 + heat * 0.5})`
    : `rgba(${INK}, ${0.2 + breathe * 0.06})`;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  ctx.arc(a.x, a.y, a.shield, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.setLineDash([1.5, 9]);
  ctx.lineDashOffset = -now * (hot ? 0.03 : 0.008);
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.strokeStyle = hot ? "rgba(240, 180, 41, 0.55)" : `rgba(${INK}, 0.22)`;
  ctx.beginPath();
  ctx.arc(a.x, a.y, a.shield + 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = `500 8.5px ${MONO}`;
  ctx.fillStyle = `rgba(${INK}, 0.34)`;
  ctx.textAlign = "center";
  setSpacing(ctx, "0.22em");
  ctx.fillText("WORLD ID GATE", a.x, a.y - a.shield - 16);
  setSpacing(ctx, "0px");
  ctx.restore();
}

function paintSupply(
  ctx: CanvasRenderingContext2D,
  a: Arena,
  total: number,
  lit: number,
  litAt: number[],
  base: number,
  now: number,
) {
  ctx.save();
  const radius = a.r + 17;
  ctx.lineWidth = 5;
  ctx.lineCap = "butt";
  if (total <= 0) {
    ctx.strokeStyle = `rgba(${INK}, 0.08)`;
    ctx.beginPath();
    ctx.arc(a.x, a.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const count = Math.min(total, 96);
  const per = total / count;
  const slice = (Math.PI * 2) / count;
  const gap = Math.min(0.07, slice * 0.22);
  for (let index = 0; index < count; index += 1) {
    const start = -Math.PI / 2 + index * slice + gap / 2;
    const end = start + slice - gap;
    const filled = (index + 1) * per <= lit + 0.001;
    const order = Math.floor((index + 1) * per) - base - 1;
    const age = filled && order >= 0 && litAt[order] ? now - litAt[order] : Number.POSITIVE_INFINITY;
    const flash = age < 700 ? 1 - age / 700 : 0;
    ctx.strokeStyle = filled ? GOLD : `rgba(${INK}, 0.09)`;
    ctx.lineWidth = 5 + flash * 4;
    if (flash > 0) {
      ctx.shadowColor = "rgba(255, 214, 120, 0.9)";
      ctx.shadowBlur = 16 * flash;
    }
    ctx.beginPath();
    ctx.arc(a.x, a.y, radius, start, end);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function paintCore(ctx: CanvasRenderingContext2D, a: Arena, kick: number, now: number) {
  ctx.save();
  const pulse = 1 + Math.sin(now * 0.0018) * 0.012 + easeOut(kick) * 0.08;
  ctx.fillStyle = "#0e0c0a";
  ctx.beginPath();
  ctx.arc(a.x, a.y, a.r + 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(${INK}, 0.08)`;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (kick > 0) {
    ctx.shadowColor = `rgba(240, 180, 41, ${0.8 * kick})`;
    ctx.shadowBlur = 28 * kick;
  }
  const size = a.r * 1.5 * pulse;
  const scale = size / 71.8;
  ctx.translate(a.x, a.y);
  ctx.scale(scale, scale);
  ctx.translate(-35.9, -35.9);
  ctx.fillStyle = "#f7f4ee";
  ctx.fill(new Path2D(WORLD_MARK_PATH));
  ctx.restore();
}

function paintCount(ctx: CanvasRenderingContext2D, a: Arena, lit: number, total: number) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const y = a.y + a.shield + 34;
  const left = String(lit);
  const right = ` / ${total}`;
  ctx.font = `500 17px ${MONO}`;
  const lw = ctx.measureText(left).width;
  const rw = ctx.measureText(right).width;
  const start = a.x - (lw + rw) / 2;
  ctx.textAlign = "left";
  ctx.fillStyle = GOLD;
  ctx.fillText(left, start, y);
  ctx.fillStyle = `rgba(${INK}, 0.5)`;
  ctx.fillText(right, start + lw, y);
  ctx.textAlign = "center";
  ctx.font = `500 8.5px ${MONO}`;
  setSpacing(ctx, "0.22em");
  ctx.fillStyle = `rgba(${INK}, 0.36)`;
  ctx.fillText("TICKETS CLEARED", a.x, y + 15);
  ctx.restore();
}

function paintTrail(ctx: CanvasRenderingContext2D, s: Swimmer) {
  const points = s.trail;
  if (points.length < 2) return;
  const tint = s.judged ? hexToRgb(COLOR[s.outcome]) : INK;
  const strength = s.judged ? 0.55 : 0.22;
  ctx.save();
  ctx.lineCap = "round";
  for (let index = 1; index < points.length; index += 1) {
    const k = index / points.length;
    ctx.strokeStyle = `rgba(${tint}, ${k * k * strength})`;
    ctx.lineWidth = 0.6 + k * 2.4 * Math.max(0.4, s.scale);
    ctx.beginPath();
    ctx.moveTo(points[index - 1].x, points[index - 1].y);
    ctx.lineTo(points[index].x, points[index].y);
    ctx.stroke();
  }
  ctx.restore();
}

function paintAgent(ctx: CanvasRenderingContext2D, s: Swimmer, now: number) {
  const radius = 10 * easeOutBack(Math.min(1, s.scale));
  if (radius <= 0.3) return;
  const color = COLOR[s.outcome];
  ctx.save();
  ctx.translate(s.x, s.y);

  if (s.judged && s.outcome !== "PURCHASE_COMPLETE") {
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
  }
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = ensColor(s.ensName);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.save();
  ctx.clip();
  const mark = (radius * 2) / 128;
  ctx.scale(mark, mark);
  ctx.translate(-64, -64);
  ctx.fillStyle = "#f7f4ee";
  for (const path of ENS_MARK_PATHS) ctx.fill(new Path2D(path));
  ctx.restore();

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = s.judged ? color : `rgba(${INK}, 0.55)`;
  ctx.beginPath();
  ctx.arc(0, 0, radius + 1.5, 0, Math.PI * 2);
  ctx.stroke();

  if (s.phase === "scan") {
    const p = Math.min(1, s.t / SCAN_MS);
    const spin = now * 0.012;
    ctx.strokeStyle = `rgba(240, 180, 41, ${0.35 + 0.55 * Math.sin(p * Math.PI)})`;
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    for (let arm = 0; arm < 2; arm += 1) {
      ctx.beginPath();
      ctx.arc(0, 0, radius + 6, spin + arm * Math.PI, spin + arm * Math.PI + 1.1);
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(240, 180, 41, ${0.5 * p})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 6, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function paintLabels(ctx: CanvasRenderingContext2D, swimmers: Swimmer[], a: Arena) {
  ctx.save();
  ctx.font = `400 10px ${MONO}`;
  ctx.textBaseline = "middle";
  const taken: { x: number; y: number; w: number; h: number }[] = [
    { x: a.x - a.shield - 30, y: a.y - a.shield - 30, w: (a.shield + 30) * 2, h: (a.shield + 30) * 2 },
  ];
  let drawn = 0;
  for (const s of swimmers) {
    if (drawn >= 16) break;
    if (s.phase !== "approach" || s.scale < 0.9) continue;
    const dist = Math.hypot(s.x - a.x, s.y - a.y);
    const fade = clamp((dist - a.shield - 40) / 90, 0, 1);
    if (fade <= 0.05) continue;
    const text = shortName(s.ensName).slice(0, 20);
    const w = ctx.measureText(text).width + 12;
    const h = 17;
    const right = s.x < a.x;
    const box = { x: right ? s.x - w - 16 : s.x + 16, y: s.y - h / 2, w, h };
    if (box.x < 4 || box.x + w > a.width - 4) continue;
    if (taken.some((other) => overlap(box, other))) continue;
    taken.push(box);
    drawn += 1;
    ctx.globalAlpha = fade;
    ctx.fillStyle = "rgba(11, 10, 9, 0.72)";
    roundRect(ctx, box.x, box.y, box.w, box.h, 5);
    ctx.fill();
    ctx.strokeStyle = `rgba(${INK}, 0.1)`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = `rgba(${INK}, 0.78)`;
    ctx.textAlign = "left";
    ctx.fillText(text, box.x + 6, s.y + 0.5);
  }
  ctx.restore();
}

function paintFx(ctx: CanvasRenderingContext2D, list: Fx[], a: Arena, dt: number, layer: "under" | "over") {
  ctx.save();
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index];
    const isOver = item.kind === "tag" || item.kind === "spark";
    if ((layer === "over") !== isOver) continue;
    item.t += dt;
    const raw = item.kind === "ring" ? (item.t - item.delay) / item.life : item.t / item.life;
    if (raw >= 1) {
      list.splice(index, 1);
      continue;
    }
    if (raw < 0) continue;
    const p = raw;
    if (item.kind === "spawn") {
      ctx.strokeStyle = `rgba(${INK}, ${0.5 * (1 - p)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(item.x, item.y, 3 + easeOut(p) * 16, 0, Math.PI * 2);
      ctx.stroke();
    } else if (item.kind === "impact") {
      const rgb = hexToRgb(item.color);
      const width = 0.18 + easeOut(p) * 0.5;
      ctx.lineCap = "round";
      ctx.shadowColor = item.color;
      ctx.shadowBlur = 12 * (1 - p);
      ctx.strokeStyle = `rgba(${rgb}, ${0.95 * (1 - p)})`;
      ctx.lineWidth = 3 * (1 - p) + 1;
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.shield, item.angle - width, item.angle + width);
      ctx.stroke();
      ctx.shadowBlur = 0;
      const hx = a.x + Math.cos(item.angle) * a.shield;
      const hy = a.y + Math.sin(item.angle) * a.shield;
      ctx.strokeStyle = `rgba(${rgb}, ${0.6 * (1 - p)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(hx, hy, 4 + easeOut(p) * 26, 0, Math.PI * 2);
      ctx.stroke();
    } else if (item.kind === "ring") {
      const rgb = hexToRgb(item.color);
      ctx.strokeStyle = `rgba(${rgb}, ${0.55 * (1 - p) * (1 - p)})`;
      ctx.lineWidth = item.width;
      ctx.beginPath();
      ctx.arc(a.x, a.y, lerp(item.from, item.to, easeOut(p)), 0, Math.PI * 2);
      ctx.stroke();
    } else if (item.kind === "spark") {
      const rgb = hexToRgb(item.color);
      const damp = Math.pow(0.94, dt / 16);
      item.vx *= damp;
      item.vy *= damp;
      item.x += item.vx * dt;
      item.y += item.vy * dt;
      ctx.strokeStyle = `rgba(${rgb}, ${1 - p})`;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(item.x, item.y);
      ctx.lineTo(item.x - item.vx * 26, item.y - item.vy * 26);
      ctx.stroke();
    } else if (item.kind === "tag") {
      const rgb = hexToRgb(item.color);
      const alpha = p < 0.15 ? p / 0.15 : p > 0.7 ? (1 - p) / 0.3 : 1;
      const rise = easeOut(p) * 18;
      ctx.font = `600 9px ${MONO}`;
      setSpacing(ctx, "0.14em");
      const w = ctx.measureText(item.text).width + 14;
      const h = 18;
      const x = clamp(item.x - w / 2, 6, a.width - w - 6);
      const y = item.y - h / 2 - rise;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(12, 10, 9, 0.9)";
      roundRect(ctx, x, y, w, h, 4);
      ctx.fill();
      ctx.strokeStyle = `rgba(${rgb}, 0.7)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = item.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(item.text, x + w / 2 + 1, y + h / 2 + 0.5);
      setSpacing(ctx, "0px");
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

function setSpacing(ctx: CanvasRenderingContext2D, value: string) {
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = value;
}

function overlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

const rgbCache = new Map<string, string>();
function hexToRgb(hex: string) {
  const hit = rgbCache.get(hex);
  if (hit) return hit;
  const value = Number.parseInt(hex.slice(1), 16);
  const rgb = `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
  rgbCache.set(hex, rgb);
  return rgb;
}

function quad(a: Point, c: Point, b: Point, t: number) {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number) {
  return t * t * t;
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutBack(t: number) {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
}

function lerpAngle(from: number, to: number, t: number) {
  const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + diff * t;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

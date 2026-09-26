"use client";

import { useEffect, useRef } from "react";
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

type Swimmer = Racer & {
  x: number;
  y: number;
  angle: number;
  phase: number;
  scale: number;
  stage: "approach" | "gate" | "enter" | "jail" | "jailed" | "done";
  gate: number;
  slot: number;
  jailIndex: number;
};

const COLOR: Record<Outcome, string> = {
  PURCHASE_COMPLETE: "#f0b429",
  IDENTITY_ALREADY_USED: "#ff8a3d",
  WORLD_ID_NOT_DETECTED: "#9fd0ff",
  PURCHASE_DENIED: "#ff5d73",
};

const WORLD_MARK_PATH =
  "M53.9 4.8C48.4 1.6 42.4 0 35.9 0C29.4 0 23.4 1.6 17.9 4.8C12.4 8 8 12.4 4.8 17.9C1.6 23.4 0 29.4 0 35.9C0 42.4 1.6 48.4 4.8 53.9C8 59.4 12.4 63.8 17.9 67C23.4 70.2 29.4 71.8 35.9 71.8C42.4 71.8 48.4 70.2 53.9 67C59.4 63.8 63.8 59.4 67 53.9C70.2 48.4 71.8 42.4 71.8 35.9C71.8 29.4 70.2 23.4 67 17.9C63.8 12.4 59.4 8 53.9 4.8ZM38.1 48.9C34 48.9 30.8 47.7 28.3 45.4C26.6 43.8 25.5 41.9 25 39.6H63.8C63.4 42.9 62.4 46 61 48.9H38.2H38.1ZM25 32.3C25.5 30.1 26.6 28.1 28.3 26.5C30.8 24.2 34 23 38.1 23H61C62.5 25.9 63.4 29 63.8 32.3H25ZM11.6 21.6C14.1 17.3 17.5 13.8 21.8 11.3C26.1 8.8 30.8 7.5 36 7.5C41.2 7.5 45.9 8.8 50.2 11.3C52.4 12.6 54.3 14.1 56.1 15.9H38C33.9 15.9 30.2 16.8 27 18.5C23.8 20.2 21.3 22.6 19.6 25.6C18.4 27.7 17.6 30 17.2 32.4H8.3C8.7 28.6 9.9 25 11.8 21.7L11.6 21.6ZM50.1 60.5C45.8 63 41.1 64.3 35.9 64.3C30.7 64.3 26 63 21.7 60.5C17.4 58 14 54.5 11.5 50.2C9.6 46.9 8.4 43.4 8 39.6H16.9C17.3 42 18.1 44.3 19.3 46.4C21.1 49.4 23.6 51.7 26.7 53.5C29.9 55.2 33.6 56.1 37.7 56.1H55.7C54 57.8 52.1 59.3 50 60.5H50.1Z";

export function RaceCanvas({
  racers,
  sold,
  supply,
  title,
}: {
  racers: Racer[];
  sold: number;
  supply: number;
  title: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const racersRef = useRef(racers);
  racersRef.current = racers;
  const meta = useRef({ sold, supply, title });
  meta.current = { sold, supply, title };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const swimmers: Swimmer[] = [];
    const known = new Set<string>();
    let frame = 0;
    let last = performance.now();
    const timers: number[] = [];

    const spawn = (racer: Racer) => {
      const rect = canvas.getBoundingClientRect();
      const start = spawnPoint(rect.width, rect.height, swimmers.length);
      swimmers.push({
        ...racer,
        x: start.x,
        y: start.y,
        angle: start.angle,
        phase: Math.random() * Math.PI * 2,
        scale: 1,
        stage: "approach",
        gate: 0,
        slot: swimmers.length,
        jailIndex: -1,
      });
    };

    const watch = window.setInterval(() => {
      const fresh = racersRef.current.filter((racer) => !known.has(racer.id));
      fresh.forEach((racer, index) => {
        known.add(racer.id);
        timers.push(window.setTimeout(() => spawn(racer), index * 160));
      });
    }, 200);

    const draw = (now: number) => {
      const dt = Math.min(32, now - last);
      last = now;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const pool = poolLayout(width, height);
      const jail = { x: 16, y: height - 168, w: width - 32, h: 150 };
      const cols = Math.max(3, Math.floor((jail.w - 20) / 120));

      ctx.fillStyle = "rgba(90, 18, 34, 0.45)";
      ctx.strokeStyle = "rgba(255, 93, 115, 0.8)";
      ctx.lineWidth = 1.5;
      roundRect(ctx, jail.x, jail.y, jail.w, jail.h, 18);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffb3c0";
      ctx.font = "600 12px Outfit, sans-serif";
      ctx.fillText("JAIL", jail.x + 16, jail.y + 24);
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillStyle = "#f7c2cb";
      ctx.fillText("no grant · duplicate · expired", jail.x + 16, jail.y + 42);

      const glow = ctx.createRadialGradient(pool.x, pool.y, 10, pool.x, pool.y, pool.r * 2.4);
      glow.addColorStop(0, "rgba(244, 241, 234, 0.2)");
      glow.addColorStop(1, "rgba(244, 241, 234, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(pool.x, pool.y, pool.r * 2.3, 0, Math.PI * 2);
      ctx.fill();

      const scale = (pool.r * 2) / 71.8;
      ctx.save();
      ctx.translate(pool.x, pool.y);
      ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
      ctx.shadowBlur = 22;
      ctx.shadowOffsetY = 6;
      ctx.scale(scale, scale);
      ctx.translate(-35.9, -35.9);
      ctx.fillStyle = "#ffffff";
      ctx.fill(new Path2D(WORLD_MARK_PATH));
      ctx.restore();

      const label = meta.current.title || "Ticket pool";
      paintPoolLabel(ctx, pool.x, pool.y, label.slice(0, 18), `${meta.current.sold}/${meta.current.supply || 0}`);

      let jailCursor = 0;
      for (const swimmer of swimmers) {
        const before = swimmer.stage;
        step(swimmer, pool, jail, cols, dt);
        if (before !== "jail" && before !== "jailed" && (swimmer.stage === "jail" || swimmer.stage === "jailed") && swimmer.jailIndex < 0) {
          swimmer.jailIndex = jailCursor;
        }
        if (swimmer.jailIndex >= 0) jailCursor = Math.max(jailCursor, swimmer.jailIndex + 1);
        if (swimmer.stage === "done") continue;
        drawSwimmer(ctx, swimmer);
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(watch);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return <canvas ref={canvasRef} aria-label="Agents racing toward the ticket pool" />;
}

function poolLayout(width: number, height: number) {
  const jailTop = height - 176;
  return {
    x: width * 0.5,
    y: Math.max(96, jailTop * 0.5),
    r: Math.min(112, width * 0.16, Math.max(72, jailTop * 0.24)),
  };
}

function spawnPoint(width: number, height: number, index: number) {
  const pool = poolLayout(width, height);
  const cx = pool.x;
  const cy = pool.y;
  const outward = index * 2.399963229728653;
  const ux = Math.cos(outward);
  const uy = Math.sin(outward);
  let reach = Number.POSITIVE_INFINITY;
  if (ux > 0.02) reach = Math.min(reach, (width - 12 - cx) / ux);
  if (ux < -0.02) reach = Math.min(reach, (12 - cx) / ux);
  if (uy > 0.02) reach = Math.min(reach, (height - 12 - cy) / uy);
  if (uy < -0.02) reach = Math.min(reach, (12 - cy) / uy);
  const jailTop = height - 176;
  if (uy > 0.02) reach = Math.min(reach, (jailTop - cy) / uy);
  const dist = Math.max(96, Math.min(reach - 16, reach - 108));
  const jitter = ((index * 17) % 11) - 5;
  return {
    x: cx + ux * dist - uy * jitter * 4,
    y: cy + uy * dist + ux * jitter * 4,
    angle: Math.atan2(-uy, -ux),
  };
}

function step(
  swimmer: Swimmer,
  egg: { x: number; y: number; r: number },
  jail: { x: number; y: number; w: number; h: number },
  cols: number,
  dt: number,
) {
  swimmer.phase += dt * 0.01;
  if (swimmer.stage === "approach" || swimmer.stage === "gate") {
    const dx = egg.x - swimmer.x;
    const dy = egg.y - swimmer.y;
    const dist = Math.hypot(dx, dy) || 1;
    const target = Math.atan2(dy, dx);
    swimmer.angle = lerpAngle(swimmer.angle, target, 0.08);
    const wobble = Math.sin(swimmer.phase) * 0.4;
    const speed = swimmer.stage === "gate" ? 0.4 : swimmer.outcome === "PURCHASE_COMPLETE" ? 2.3 : 1.7;
    swimmer.x += Math.cos(swimmer.angle + wobble) * speed * dt * 0.08;
    swimmer.y += Math.sin(swimmer.angle + wobble) * speed * dt * 0.08;
    if (swimmer.stage === "approach" && dist < egg.r + 36) swimmer.stage = "gate";
    if (swimmer.stage === "gate") {
      swimmer.gate += dt;
      if (swimmer.gate > 380) {
        swimmer.stage = swimmer.outcome === "PURCHASE_COMPLETE" ? "enter" : "jail";
      }
    }
  } else if (swimmer.stage === "enter") {
    swimmer.x += (egg.x - swimmer.x) * 0.12;
    swimmer.y += (egg.y - swimmer.y) * 0.12;
    swimmer.scale *= 0.94;
    if (swimmer.scale < 0.08) swimmer.stage = "done";
  } else if (swimmer.stage === "jail" || swimmer.stage === "jailed") {
    const index = Math.max(0, swimmer.jailIndex);
    const col = index % cols;
    const row = Math.floor(index / cols);
    const cell = (jail.w - 36) / cols;
    const point = { x: jail.x + 18 + col * cell + cell / 2, y: jail.y + 72 + row * 38 };
    swimmer.x += (point.x - swimmer.x) * 0.08;
    swimmer.y += (point.y - swimmer.y) * 0.08;
    swimmer.angle = lerpAngle(swimmer.angle, 0, 0.15);
    if (Math.hypot(point.x - swimmer.x, point.y - swimmer.y) < 8) swimmer.stage = "jailed";
  }
}

function drawSwimmer(ctx: CanvasRenderingContext2D, swimmer: Swimmer) {
  const color = COLOR[swimmer.outcome];
  const name = swimmer.ensName.replace(".realclanker.eth", "");
  const head = ensColor(swimmer.ensName);
  if (swimmer.stage === "jailed") {
    ctx.save();
    ctx.translate(swimmer.x, swimmer.y);
    drawEnsHead(ctx, 0, 0, 14, head);
    ctx.fillStyle = color;
    ctx.font = "10px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText(name.slice(0, 14), 0, 24);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(swimmer.x, swimmer.y);
  ctx.rotate(swimmer.angle);
  ctx.scale(swimmer.scale, swimmer.scale);
  ctx.fillStyle = color;
  ctx.font = "11px 'IBM Plex Mono', monospace";
  ctx.textAlign = "right";
  ctx.fillText(name.slice(0, 18), -16, 4);
  drawEnsHead(ctx, 10, 0, 15, head);
  ctx.restore();
}

function paintPoolLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  title: string,
  count: string,
) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "680 18px Fraunces, serif";
  const titleWidth = ctx.measureText(title).width;
  ctx.font = "600 14px 'IBM Plex Mono', monospace";
  const countWidth = ctx.measureText(count).width;
  const width = Math.max(titleWidth, countWidth) + 36;
  const height = 58;
  ctx.fillStyle = "#14110c";
  roundRect(ctx, x - width / 2, y - height / 2, width, height, 12);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "680 18px Fraunces, serif";
  ctx.fillText(title, x, y - 10);
  ctx.fillStyle = "#f0b429";
  ctx.font = "600 14px 'IBM Plex Mono', monospace";
  ctx.fillText(count, x, y + 12);
  ctx.restore();
}

function drawEnsHead(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.clip();
  const scale = (radius * 2) / 128;
  ctx.scale(scale, scale);
  ctx.translate(-64, -64);
  ctx.fillStyle = "#f7f4ee";
  for (const path of ENS_MARK_PATHS) ctx.fill(new Path2D(path));
  ctx.restore();
}

function lerpAngle(from: number, to: number, t: number) {
  const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + diff * t;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

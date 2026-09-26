"use client";

import { useEffect, useRef } from "react";

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
    const images = new Map<string, HTMLImageElement>();
    let frame = 0;
    let last = performance.now();
    const timers: number[] = [];

    const imageFor = (url: string) => {
      if (!url) return undefined;
      const cached = images.get(url);
      if (cached) return cached;
      const image = new Image();
      image.src = url;
      images.set(url, image);
      return image;
    };

    const spawn = (racer: Racer) => {
      const rect = canvas.getBoundingClientRect();
      swimmers.push({
        ...racer,
        x: 16 + Math.random() * 40,
        y: 70 + Math.random() * Math.max(120, rect.height - 180),
        angle: 0,
        phase: Math.random() * Math.PI * 2,
        scale: 1,
        stage: "approach",
        gate: 0,
        slot: swimmers.length,
        jailIndex: -1,
      });
      imageFor(racer.avatarUrl);
    };

    const watch = window.setInterval(() => {
      const fresh = racersRef.current.filter((racer) => !known.has(racer.id));
      fresh.forEach((racer, index) => {
        known.add(racer.id);
        timers.push(window.setTimeout(() => spawn(racer), index * 70));
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

      const egg = { x: width * 0.64, y: height * 0.44, r: Math.min(92, width * 0.12) };
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

      const glow = ctx.createRadialGradient(egg.x, egg.y, 10, egg.x, egg.y, egg.r * 2.4);
      glow.addColorStop(0, "rgba(255, 214, 120, 0.35)");
      glow.addColorStop(1, "rgba(255, 214, 120, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(egg.x, egg.y, egg.r * 2.3, 0, Math.PI * 2);
      ctx.fill();

      const yolk = ctx.createRadialGradient(egg.x - 18, egg.y - 22, 8, egg.x, egg.y, egg.r);
      yolk.addColorStop(0, "#fff8e4");
      yolk.addColorStop(0.42, "#ffd36a");
      yolk.addColorStop(1, "#e07a2f");
      ctx.fillStyle = yolk;
      ctx.beginPath();
      ctx.ellipse(egg.x, egg.y, egg.r * 0.76, egg.r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.stroke();
      ctx.fillStyle = "#2a1608";
      ctx.textAlign = "center";
      ctx.font = "650 16px Fraunces, serif";
      const label = meta.current.title || "Ticket pool";
      ctx.fillText(label.slice(0, 18), egg.x, egg.y - 6);
      ctx.font = "12px 'IBM Plex Mono', monospace";
      ctx.fillText(`${meta.current.sold}/${meta.current.supply || 0}`, egg.x, egg.y + 16);
      ctx.textAlign = "left";

      let jailCursor = 0;
      for (const swimmer of swimmers) {
        const before = swimmer.stage;
        step(swimmer, egg, jail, cols, dt);
        if (before !== "jail" && before !== "jailed" && (swimmer.stage === "jail" || swimmer.stage === "jailed") && swimmer.jailIndex < 0) {
          swimmer.jailIndex = jailCursor;
        }
        if (swimmer.jailIndex >= 0) jailCursor = Math.max(jailCursor, swimmer.jailIndex + 1);
        if (swimmer.stage === "done") continue;
        drawSwimmer(ctx, swimmer, imageFor(swimmer.avatarUrl));
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

function drawSwimmer(
  ctx: CanvasRenderingContext2D,
  swimmer: Swimmer,
  image: HTMLImageElement | undefined,
) {
  const color = COLOR[swimmer.outcome];
  const name = swimmer.ensName.replace(".realclanker.eth", "");
  if (swimmer.stage === "jailed") {
    ctx.save();
    ctx.translate(swimmer.x, swimmer.y);
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fillStyle = "#1a120c";
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.clip();
    if (image && image.complete && image.naturalWidth > 0) ctx.drawImage(image, -10, -10, 20, 20);
    else {
      ctx.fillStyle = color;
      ctx.fillRect(-10, -10, 20, 20);
    }
    ctx.restore();
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
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  for (let i = 1; i <= 14; i++) {
    const t = i / 14;
    ctx.lineTo(-8 - t * 78, Math.sin(swimmer.phase + t * 7) * (3 + t * 8));
  }
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.font = "11px 'IBM Plex Mono', monospace";
  ctx.textAlign = "right";
  ctx.fillText(name.slice(0, 18), -14, 4);
  ctx.beginPath();
  ctx.arc(8, 0, 12, 0, Math.PI * 2);
  ctx.fillStyle = "#1a120c";
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(8, 0, 11, 0, Math.PI * 2);
  ctx.clip();
  if (image && image.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, -3, -11, 22, 22);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(-3, -11, 22, 22);
  }
  ctx.restore();
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

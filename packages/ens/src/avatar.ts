import { createHash } from "node:crypto";

export function avatarDataUri(seed: string): string {
  const hash = createHash("sha256").update(seed).digest();
  const hue = hash[0]! * 1.4;
  const hue2 = (hue + 40 + (hash[1]! % 80)) % 360;
  const mark = seed.replace(".realclanker.eth", "").slice(0, 1).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="32" fill="hsl(${hue} 62% 42%)"/>
    <circle cx="32" cy="32" r="22" fill="hsl(${hue2} 78% 62%)"/>
    <circle cx="24" cy="27" r="3" fill="#1a1208"/>
    <circle cx="40" cy="27" r="3" fill="#1a1208"/>
    <path d="M22 40c4 5 16 5 20 0" fill="none" stroke="#1a1208" stroke-width="2" stroke-linecap="round"/>
    <text x="32" y="58" text-anchor="middle" font-family="ui-monospace,monospace" font-size="8" fill="#fff">${mark}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

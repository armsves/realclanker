import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: [
    "@realclanker/core",
    "@realclanker/ens",
    "@realclanker/worldid",
    "@realclanker/settlement",
    "@realclanker/runtime",
    "@realclanker/mcp",
    "@realclanker/attack-simulator",
  ],
  serverExternalPackages: ["@mysten/sui", "viem", "@modelcontextprotocol/sdk", "@vercel/blob", "ioredis"],
  outputFileTracingRoot: root,
};

export default nextConfig;

import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  transpilePackages: [
    "@realclanker/core",
    "@realclanker/ens",
    "@realclanker/worldid",
    "@realclanker/settlement",
    "@realclanker/runtime",
  ],
  serverExternalPackages: ["@mysten/sui", "viem"],
  outputFileTracingRoot: root,
};

export default nextConfig;

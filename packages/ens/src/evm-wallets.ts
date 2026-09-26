import fs from "node:fs";
import path from "node:path";
import { readJson, withJson } from "@realclanker/core";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type PrivateKeyAccount,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

type WalletFile = Record<string, `0x${string}`>;

let platformQueue: Promise<unknown> = Promise.resolve();

function repoRoot(): string {
  if (process.env.REALCLANKER_ROOT) return process.env.REALCLANKER_ROOT;
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function upsertEnv(key: string, value: string) {
  const file = path.join(repoRoot(), ".env");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const line = `${key}=${value}`;
  const next = new RegExp(`^${key}=.*$`, "m").test(text)
    ? text.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${text.trimEnd()}\n${line}\n`;
  fs.writeFileSync(file, next);
  process.env[key] = value;
}

export function platformAccount(): PrivateKeyAccount {
  const existing = process.env.ENS_PRIVATE_KEY?.trim();
  if (existing) return privateKeyToAccount(existing as `0x${string}`);
  const file = path.join(repoRoot(), ".env");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const fromFile = text.match(/^ENS_PRIVATE_KEY=(.*)$/m)?.[1]?.trim();
  if (fromFile) {
    process.env.ENS_PRIVATE_KEY = fromFile;
    return privateKeyToAccount(fromFile as `0x${string}`);
  }
  const privateKey = generatePrivateKey();
  upsertEnv("ENS_PRIVATE_KEY", privateKey);
  return privateKeyToAccount(privateKey);
}

export function ensureAgentEvmWallet(ensName: string): Promise<{ address: Address; account: PrivateKeyAccount }> {
  const name = ensName.trim().toLowerCase();
  return withJson("evm-wallets.json", {} as WalletFile, (wallets) => {
    const privateKey = wallets[name] ?? generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    if (!wallets[name]) wallets[name] = privateKey;
    return { address: account.address, account };
  });
}

export async function agentEvmAccount(ensName: string): Promise<PrivateKeyAccount | undefined> {
  const name = ensName.trim().toLowerCase();
  const wallets = await readJson("evm-wallets.json", {} as WalletFile);
  const key = wallets[name];
  return key ? privateKeyToAccount(key) : undefined;
}

export function sepoliaClients(account?: PrivateKeyAccount) {
  const rpc = process.env.SEPOLIA_RPC_URL;
  if (!rpc) return undefined;
  const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
  const wallet = account
    ? createWalletClient({ account, chain: sepolia, transport: http(rpc) })
    : undefined;
  return { publicClient, wallet };
}

export function enqueuePlatform<T>(job: () => Promise<T>): Promise<T> {
  const run = platformQueue.then(job, job);
  platformQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function ethBalance(address: Address): Promise<bigint | null> {
  const clients = sepoliaClients();
  if (!clients) return null;
  try {
    return await clients.publicClient.getBalance({ address });
  } catch {
    return null;
  }
}

export async function dripEth(to: Address, minimum: bigint): Promise<void> {
  const current = (await ethBalance(to)) ?? 0n;
  if (current >= minimum) return;
  const account = platformAccount();
  if (account.address.toLowerCase() === to.toLowerCase()) return;
  const clients = sepoliaClients(account);
  if (!clients?.wallet) return;
  const treasury = (await ethBalance(account.address)) ?? 0n;
  const amount = minimum - current;
  if (treasury < amount + 50_000_000_000_000n) return;
  const hash = await clients.wallet.sendTransaction({ to, value: amount });
  await clients.publicClient.waitForTransactionReceipt({ hash });
}

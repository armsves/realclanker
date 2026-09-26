import { readJson, withJson } from "@realclanker/core";
import { keccak256, namehash, toHex, type Address } from "viem";
import { avatarDataUri } from "./avatar";
import { ETH_REGISTRY, registryAbi, resolverAbi } from "./contracts";
import { enqueuePlatform, platformAccount, sepoliaClients } from "./evm-wallets";
import { recordsResolverAbi, recordsResolverBytecode } from "./recordsResolver";

export { avatarDataUri };
export { ensureAgentEvmWallet, ethBalance, platformAccount } from "./evm-wallets";
export { mintEns, type EnsMint } from "./mint";

export function ticketRecordKey(concertId: string): string {
  return `realclanker.ticket.${concertId}`;
}

export function grantRecordKey(concertId: string): string {
  return `realclanker.grant.${concertId}`;
}

const resolverByLabelAbi = [
  {
    name: "getResolver",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "label", type: "string" }],
    outputs: [{ type: "address" }],
  },
] as const;

function parentName() {
  return (process.env.ENS_PARENT_NAME || "realclanker.eth").trim().toLowerCase();
}

const RECORDS_RESOLVER_VERSION = 2;

async function ensureRecordsResolver(): Promise<Address> {
  return enqueuePlatform(async () => {
    const saved = await readJson("ens-resolver.json", {} as { address?: Address; version?: number });
    if (saved.address && saved.version === RECORDS_RESOLVER_VERSION) return saved.address;
    const account = platformAccount();
    const clients = sepoliaClients(account);
    if (!clients?.wallet) throw new Error("Sepolia writer is not configured.");
    const hash = await clients.wallet.deployContract({
      abi: recordsResolverAbi,
      bytecode: recordsResolverBytecode,
      args: [account.address],
    });
    const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error("Records resolver was not deployed.");
    const address = receipt.contractAddress;
    await withJson("ens-resolver.json", {} as { address?: Address; version?: number }, (file) => {
      file.address = address;
      file.version = RECORDS_RESOLVER_VERSION;
    });
    return address;
  });
}

async function pointRecordsResolver(ensName: string, resolver: Address) {
  const parent = parentName();
  const label = ensName.slice(0, -(parent.length + 1));
  if (!label || label.includes(".")) return;
  const account = platformAccount();
  const clients = sepoliaClients(account);
  if (!clients?.wallet) return;
  const parentLabel = parent.slice(0, -".eth".length);
  const subregistry = await clients.publicClient.readContract({
    address: ETH_REGISTRY,
    abi: registryAbi,
    functionName: "getSubregistry",
    args: [parentLabel],
  });
  const current = await clients.publicClient.readContract({
    address: subregistry,
    abi: resolverByLabelAbi,
    functionName: "getResolver",
    args: [label],
  });
  if (current.toLowerCase() === resolver.toLowerCase()) return;
  const hash = await clients.wallet.writeContract({
    address: subregistry,
    abi: [
      {
        name: "setResolver",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "anyId", type: "uint256" },
          { name: "resolver", type: "address" },
        ],
        outputs: [],
      },
    ],
    functionName: "setResolver",
    args: [BigInt(keccak256(toHex(label))), resolver],
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Could not point the name at the records resolver.");
}

export type EnsProfile = {
  avatarUrl: string;
  address?: Address;
  resolvedAvatar?: string;
};

export async function resolveAgent(ensName: string): Promise<EnsProfile> {
  const fallback = avatarDataUri(ensName);
  const client = sepoliaClients()?.publicClient;
  if (!client) return { avatarUrl: fallback };
  try {
    const [address, avatar] = await Promise.all([
      client.getEnsAddress({ name: ensName }),
      client.getEnsAvatar({ name: ensName }),
    ]);
    return {
      avatarUrl: avatar || fallback,
      resolvedAvatar: avatar ?? undefined,
      address: address ?? undefined,
    };
  } catch {
    return { avatarUrl: fallback };
  }
}

export async function writeTextRecord(input: {
  ensName: string;
  key: string;
  value: string;
}): Promise<{ wrote: boolean; error?: string; txHash?: string }> {
  if (!process.env.SEPOLIA_RPC_URL) {
    return { wrote: false, error: "Sepolia writer is not configured." };
  }
  try {
    const account = platformAccount();
    const clients = sepoliaClients(account);
    if (!clients?.wallet) return { wrote: false, error: "Sepolia writer is not configured." };
    const { publicClient, wallet } = clients;
    const parent = (process.env.ENS_PARENT_NAME || "realclanker.eth").trim().toLowerCase();
    const resolver = input.ensName.endsWith(`.${parent}`)
      ? await ensureRecordsResolver()
      : await publicClient.getEnsResolver({ name: input.ensName });
    if (!resolver) {
      return { wrote: false, error: `No ENSv2 resolver for ${input.ensName}.` };
    }
    if (input.ensName.endsWith(`.${parent}`)) await pointRecordsResolver(input.ensName, resolver);
    const node = namehash(input.ensName);
    const hash = await wallet.writeContract({
      address: resolver,
      abi: input.ensName.endsWith(`.${parent}`) ? recordsResolverAbi : resolverAbi,
      functionName: "setText",
      args: [node, input.key, input.value],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") return { wrote: false, txHash: hash, error: "ENS text record reverted." };
    const stored = await publicClient.readContract({
      address: resolver,
      abi: resolverAbi,
      functionName: "text",
      args: [node, input.key],
    });
    if (stored !== input.value) {
      return { wrote: false, txHash: hash, error: "ENSv2 resolver did not keep the text record." };
    }
    return { wrote: true, txHash: hash };
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : "ENS write failed";
    return { wrote: false, error: message.length > 180 ? `${message.slice(0, 177)}…` : message };
  }
}

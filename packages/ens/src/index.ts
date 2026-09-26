import {
  createPublicClient,
  createWalletClient,
  http,
  namehash,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { avatarDataUri } from "./avatar";

const resolverAbi = [
  {
    name: "setText",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
] as const;

export { avatarDataUri };

export function ticketRecordKey(concertId: string): string {
  return `realclanker.ticket.${concertId}`;
}

export function grantRecordKey(concertId: string): string {
  return `realclanker.grant.${concertId}`;
}

export type EnsProfile = {
  avatarUrl: string;
  address?: Address;
  resolvedAvatar?: string;
};

function sepoliaClient() {
  const rpc = process.env.SEPOLIA_RPC_URL;
  if (!rpc) return undefined;
  return createPublicClient({ chain: sepolia, transport: http(rpc) });
}

export async function resolveAgent(ensName: string): Promise<EnsProfile> {
  const fallback = avatarDataUri(ensName);
  const client = sepoliaClient();
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
  const rpc = process.env.SEPOLIA_RPC_URL;
  const privateKey = process.env.ENS_PRIVATE_KEY;
  if (!rpc || !privateKey) {
    return { wrote: false, error: "Sepolia writer is not configured." };
  }
  try {
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: sepolia, transport: http(rpc) });
    const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
    const resolver = await publicClient.getEnsResolver({ name: input.ensName });
    if (!resolver) {
      return { wrote: false, error: `No ENSv2 resolver for ${input.ensName}.` };
    }
    const hash = await wallet.writeContract({
      address: resolver,
      abi: resolverAbi,
      functionName: "setText",
      args: [namehash(input.ensName), input.key, input.value],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return { wrote: true, txHash: hash };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ENS write failed";
    return { wrote: false, error: message };
  }
}

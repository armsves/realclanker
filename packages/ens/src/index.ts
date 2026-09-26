import { namehash, type Address } from "viem";
import { avatarDataUri } from "./avatar";
import { resolverAbi } from "./contracts";
import { agentEvmAccount, dripEth, platformAccount, sepoliaClients } from "./evm-wallets";

export { avatarDataUri };
export { ensureAgentEvmWallet, ethBalance, platformAccount } from "./evm-wallets";
export { mintEns, type EnsMint } from "./mint";

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
    const owner = await agentEvmAccount(input.ensName);
    const account = owner ?? platformAccount();
    if (owner) await dripEth(owner.address, 200_000_000_000_000n);
    const clients = sepoliaClients(account);
    if (!clients?.wallet) return { wrote: false, error: "Sepolia writer is not configured." };
    const { publicClient, wallet } = clients;
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

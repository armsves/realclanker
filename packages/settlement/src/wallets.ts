import { withJson } from "@realclanker/core";

/** Gas left on the agent after the ticket price is split off. */
export const TICKET_GAS_RESERVE = 50_000_000n;

type WalletFile = Record<string, string>;

let treasuryQueue: Promise<unknown> = Promise.resolve();

function enqueueTreasury<T>(job: () => Promise<T>): Promise<T> {
  const run = treasuryQueue.then(job, job);
  treasuryQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function loadKeys() {
  const [{ Ed25519Keypair }, { decodeSuiPrivateKey }] = await Promise.all([
    import("@mysten/sui/keypairs/ed25519"),
    import("@mysten/sui/cryptography"),
  ]);
  return { Ed25519Keypair, decodeSuiPrivateKey };
}

export async function ensureAgentWallet(ensName: string): Promise<{ suiAddress: string; secretKey: string }> {
  const name = ensName.trim().toLowerCase();
  const { Ed25519Keypair, decodeSuiPrivateKey } = await loadKeys();
  return withJson("wallets.json", {} as WalletFile, (wallets) => {
    const existing = wallets[name];
    if (existing) {
      const decoded = decodeSuiPrivateKey(existing);
      return {
        suiAddress: Ed25519Keypair.fromSecretKey(decoded.secretKey).toSuiAddress(),
        secretKey: existing,
      };
    }
    const keypair = new Ed25519Keypair();
    const secretKey = keypair.getSecretKey();
    wallets[name] = secretKey;
    return { suiAddress: keypair.toSuiAddress(), secretKey };
  });
}

export async function keypairFromSecret(secretKey: string) {
  const { Ed25519Keypair, decodeSuiPrivateKey } = await loadKeys();
  return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(secretKey).secretKey);
}

async function suiClient() {
  const { SuiGrpcClient } = await import("@mysten/sui/grpc");
  const network = (process.env.SUI_NETWORK || "testnet") as "testnet" | "devnet" | "mainnet";
  const baseUrl =
    network === "mainnet"
      ? "https://fullnode.mainnet.sui.io:443"
      : network === "devnet"
        ? "https://fullnode.devnet.sui.io:443"
        : "https://fullnode.testnet.sui.io:443";
  return new SuiGrpcClient({ network, baseUrl });
}

export async function sharedObject(objectId: string): Promise<{
  objectId: string;
  initialSharedVersion: string;
  mutable: true;
}> {
  const client = await suiClient();
  const { object } = await client.core.getObject({ objectId });
  if (object.owner?.$kind !== "Shared" || !object.owner.Shared.initialSharedVersion) {
    throw new Error(`Object ${objectId} is not a shared Sui object.`);
  }
  return {
    objectId,
    initialSharedVersion: object.owner.Shared.initialSharedVersion,
    mutable: true,
  };
}

export async function fundFromFaucet(address: string): Promise<{ ok: boolean; error?: string }> {
  const network = process.env.SUI_NETWORK || "testnet";
  if (network !== "testnet" && network !== "devnet" && network !== "localnet") {
    return { ok: false, error: "The faucet only funds testnet, devnet, and localnet." };
  }
  try {
    const { requestSuiFromFaucetV2, getFaucetHost } = await import("@mysten/sui/faucet");
    await requestSuiFromFaucetV2({
      host: getFaucetHost(network),
      recipient: address,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Faucet request failed." };
  }
}

export async function waitForBalance(address: string, minimum: bigint): Promise<bigint | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const balance = await suiBalance(address);
    if (balance !== null && balance >= minimum) return balance;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return suiBalance(address);
}

export async function suiBalance(address: string): Promise<bigint | null> {
  try {
    const client = await suiClient();
    const result = await client.core.getBalance({
      address,
      coinType: "0x2::sui::SUI",
    });
    return BigInt(result.balance.balance);
  } catch {
    return null;
  }
}

export async function fundAgentWallet(
  address: string,
  amountMist: bigint,
): Promise<{ digest?: string; error?: string }> {
  if (amountMist <= 0n) return {};
  if (!process.env.SUI_PRIVATE_KEY) {
    return { error: "Set SUI_PRIVATE_KEY to the faucet-funded treasury." };
  }
  return enqueueTreasury(async () => {
    try {
      const keypair = await keypairFromSecret(process.env.SUI_PRIVATE_KEY!);
      const result = await executeSigned(keypair, (tx) => {
        const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
        tx.transferObjects([coin], address);
      });
      return { digest: result.digest };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Could not fund the agent wallet." };
    }
  });
}

export function treasuryLock<T>(job: () => Promise<T>): Promise<T> {
  return enqueueTreasury(job);
}

export async function executeSigned(
  keypair: { toSuiAddress: () => string; signTransaction: (bytes: Uint8Array) => Promise<{ signature: string }> },
  fill: (tx: import("@mysten/sui/transactions").Transaction) => void,
): Promise<{ digest?: string; objects: { id?: string; type?: string }[] }> {
  const client = await suiClient();
  const { Transaction } = await import("@mysten/sui/transactions");
  const { fromBase64 } = await import("@mysten/sui/utils");
  const address = keypair.toSuiAddress();
  const tx = new Transaction();
  tx.setSender(address);
  const gas = (
    await client.core.getOwnedObjects({
      address,
      type: "0x2::coin::Coin<0x2::sui::SUI>",
    })
  ).objects[0];
  if (!gas?.digest) throw new Error("No SUI coin for gas.");
  tx.setGasPrice(1000);
  tx.setGasBudget(20_000_000);
  tx.setGasPayment([{ objectId: gas.id, version: gas.version, digest: gas.digest }]);
  fill(tx);
  const bytes = await tx.build();
  const signed = await keypair.signTransaction(bytes);
  const response = await client.transactionExecutionService.executeTransaction({
    transaction: { bcs: { value: bytes } },
    signatures: [
      {
        bcs: { value: fromBase64(signed.signature) },
        signature: { oneofKind: undefined },
      },
    ],
    readMask: { paths: ["digest", "effects"] },
  });
  const executed = response.response.transaction;
  if (!executed?.effects?.status?.success) {
    throw new Error(executed?.effects?.status?.error?.description ?? "Transaction failed.");
  }
  const objects = (executed.effects.changedObjects ?? []).map((object) => ({
    id: object.objectId,
    type: object.objectType,
  }));
  if (objects.some((object) => object.id && !object.type)) {
    const fetched = await client.core.getObjects({
      objectIds: objects.map((object) => object.id).filter((id): id is string => Boolean(id)),
    });
    return {
      digest: executed.digest,
      objects: fetched.objects.map((object) =>
        object instanceof Error ? { id: undefined, type: undefined } : { id: object.id, type: object.type },
      ),
    };
  }
  return { digest: executed.digest, objects };
}

import { createHash, randomBytes } from "node:crypto";

export function ticketHash(input: {
  concertId: string;
  worldIdSub: string;
  ensName: string;
  serial: number;
}): string {
  return createHash("sha256")
    .update(`${input.concertId}|${input.worldIdSub}|${input.ensName}|${input.serial}|${randomBytes(8).toString("hex")}`)
    .digest("hex");
}

export type SettlementResult = {
  mode: "sui" | "simulated";
  ticketHash: string;
  objectId?: string;
  digest?: string;
  error?: string;
};

export function suiConfigured(): boolean {
  return Boolean(process.env.SUI_PRIVATE_KEY && process.env.SUI_PACKAGE_ID);
}

export async function createPool(input: {
  supply: number;
  priceMist: bigint;
}): Promise<{ poolId?: string; error?: string }> {
  if (!suiConfigured()) return {};
  try {
    const { client, keypair, packageId } = await suiContext();
    const { Transaction } = await import("@mysten/sui/transactions");
    const tx = new Transaction();
    tx.moveCall({
      target: `${packageId}::tickets::create_pool`,
      arguments: [tx.pure.u64(input.supply), tx.pure.u64(input.priceMist)],
    });
    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showObjectChanges: true },
    });
    const created = result.objectChanges?.find(
      (change) => change.type === "created" && change.objectType?.includes("::tickets::Pool"),
    );
    if (!created || created.type !== "created") {
      return { error: "Pool object was not created." };
    }
    return { poolId: created.objectId };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Sui pool creation failed." };
  }
}

export async function settleTicket(input: {
  poolId?: string;
  concertId: string;
  ensName: string;
  worldIdSub: string;
  priceMist: bigint;
  hash: string;
}): Promise<SettlementResult> {
  if (!suiConfigured() || !input.poolId) {
    return {
      mode: "simulated",
      ticketHash: input.hash,
      objectId: `0xsim${input.hash.slice(0, 16)}`,
    };
  }
  try {
    const { client, keypair, packageId } = await suiContext();
    const { Transaction } = await import("@mysten/sui/transactions");
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(input.priceMist)]);
    const [ticket, change] = tx.moveCall({
      target: `${packageId}::tickets::buy`,
      arguments: [
        tx.object(input.poolId),
        coin,
        tx.pure.vector("u8", [...Buffer.from(input.concertId)]),
        tx.pure.vector("u8", [...Buffer.from(input.ensName)]),
        tx.pure.vector("u8", [...Buffer.from(input.worldIdSub)]),
        tx.pure.vector("u8", [...Buffer.from(input.hash)]),
      ],
    });
    tx.transferObjects([ticket, change], keypair.toSuiAddress());
    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showObjectChanges: true },
    });
    const minted = result.objectChanges?.find(
      (change) => change.type === "created" && change.objectType?.includes("::tickets::Ticket"),
    );
    return {
      mode: "sui",
      ticketHash: input.hash,
      objectId: minted && minted.type === "created" ? minted.objectId : undefined,
      digest: result.digest,
    };
  } catch (error) {
    return {
      mode: "simulated",
      ticketHash: input.hash,
      objectId: `0xsim${input.hash.slice(0, 16)}`,
      error: error instanceof Error ? error.message : "Sui settlement failed.",
    };
  }
}

async function suiContext() {
  const [{ SuiClient, getFullnodeUrl }, { Ed25519Keypair }, { decodeSuiPrivateKey }] =
    await Promise.all([
      import("@mysten/sui/client"),
      import("@mysten/sui/keypairs/ed25519"),
      import("@mysten/sui/cryptography"),
    ]);
  const network = (process.env.SUI_NETWORK || "testnet") as "testnet" | "devnet" | "mainnet";
  const decoded = decodeSuiPrivateKey(process.env.SUI_PRIVATE_KEY!);
  const keypair = Ed25519Keypair.fromSecretKey(decoded.secretKey);
  const client = new SuiClient({ url: getFullnodeUrl(network) });
  return { client, keypair, packageId: process.env.SUI_PACKAGE_ID! };
}

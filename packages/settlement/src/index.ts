import { createHash, randomBytes } from "node:crypto";
import { keypairFromSecret, executeSigned, sharedObject, treasuryLock } from "./wallets";

export { ensureAgentWallet, fundAgentWallet, fundFromFaucet, suiBalance, waitForBalance, TICKET_GAS_RESERVE } from "./wallets";

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
    const { keypair, packageId } = await suiContext();
    const result = await treasuryLock(() =>
      executeSigned(keypair, (tx) => {
        tx.moveCall({
          target: `${packageId}::tickets::create_pool`,
          arguments: [tx.pure.u64(input.supply), tx.pure.u64(input.priceMist)],
        });
      }),
    );
    const poolId = result.objects.find((object) => object.type?.includes("::tickets::Pool"))?.id;
    if (!poolId) return { error: "Pool object was not created." };
    return { poolId };
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
  payerSecret?: string;
}): Promise<SettlementResult> {
  if (!suiConfigured() || !input.poolId) {
    return {
      mode: "simulated",
      ticketHash: input.hash,
      objectId: `0xsim${input.hash.slice(0, 16)}`,
    };
  }
  try {
    const { keypair, packageId } = await suiContext();
    const payer = input.payerSecret ? await keypairFromSecret(input.payerSecret) : keypair;
    const pool = await sharedObject(input.poolId);
    const result = await executeSigned(payer, (tx) => {
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(input.priceMist)]);
      const [ticket, change] = tx.moveCall({
        target: `${packageId}::tickets::buy`,
        arguments: [
          tx.sharedObjectRef(pool),
          coin,
          tx.pure.vector("u8", [...Buffer.from(input.concertId)]),
          tx.pure.vector("u8", [...Buffer.from(input.ensName)]),
          tx.pure.vector("u8", [...Buffer.from(input.worldIdSub)]),
          tx.pure.vector("u8", [...Buffer.from(input.hash)]),
        ],
      });
      tx.transferObjects([ticket, change], payer.toSuiAddress());
    });
    const objectId = result.objects.find((object) => object.type?.includes("::tickets::Ticket"))?.id;
    return {
      mode: "sui",
      ticketHash: input.hash,
      objectId,
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
  const { SuiGrpcClient } = await import("@mysten/sui/grpc");
  const network = (process.env.SUI_NETWORK || "testnet") as "testnet" | "devnet" | "mainnet";
  const baseUrl =
    network === "mainnet"
      ? "https://fullnode.mainnet.sui.io:443"
      : network === "devnet"
        ? "https://fullnode.devnet.sui.io:443"
        : "https://fullnode.testnet.sui.io:443";
  const keypair = await keypairFromSecret(process.env.SUI_PRIVATE_KEY!);
  const client = new SuiGrpcClient({ network, baseUrl });
  return { client, keypair, packageId: process.env.SUI_PACKAGE_ID! };
}

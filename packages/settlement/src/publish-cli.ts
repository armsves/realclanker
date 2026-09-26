import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { requestSuiFromFaucetV2, getFaucetHost } from "@mysten/sui/faucet";
import { fromBase64 } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function readEnv(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    values[line.slice(0, index)] = line.slice(index + 1);
  }
  return values;
}

function upsertEnv(file: string, key: string, value: string) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const line = `${key}=${value}`;
  const next = new RegExp(`^${key}=.*$`, "m").test(text)
    ? text.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${text.trimEnd()}\n${line}\n`;
  fs.writeFileSync(file, next);
}

async function balanceOf(client: SuiGrpcClient, address: string) {
  const result = await client.core.getBalance({ address, coinType: "0x2::sui::SUI" });
  return BigInt(result.balance.balance);
}

async function main() {
  const root = repoRoot();
  const envFile = path.join(root, ".env");
  const env = readEnv(envFile);
  let secret = env.SUI_PRIVATE_KEY?.trim();
  if (!secret) {
    secret = new Ed25519Keypair().getSecretKey();
    upsertEnv(envFile, "SUI_PRIVATE_KEY", secret);
  }
  const keypair = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(secret).secretKey);
  const address = keypair.toSuiAddress();
  const networks = ["testnet", "devnet"] as const;
  let fundedNetwork: (typeof networks)[number] | undefined;
  let balance = 0n;
  let client = new SuiGrpcClient({ network: "testnet", baseUrl: "https://fullnode.testnet.sui.io:443" });
  for (const network of networks) {
    const baseUrl = network === "devnet" ? "https://fullnode.devnet.sui.io:443" : "https://fullnode.testnet.sui.io:443";
    client = new SuiGrpcClient({ network, baseUrl });
    balance = await balanceOf(client, address);
    console.log(JSON.stringify({ step: "publisher", network, address, balance: balance.toString() }));
    if (balance >= 200_000_000n) {
      fundedNetwork = network;
      break;
    }
    try {
      await requestSuiFromFaucetV2({ host: getFaucetHost(network), recipient: address });
    } catch (error) {
      console.log(JSON.stringify({ step: "faucet", network, error: error instanceof Error ? error.message : String(error) }));
      continue;
    }
    for (let attempt = 0; attempt < 20 && balance < 200_000_000n; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      balance = await balanceOf(client, address);
    }
    console.log(JSON.stringify({ step: "funded", network, balance: balance.toString() }));
    if (balance >= 200_000_000n) {
      fundedNetwork = network;
      break;
    }
  }
  if (!fundedNetwork) throw new Error("Neither the testnet nor the devnet faucet funded the publisher.");
  upsertEnv(envFile, "SUI_NETWORK", fundedNetwork);

  if (!env.SUI_PACKAGE_ID?.trim()) {
    execSync("sui move build", { cwd: path.join(root, "contracts"), stdio: "inherit" });
    const moduleBytes = fs.readFileSync(
      path.join(root, "contracts/build/realclanker/bytecode_modules/tickets.mv"),
    );
    const tx = new Transaction();
    tx.setSender(address);
    const upgradeCap = tx.publish({
      modules: [Buffer.from(moduleBytes).toString("base64")],
      dependencies: [
        "0x0000000000000000000000000000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000000000000000000000000000002",
      ],
    });
    tx.transferObjects([upgradeCap], address);
    const gas = (
      await client.core.getOwnedObjects({
        address,
        type: "0x2::coin::Coin<0x2::sui::SUI>",
      })
    ).objects[0];
    if (!gas?.digest) throw new Error("Publisher has no SUI coin for gas.");
    tx.setGasPrice(1000);
    tx.setGasBudget(500_000_000);
    tx.setGasPayment([{ objectId: gas.id, version: gas.version, digest: gas.digest }]);
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
      throw new Error(executed?.effects?.status?.error?.description ?? "Publish failed.");
    }
    const packageId = executed.effects?.changedObjects.find((object) => object.outputState === 3)?.objectId;
    if (!packageId) throw new Error("Publish did not return a package id.");
    upsertEnv(envFile, "SUI_PACKAGE_ID", packageId);
    console.log(JSON.stringify({ step: "published", packageId, digest: executed.digest }));
  } else {
    console.log(JSON.stringify({ step: "published", packageId: env.SUI_PACKAGE_ID }));
  }
}

main().catch((error) => {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(err.stack?.split("\n").slice(0, 12).join("\n") || err.message);
  process.exit(1);
});

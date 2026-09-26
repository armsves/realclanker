import { readJson, withJson } from "@realclanker/core";
import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getCreate2Address,
  keccak256,
  namehash,
  parseEventLogs,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  ETH_REGISTRAR,
  ETH_REGISTRY,
  MOCK_USDC,
  PLATFORM_REGISTRY_ROLES,
  PUBLIC_RESOLVER,
  USER_NAME_ROLES,
  USER_REGISTRY_IMPL,
  VERIFIABLE_FACTORY,
  ZERO,
  factoryAbi,
  registrarAbi,
  registryAbi,
  resolverAbi,
  usdcAbi,
} from "./contracts";
import { agentEvmAccount, dripEth, enqueuePlatform, ethBalance, platformAccount, sepoliaClients } from "./evm-wallets";

const REFERRER = `0x${"0".repeat(64)}` as Hex;
const PARENT = () => (process.env.ENS_PARENT_NAME || "realclanker.eth").trim().toLowerCase();

export type EnsMint = {
  minted: boolean;
  owner: Address;
  kind: "subname" | "eth" | "owned" | "skipped";
  txHash?: Hex;
  error?: string;
};

type SavedCommit = {
  label: string;
  owner: Address;
  secret: Hex;
  subregistry: Address;
  resolver: Address;
  duration: string;
  committedAt: number;
};

async function readCommits(): Promise<Record<string, SavedCommit>> {
  return readJson("ens-commitments.json", {} as Record<string, SavedCommit>);
}

async function writeCommit(key: string, value: SavedCommit | undefined) {
  await withJson("ens-commitments.json", {} as Record<string, SavedCommit>, (commits) => {
    if (value) commits[key] = value;
    else delete commits[key];
  });
}

function labelId(label: string): bigint {
  return BigInt(keccak256(toHex(label)));
}

function short(error: unknown): string {
  const message = error instanceof Error ? error.message : "ENS mint failed.";
  const line = message.split("\n")[0] ?? message;
  return line.length > 180 ? `${line.slice(0, 177)}…` : line;
}

function splitName(ensName: string): { kind: "eth"; label: string } | { kind: "sub"; label: string; parentLabel: string } {
  const name = ensName.trim().toLowerCase();
  const parent = PARENT();
  if (!name.endsWith(".eth")) throw new Error("Agent identity must be an ENS name.");
  if (name === parent) throw new Error(`${parent} is the platform namespace.`);
  if (name.endsWith(`.${parent}`)) {
    const label = name.slice(0, -(parent.length + 1));
    if (!label || label.includes(".")) throw new Error(`Mint one label under ${parent}.`);
    return { kind: "sub", label, parentLabel: parent.slice(0, -( ".eth".length)) };
  }
  const labels = name.split(".");
  if (labels.length === 2 && labels[0]) return { kind: "eth", label: labels[0] };
  throw new Error(`Mint a .eth name, or a subname of ${parent}.`);
}

export async function mintEns(
  ensName: string,
  owner: Address,
  options?: { pointAddress?: boolean },
): Promise<EnsMint> {
  const name = ensName.trim().toLowerCase();
  if (!process.env.SEPOLIA_RPC_URL) {
    return { minted: false, owner, kind: "skipped", error: "Set SEPOLIA_RPC_URL to mint on Sepolia." };
  }
  return enqueuePlatform(() => mintQueued(name, getAddress(owner), options));
}

async function mintQueued(
  ensName: string,
  owner: Address,
  options?: { pointAddress?: boolean },
): Promise<EnsMint> {
  try {
    const parsed = splitName(ensName);
    const account = platformAccount();
    const clients = sepoliaClients(account);
    if (!clients?.wallet) {
      return { minted: false, owner, kind: "skipped", error: "Set SEPOLIA_RPC_URL to mint on Sepolia." };
    }
    const balance = (await ethBalance(account.address)) ?? 0n;
    if (balance < 200_000_000_000_000n) {
      return {
        minted: false,
        owner,
        kind: "skipped",
        error: `Platform wallet ${account.address} needs Sepolia ETH for gas.`,
      };
    }
  if (parsed.kind === "eth") return await registerEth(ensName, parsed.label, owner, options);
  return await registerSubname(ensName, parsed.label, parsed.parentLabel, owner, options);
  } catch (error) {
    return { minted: false, owner, kind: "skipped", error: short(error) };
  }
}

async function readOwner(registry: Address, label: string): Promise<Address | undefined> {
  const clients = sepoliaClients(platformAccount());
  if (!clients) return undefined;
  try {
    const owner = await clients.publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "getOwner",
      args: [labelId(label)],
    });
    return owner === ZERO ? undefined : owner;
  } catch {
    return undefined;
  }
}

async function registerEth(
  ensName: string,
  label: string,
  owner: Address,
  options?: { pointAddress?: boolean },
): Promise<EnsMint> {
  const clients = sepoliaClients(platformAccount())!;
  const available = await clients.publicClient.readContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: "isAvailable",
    args: [label],
  });
  if (!available) {
    const current = await readOwner(ETH_REGISTRY, label);
    if (current && current.toLowerCase() === owner.toLowerCase()) {
      return { minted: false, owner, kind: "owned" };
    }
    return {
      minted: false,
      owner: current ?? owner,
      kind: "skipped",
      error: current ? `This name is already owned by ${current}.` : "This .eth name is not available.",
    };
  }
  const duration = await clients.publicClient.readContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: "MIN_REGISTER_DURATION",
  });
  const txHash = await commitAndRegister({
    key: ensName,
    label,
    owner,
    subregistry: ZERO,
    resolver: PUBLIC_RESOLVER,
    duration,
  });
  if (options?.pointAddress !== false) await pointAddress(ensName, owner);
  return { minted: true, owner, kind: "eth", txHash };
}

async function registerSubname(
  ensName: string,
  label: string,
  parentLabel: string,
  owner: Address,
  options?: { pointAddress?: boolean },
): Promise<EnsMint> {
  const registry = await ensureParentRegistry(parentLabel);
  const current = await readOwner(registry, label);
  if (current) {
    if (current.toLowerCase() === owner.toLowerCase()) return { minted: false, owner, kind: "owned" };
    return { minted: false, owner: current, kind: "skipped", error: `This name is already owned by ${current}.` };
  }
  const clients = sepoliaClients(platformAccount())!;
  const parentExpiry = await clients.publicClient.readContract({
    address: ETH_REGISTRY,
    abi: registryAbi,
    functionName: "getExpiry",
    args: [labelId(parentLabel)],
  });
  const expiry = parentExpiry - 3600n;
  if (expiry <= BigInt(Math.floor(Date.now() / 1000) + 120)) {
    return { minted: false, owner, kind: "skipped", error: "The platform name expires too soon to mint a subname." };
  }
  const hash = await clients.wallet!.writeContract({
    address: registry,
    abi: registryAbi,
    functionName: "register",
    args: [label, owner, ZERO, PUBLIC_RESOLVER, USER_NAME_ROLES, expiry],
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Subname registration reverted.");
  if (options?.pointAddress !== false) await pointAddress(ensName, owner);
  return { minted: true, owner, kind: "subname", txHash: hash };
}

async function ensureParentRegistry(parentLabel: string): Promise<Address> {
  const account = platformAccount();
  const clients = sepoliaClients(account)!;
  const salt = BigInt(
    keccak256(
      toHex(
        JSON.stringify({
          kind: "UserRegistry",
          name: `${parentLabel}.eth`,
          version: 0,
        }),
      ),
    ),
  );
  const predicted = await predictProxyAddress(account.address, salt);
  const code = await clients.publicClient.getBytecode({ address: predicted });
  const registry = code && code !== "0x" ? predicted : await deployRegistry(salt);
  await linkParent(registry, parentLabel);
  const linked = await clients.publicClient.readContract({
    address: ETH_REGISTRY,
    abi: registryAbi,
    functionName: "getSubregistry",
    args: [parentLabel],
  });
  if (linked === ZERO) {
    const owner = await readOwner(ETH_REGISTRY, parentLabel);
    if (owner && owner.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error(`${parentLabel}.eth is owned by ${owner}, so this platform cannot mint under it.`);
    }
    if (owner) {
      const hash = await clients.wallet!.writeContract({
        address: ETH_REGISTRY,
        abi: registryAbi,
        functionName: "setSubregistry",
        args: [labelId(parentLabel), registry],
      });
      const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Could not attach the subname registry.");
      return registry;
    }
    const duration = await clients.publicClient.readContract({
      address: ETH_REGISTRAR,
      abi: registrarAbi,
      functionName: "MIN_REGISTER_DURATION",
    });
    await commitAndRegister({
      key: `${parentLabel}.eth`,
      label: parentLabel,
      owner: account.address,
      subregistry: registry,
      resolver: PUBLIC_RESOLVER,
      duration,
    });
  }
  return registry;
}

async function predictProxyAddress(deployer: Address, salt: bigint): Promise<Address> {
  const clients = sepoliaClients()!;
  const proxyLogic = await clients.publicClient.readContract({
    address: VERIFIABLE_FACTORY,
    abi: factoryAbi,
    functionName: "proxyLogic",
  });
  const outerSalt = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [deployer, salt]),
  );
  const initCode = concat([
    "0x3d604d80600a3d3981f3363d3d373d3d3d363d73",
    proxyLogic,
    "0x5af43d82803e903d91602b57fd5bf3",
    outerSalt,
  ]);
  return getCreate2Address({
    from: VERIFIABLE_FACTORY,
    salt: outerSalt,
    bytecodeHash: keccak256(initCode),
  });
}

async function deployRegistry(salt: bigint): Promise<Address> {
  const account = platformAccount();
  const clients = sepoliaClients(account)!;
  const data = encodeFunctionData({
    abi: [
      {
        name: "initialize",
        type: "function",
        inputs: [
          {
            name: "grants",
            type: "tuple[]",
            components: [
              { name: "account", type: "address" },
              { name: "roleBitmap", type: "uint256" },
            ],
          },
        ],
        outputs: [],
      },
    ],
    functionName: "initialize",
    args: [[{ account: account.address, roleBitmap: PLATFORM_REGISTRY_ROLES }]],
  });
  const hash = await clients.wallet!.writeContract({
    address: VERIFIABLE_FACTORY,
    abi: factoryAbi,
    functionName: "deployProxy",
    args: [USER_REGISTRY_IMPL, salt, data],
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  const [log] = parseEventLogs({ abi: factoryAbi, eventName: "ProxyDeployed", logs: receipt.logs });
  if (!log) throw new Error("User registry deployment did not return a proxy.");
  return log.args.proxyAddress;
}

async function linkParent(registry: Address, parentLabel: string) {
  const clients = sepoliaClients(platformAccount())!;
  try {
    const [parent, label] = await clients.publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "getParent",
    });
    if (parent.toLowerCase() === ETH_REGISTRY.toLowerCase() && label === parentLabel) return;
  } catch {
    /* The registry has no parent until this call. */
  }
  const hash = await clients.wallet!.writeContract({
    address: registry,
    abi: registryAbi,
    functionName: "setParent",
    args: [ETH_REGISTRY, parentLabel],
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("Could not link the platform name registry.");
}

async function commitAndRegister(input: {
  key: string;
  label: string;
  owner: Address;
  subregistry: Address;
  resolver: Address;
  duration: bigint;
}): Promise<Hex> {
  const clients = sepoliaClients(platformAccount())!;
  const saved = (await readCommits())[input.key];
  const same =
    saved &&
    saved.owner.toLowerCase() === input.owner.toLowerCase() &&
    saved.subregistry.toLowerCase() === input.subregistry.toLowerCase() &&
    saved.label === input.label &&
    saved.duration === input.duration.toString();
  const secret = same ? saved.secret : keccak256(toHex(`${input.key}:${Date.now()}:${Math.random()}`));
  const [base, premium] = await clients.publicClient.readContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: "getRegisterPrice",
    args: [input.label, input.duration, MOCK_USDC],
  });
  const price = base + premium;
  const balance = await clients.publicClient.readContract({
    address: MOCK_USDC,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [platformAccount().address],
  });
  if (balance < price) {
    const minted = await clients.wallet!.writeContract({
      address: MOCK_USDC,
      abi: usdcAbi,
      functionName: "mint",
      args: [platformAccount().address, price * 2n],
    });
    await clients.publicClient.waitForTransactionReceipt({ hash: minted });
  }
  const approved = await clients.wallet!.writeContract({
    address: MOCK_USDC,
    abi: usdcAbi,
    functionName: "approve",
    args: [ETH_REGISTRAR, price],
  });
  await clients.publicClient.waitForTransactionReceipt({ hash: approved });
  const minAge = await clients.publicClient.readContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: "MIN_COMMITMENT_AGE",
  });
  if (!same) {
    const commitment = await clients.publicClient.readContract({
      address: ETH_REGISTRAR,
      abi: registrarAbi,
      functionName: "makeCommitment",
      args: [input.label, input.owner, secret, input.subregistry, input.resolver, input.duration, REFERRER],
    });
    const committed = await clients.wallet!.writeContract({
      address: ETH_REGISTRAR,
      abi: registrarAbi,
      functionName: "commit",
      args: [commitment],
    });
    await clients.publicClient.waitForTransactionReceipt({ hash: committed });
    await writeCommit(input.key, {
      label: input.label,
      owner: input.owner,
      secret,
      subregistry: input.subregistry,
      resolver: input.resolver,
      duration: input.duration.toString(),
      committedAt: Date.now(),
    });
  }
  const waitMs = Number(minAge) * 1000 + 4000 - (Date.now() - (same ? saved.committedAt : Date.now()));
  if (waitMs > 0) {
    if (process.env.VERCEL && waitMs > 20_000) {
      throw new Error("Sepolia commitment is in. Mint this name again in about a minute to finish.");
    }
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  const hash = await clients.wallet!.writeContract({
    address: ETH_REGISTRAR,
    abi: registrarAbi,
    functionName: "register",
    args: [input.label, input.owner, secret, input.subregistry, input.resolver, input.duration, MOCK_USDC, REFERRER],
  });
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("ENS registration reverted.");
  await writeCommit(input.key, undefined);
  return hash;
}

async function pointAddress(ensName: string, owner: Address) {
  const clients = sepoliaClients(platformAccount());
  if (!clients?.wallet) return;
  try {
    await dripEth(owner, 200_000_000_000_000n);
    const user = sepoliaClients((await agentEvmAccount(ensName)) ?? platformAccount());
    if (!user?.wallet) return;
    const hash = await user.wallet.writeContract({
      address: PUBLIC_RESOLVER,
      abi: resolverAbi,
      functionName: "setAddr",
      args: [namehash(ensName), owner],
    });
    await user.publicClient.waitForTransactionReceipt({ hash });
  } catch {
    /* The name is already owned. The address record can be set later by that wallet. */
  }
}

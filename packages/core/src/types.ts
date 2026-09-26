export const OUTCOMES = [
  "PURCHASE_COMPLETE",
  "IDENTITY_ALREADY_USED",
  "WORLD_ID_NOT_DETECTED",
  "PURCHASE_DENIED",
] as const;

export type Outcome = (typeof OUTCOMES)[number];

export type Concert = {
  id: string;
  name: string;
  venue: string;
  supply: number;
  sold: number;
  priceMist: string;
  maxPerHuman: number;
  saleEndsAt: number;
  createdAt: number;
  suiPoolId?: string;
  suiPoolError?: string;
};

export type Agent = {
  ensName: string;
  address?: string;
  evmAddress?: string;
  suiAddress?: string;
  avatarUrl: string;
  records: Record<string, string>;
  chainWrite: "written" | "skipped" | "failed";
  ensMint?: "minted" | "owned" | "skipped" | "failed";
  ensMintTx?: string;
  ensMintError?: string;
  createdAt: number;
};

export type Grant = {
  id: string;
  worldIdSub: string;
  issuer: string;
  ensName: string;
  concertId: string;
  permission: "ticket.buy";
  maxTickets: number;
  expiresAt: number;
  issuedAt: number;
  source: "oidc" | "dev";
};

export type Attempt = {
  id: string;
  ensName: string;
  avatarUrl: string;
  concertId: string;
  worldIdSub?: string;
  outcome: Outcome;
  reason: string;
  ticketHash?: string;
  suiObjectId?: string;
  suiAddress?: string;
  settlement: "sui" | "simulated" | "none";
  settlementError?: string;
  ensRecordKey?: string;
  at: number;
};

export type State = {
  concerts: Concert[];
  agents: Agent[];
  grants: Grant[];
  attempts: Attempt[];
};

export type Decision = {
  outcome: Outcome;
  reason: string;
  worldIdSub?: string;
  grantId?: string;
};

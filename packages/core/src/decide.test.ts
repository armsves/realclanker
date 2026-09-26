import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "./decide";
import type { Concert, Grant } from "./types";

const now = 1_700_000_000_000;

function concert(overrides: Partial<Concert> = {}): Concert {
  return {
    id: "show",
    name: "Midnight Signal",
    venue: "Tokyo",
    supply: 10,
    sold: 0,
    priceMist: "0",
    maxPerHuman: 1,
    saleEndsAt: now + 60_000,
    createdAt: now,
    ...overrides,
  };
}

function grant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: "g1",
    worldIdSub: "human-a",
    issuer: "https://sandbox.auth.world.org",
    ensName: "swift-otter.realclanker.eth",
    concertId: "show",
    permission: "ticket.buy",
    maxTickets: 1,
    expiresAt: now + 60_000,
    issuedAt: now,
    source: "oidc",
    ...overrides,
  };
}

test("authorized agent completes a purchase", () => {
  const decision = decide({
    now,
    concertId: "show",
    concert: concert(),
    grantsForAgent: [grant()],
    completedByHuman: () => 0,
  });
  assert.equal(decision.outcome, "PURCHASE_COMPLETE");
});

test("a second agent sharing the World ID is rejected", () => {
  const decision = decide({
    now,
    concertId: "show",
    concert: concert(),
    grantsForAgent: [grant({ ensName: "clone.realclanker.eth" })],
    completedByHuman: () => 1,
  });
  assert.equal(decision.outcome, "IDENTITY_ALREADY_USED");
});

test("missing World ID is not detected", () => {
  const decision = decide({
    now,
    concertId: "show",
    concert: concert(),
    grantsForAgent: [],
    completedByHuman: () => 0,
  });
  assert.equal(decision.outcome, "WORLD_ID_NOT_DETECTED");
});

test("expired and wrong-concert grants are denied", () => {
  const expired = decide({
    now,
    concertId: "show",
    concert: concert(),
    grantsForAgent: [grant({ expiresAt: now - 1 })],
    completedByHuman: () => 0,
  });
  assert.equal(expired.outcome, "PURCHASE_DENIED");
  assert.match(expired.reason, /expired/i);

  const wrongShow = decide({
    now,
    concertId: "show",
    concert: concert(),
    grantsForAgent: [grant({ concertId: "other-show" })],
    completedByHuman: () => 0,
  });
  assert.equal(wrongShow.outcome, "PURCHASE_DENIED");
  assert.match(wrongShow.reason, /not valid for this concert/i);
});

test("a sale that has not opened yet is denied", () => {
  const decision = decide({
    now,
    concertId: "show",
    concert: concert({ saleStartsAt: now + 60_000, saleEndsAt: now + 120_000 }),
    grantsForAgent: [grant()],
    completedByHuman: () => 0,
  });
  assert.equal(decision.outcome, "PURCHASE_DENIED");
  assert.match(decision.reason, /not started/i);
});

test("sold out supply denies a valid human", () => {
  const decision = decide({
    now,
    concertId: "show",
    concert: concert({ sold: 10, supply: 10 }),
    grantsForAgent: [grant()],
    completedByHuman: () => 0,
  });
  assert.equal(decision.outcome, "PURCHASE_DENIED");
  assert.match(decision.reason, /exhausted/i);
});

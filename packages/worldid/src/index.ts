import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "jose";

export const DEFAULT_ISSUER = "https://sandbox.auth.world.org";

export type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

export function issuer(): string {
  return process.env.WORLD_ID_ISSUER || DEFAULT_ISSUER;
}

export function devMode(): boolean {
  return process.env.REALCLANKER_DEV_MODE === "true";
}

export async function discover(): Promise<Discovery> {
  const base = issuer().replace(/\/$/, "");
  const response = await fetch(`${base}/.well-known/openid-configuration`);
  if (!response.ok) {
    throw new Error(`World ID discovery failed (${response.status}).`);
  }
  return (await response.json()) as Discovery;
}

export function createPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  return { verifier, challenge, state, nonce };
}

export function authorizationUrl(input: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  challenge: string;
}): string {
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", "openid");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function clientAssertion(tokenEndpoint: string): Promise<Record<string, string>> {
  const clientId = process.env.WORLD_ID_CLIENT_ID;
  if (!clientId) throw new Error("WORLD_ID_CLIENT_ID is not set.");
  const secret = process.env.WORLD_ID_CLIENT_SECRET;
  if (secret) {
    return { client_id: clientId, client_secret: secret };
  }
  const pem = process.env.WORLD_ID_CLIENT_PRIVATE_KEY;
  if (!pem) {
    throw new Error("Set WORLD_ID_CLIENT_SECRET or WORLD_ID_CLIENT_PRIVATE_KEY.");
  }
  const key = await importPKCS8(pem.replace(/\\n/g, "\n"), "RS256");
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(tokenEndpoint)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(key);
  return {
    client_id: clientId,
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
  };
}

export type WorldIdClaims = {
  iss: string;
  sub: string;
  aud?: string;
  iat?: number;
  exp?: number;
  nonce?: string;
};

export async function exchangeCode(input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
  nonce: string;
}): Promise<{ sub: string; issuer: string; idToken: string; claims: WorldIdClaims }> {
  const metadata = await discover();
  const clientId = process.env.WORLD_ID_CLIENT_ID;
  if (!clientId) throw new Error("WORLD_ID_CLIENT_ID is not set.");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    ...(await clientAssertion(metadata.token_endpoint)),
  });
  const response = await fetch(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as { id_token?: string; error?: string };
  if (!response.ok || !payload.id_token) {
    throw new Error(payload.error || `Token exchange failed (${response.status}).`);
  }
  const verified = await verifyIdToken(payload.id_token, input.nonce);
  return { ...verified, idToken: payload.id_token };
}

function claimString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export async function verifyIdToken(
  idToken: string,
  nonce?: string,
): Promise<{ sub: string; issuer: string; claims: WorldIdClaims }> {
  const metadata = await discover();
  const clientId = process.env.WORLD_ID_CLIENT_ID;
  if (!clientId) throw new Error("WORLD_ID_CLIENT_ID is not set.");
  const jwks = createRemoteJWKSet(new URL(metadata.jwks_uri));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: metadata.issuer,
    audience: clientId,
  });
  if (nonce && payload.nonce !== nonce) {
    throw new Error("World ID nonce did not match.");
  }
  if (!payload.sub) throw new Error("World ID token has no subject.");
  const claims: WorldIdClaims = {
    iss: metadata.issuer,
    sub: payload.sub,
    aud: claimString(payload.aud),
    iat: typeof payload.iat === "number" ? payload.iat : undefined,
    exp: typeof payload.exp === "number" ? payload.exp : undefined,
    nonce: typeof payload.nonce === "string" ? payload.nonce : undefined,
  };
  return { sub: payload.sub, issuer: metadata.issuer, claims };
}

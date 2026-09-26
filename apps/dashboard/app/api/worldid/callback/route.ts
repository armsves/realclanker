import { cookies } from "next/headers";
import { exchangeCode } from "@realclanker/worldid";
import { issueGrant } from "@realclanker/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return Response.redirect(new URL(`/?worldid=error&message=${encodeURIComponent(oauthError)}`, request.url));
  }
  const jar = await cookies();
  const raw = jar.get("rc_oidc")?.value;
  if (!raw || !code || !state) {
    return Response.redirect(new URL("/?worldid=error&message=Missing+World+ID+session", request.url));
  }
  const session = JSON.parse(raw) as {
    verifier: string;
    state: string;
    nonce: string;
    ensName: string;
    concertId: string;
  };
  if (session.state !== state) {
    return Response.redirect(new URL("/?worldid=error&message=State+mismatch", request.url));
  }
  try {
    const redirectUri = `${process.env.REALCLANKER_PUBLIC_URL || "http://localhost:3000"}/api/worldid/callback`;
    const verified = await exchangeCode({
      code,
      redirectUri,
      codeVerifier: session.verifier,
      nonce: session.nonce,
    });
    await issueGrant({
      ensName: session.ensName,
      concertId: session.concertId,
      maxTickets: 1,
      expiresAt: Date.now() + 15 * 60 * 1000,
      verified,
    });
    jar.delete("rc_oidc");
    return Response.redirect(new URL("/?worldid=ok", request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "World ID callback failed";
    return Response.redirect(new URL(`/?worldid=error&message=${encodeURIComponent(message)}`, request.url));
  }
}

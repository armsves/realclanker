import { cookies } from "next/headers";
import { authorizationUrl, createPkce, discover } from "@realclanker/worldid";
import { registerAgent } from "@realclanker/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const concertId = url.searchParams.get("concertId") ?? "";
  const ensName = (url.searchParams.get("ensName") ?? "").trim().toLowerCase();
  const clientId = process.env.WORLD_ID_CLIENT_ID;
  if (!clientId) {
    return Response.redirect(new URL("/?worldid=error&message=Set+WORLD_ID_CLIENT_ID+from+the+sandbox+portal", request.url));
  }
  if (!concertId || !ensName.endsWith(".eth")) {
    return Response.redirect(new URL("/?worldid=error&message=Choose+a+concert+and+an+ENS+name", request.url));
  }
  try {
    await registerAgent(ensName);
    const pkce = createPkce();
    const metadata = await discover();
    const redirectUri = `${process.env.REALCLANKER_PUBLIC_URL || "http://localhost:3000"}/api/worldid/callback`;
    const jar = await cookies();
    jar.set(
      "rc_oidc",
      JSON.stringify({ ...pkce, ensName, concertId }),
      { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 },
    );
    return Response.redirect(
      authorizationUrl({
        authorizationEndpoint: metadata.authorization_endpoint,
        clientId,
        redirectUri,
        state: pkce.state,
        nonce: pkce.nonce,
        challenge: pkce.challenge,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "World ID start failed";
    return Response.redirect(new URL(`/?worldid=error&message=${encodeURIComponent(message)}`, request.url));
  }
}

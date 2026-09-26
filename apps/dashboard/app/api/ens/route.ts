import { registerAgent } from "@realclanker/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json()) as { ensName?: string };
  const ensName = body.ensName?.trim().toLowerCase() ?? "";
  if (!ensName.endsWith(".eth")) {
    return Response.json({ error: "Enter an ENS name." }, { status: 400 });
  }
  try {
    const agent = await registerAgent(ensName, { mint: true });
    return Response.json({
      ensName: agent.ensName,
      evmAddress: agent.evmAddress,
      suiAddress: agent.suiAddress,
      ensMint: agent.ensMint,
      ensMintTx: agent.ensMintTx,
      ensMintError: agent.ensMintError,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ENS mint failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}

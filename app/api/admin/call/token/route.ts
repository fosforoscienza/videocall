import { NextResponse } from "next/server";
import { activeCall, callToken, checkLiveKit, requireOrganizer } from "@/lib/video";

export const dynamic = "force-dynamic";

// Gettone per l'organizzatore: entra subito, senza sala d'attesa
export async function GET() {
  const admin = await requireOrganizer();
  if (!admin) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const { call, error } = await activeCall();
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!call) return NextResponse.json({ error: "Nessuna videochiamata in corso" }, { status: 404 });
  // Prima di entrare verifica le impostazioni di LiveKit e dice cosa non va
  const problem = await checkLiveKit();
  if (problem) return NextResponse.json({ error: problem }, { status: 500 });
  const token = await callToken(call.id, { identity: admin.id, name: admin.name, host: true });
  if (!token) return NextResponse.json({ error: "Videochiamate non configurate" }, { status: 500 });
  return NextResponse.json(token, { headers: { "Cache-Control": "no-store" } });
}

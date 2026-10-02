import { NextResponse } from "next/server";
import { login, startSession } from "@/lib/video-auth";

// Accesso degli organizzatori alla pagina di gestione
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const result = await login(body.username, body.password);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  if (!result.user.organizer) {
    return NextResponse.json({ error: "Questa pagina è per gli organizzatori: entra dal link della videochiamata." }, { status: 403 });
  }
  await startSession(result.user);
  return NextResponse.json({ ok: true });
}

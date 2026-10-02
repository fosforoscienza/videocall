import { NextResponse } from "next/server";
import { activeCall, cleanTitle, endCall, isOpenAccess, isShareAll, listRequests, openCalls, renameCall, requireCallHost, requireOrganizer, startCall, videoConfigured } from "@/lib/video";

export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ error: "Non autorizzato" }, { status: 401 });

// Videochiamata in corso con la sala d'attesa (chi chiede di entrare e chi è stato ammesso) e quelle programmate
export async function GET() {
  // Anche i co-organizzatori (partecipanti nominati durante la chiamata) vedono la sala d'attesa
  const host = await requireCallHost();
  if (!host) return unauthorized();
  const { live: call, scheduled, canSchedule, error } = await openCalls();
  if (error) return NextResponse.json({ error }, { status: 500 });
  const requests = call ? await listRequests(call.id) : [];
  return NextResponse.json(
    {
      configured: videoConfigured(),
      openAccess: await isOpenAccess(),
      shareAll: await isShareAll(),
      call,
      requests,
      scheduled: host.admin ? scheduled : [],
      canSchedule,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// Avvia una videochiamata (o restituisce quella già attiva), con il nome scelto
export async function POST(req: Request) {
  const admin = await requireOrganizer();
  if (!admin) return unauthorized();
  if (!videoConfigured()) {
    return NextResponse.json(
      { error: "Videochiamate non configurate: mancano LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET su Vercel." },
      { status: 500 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const { call, error, warning } = await startCall(admin.name, cleanTitle(body.title), body.listenOnly === true);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ call, warning });
}

// Cambia il nome della videochiamata in corso
export async function PATCH(req: Request) {
  if (!(await requireCallHost())) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const { call, error } = await activeCall();
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!call) return NextResponse.json({ error: "Nessuna videochiamata in corso" }, { status: 404 });
  const res = await renameCall(call.id, cleanTitle(body.title));
  if (res.error) return NextResponse.json({ error: res.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Termina la videochiamata per tutti
export async function DELETE() {
  if (!(await requireCallHost())) return unauthorized();
  const { call, error } = await activeCall();
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (call) {
    const res = await endCall(call.id);
    if (res.error) return NextResponse.json({ error: res.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

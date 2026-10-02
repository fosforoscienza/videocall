import { NextResponse } from "next/server";
import { cancelScheduled, cleanAccess, cleanTitle, requireOrganizer, scheduleCall, startScheduled, updateScheduled, videoConfigured } from "@/lib/video";

export const dynamic = "force-dynamic";

// Videochiamate programmate: crea, modifica, annulla o avvia
export async function POST(req: Request) {
  const admin = await requireOrganizer();
  if (!admin) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const action = body.action;
  const id = typeof body.id === "string" ? body.id : "";
  const title = cleanTitle(body.title);
  const listenOnly = typeof body.listenOnly === "boolean" ? body.listenOnly : undefined;
  const startsAt = typeof body.startsAt === "string" && !Number.isNaN(Date.parse(body.startsAt)) ? new Date(body.startsAt).toISOString() : "";

  // Accesso alla riunione (libero, password, sala d'attesa): facoltativo
  const access = body.access === undefined ? undefined : cleanAccess(body.access);
  if (access === null) return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  if (access && "error" in access) return NextResponse.json({ error: access.error }, { status: 400 });

  let result: { error?: string };
  if (action === "create" || action === "update") {
    if (!startsAt) return NextResponse.json({ error: "Scegli data e ora" }, { status: 400 });
    if (action === "create") {
      if (!videoConfigured()) return NextResponse.json({ error: "Videochiamate non configurate su Vercel (LiveKit)." }, { status: 500 });
      result = await scheduleCall(admin.name, title, startsAt, listenOnly === true, access);
    } else {
      if (!id) return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
      result = await updateScheduled(id, title, startsAt, listenOnly, access);
    }
  } else if (action === "cancel" && id) result = await cancelScheduled(id);
  else if (action === "start" && id) result = await startScheduled(id);
  else return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });

  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import {
  activeCall,
  applyGuestPermissionsInRoom,
  listRequests,
  requireCallHost,
  setListenOnly,
  setOpenAccess,
  setRequestStatus,
  setShareAll,
} from "@/lib/video";

export const dynamic = "force-dynamic";

// Impostazioni della videochiamata: sala d'attesa o accesso libero (passando all'accesso libero entra
// subito anche chi sta aspettando), condivisione schermo permessa a tutti o solo agli organizzatori
// e, per la chiamata in corso, solo ascolto (i partecipanti non parlano, scrivono solo in chat).
export async function POST(req: Request) {
  if (!(await requireCallHost())) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const hasOpen = typeof body.openAccess === "boolean";
  const hasShare = typeof body.shareAll === "boolean";
  const hasListen = typeof body.listenOnly === "boolean";
  if (!hasOpen && !hasShare && !hasListen) return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  const { call } = await activeCall();

  if (hasOpen) {
    const { error } = await setOpenAccess(body.openAccess);
    if (error) return NextResponse.json({ error }, { status: 500 });
    if (body.openAccess && call) {
      const pending = (await listRequests(call.id)).filter((r) => r.status === "pending").map((r) => r.identity);
      if (pending.length) await setRequestStatus(call.id, pending, "accepted", true);
    }
  }
  if (hasShare) {
    const { error } = await setShareAll(body.shareAll);
    if (error) return NextResponse.json({ error }, { status: 500 });
  }
  if (hasListen) {
    if (!call) return NextResponse.json({ error: "Nessuna videochiamata in corso" }, { status: 404 });
    const { error } = await setListenOnly(call.id, body.listenOnly);
    if (error) return NextResponse.json({ error }, { status: 500 });
  }
  // Vale subito anche per chi è già nella chiamata
  if ((hasShare || hasListen) && call) await applyGuestPermissionsInRoom(call.id);
  return NextResponse.json({ ok: true });
}

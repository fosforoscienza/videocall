import { NextResponse } from "next/server";
import { activeCall, listRequests, muteAllInRoom, muteInRoom, removeFromRoom, requireCallHost, setCohost, setRequestStatus } from "@/lib/video";
import type { HostAction } from "@/lib/video-types";

export const dynamic = "force-dynamic";

const ACTIONS: HostAction[] = ["accept", "reject", "remove", "mute", "mute_all", "accept_all", "make_cohost", "remove_cohost"];

// L'organizzatore (o un co-organizzatore) ammette, rifiuta, silenzia o toglie i partecipanti e nomina i co-organizzatori
export async function POST(req: Request) {
  if (!(await requireCallHost())) return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const action = body.action as HostAction;
  const identity = typeof body.identity === "string" ? body.identity : "";
  if (!ACTIONS.includes(action) || (action !== "accept_all" && action !== "mute_all" && !identity)) {
    return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  }

  const { call, error } = await activeCall();
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (!call) return NextResponse.json({ error: "Nessuna videochiamata in corso" }, { status: 404 });

  let result: { error?: string } = {};
  if (action === "accept") result = await setRequestStatus(call.id, [identity], "accepted");
  else if (action === "reject") result = await setRequestStatus(call.id, [identity], "rejected", true);
  else if (action === "accept_all") {
    const pending = (await listRequests(call.id)).filter((r) => r.status === "pending").map((r) => r.identity);
    if (pending.length) result = await setRequestStatus(call.id, pending, "accepted", true);
  } else if (action === "remove") {
    // Prima il database, così non può farsi ridare il gettone per rientrare
    result = await setRequestStatus(call.id, [identity], "removed");
    if (!result.error) await removeFromRoom(call.id, identity);
  } else if (action === "make_cohost" || action === "remove_cohost") {
    result = await setCohost(call.id, identity, action === "make_cohost");
  } else if (action === "mute_all") {
    await muteAllInRoom(call.id);
  } else if (action === "mute") {
    if (typeof body.trackSid !== "string" || !body.trackSid) {
      return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
    }
    await muteInRoom(call.id, identity, body.trackSid);
  }
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}

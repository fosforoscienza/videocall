import { NextResponse } from "next/server";
import { callByCode, callToken, currentParticipant, getBreakouts, getRequest, hostRole } from "@/lib/video";
import { codeFromSlug, isLive } from "@/lib/video-types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

// Gettone per spostarsi tra plenaria (?room=main) e stanze (?room=<id>). I partecipanti entrano solo
// in plenaria o nella stanza a cui sono assegnati; organizzatori e co-organizzatori dove vogliono.
export async function GET(req: Request, { params }: Ctx) {
  const call = await callByCode(codeFromSlug((await params).code));
  if (!call || !isLive(call)) return fail("Nessuna videochiamata in corso", 404);
  let who = await currentParticipant();
  if (!who) return fail("Non autorizzato", 401);
  const role = who.host ? null : await hostRole(call.id, who.identity);
  if (role) who = { ...who, host: true, cohost: role === "cohost" };
  if (!who.host && (await getRequest(call.id, who.identity))?.status !== "accepted") return fail("Non autorizzato", 401);

  const wanted = new URL(req.url).searchParams.get("room") || "main";
  const { rooms, assign } = await getBreakouts(call.id);
  const room = wanted === "main" ? null : (rooms.find((r) => r.id === wanted) ?? null);
  if (wanted !== "main" && !room) return fail("Questa stanza è stata chiusa", 404);
  if (room && !who.host && assign[who.identity] !== room.id) return fail("Non sei assegnato a questa stanza", 403);

  const token = await callToken(call.id, who, room?.id ?? null);
  if (!token) return fail("Videochiamate non configurate", 500);
  return NextResponse.json(
    { ...token, room, host: who.host, listenOnly: !room && !who.host && !!call.listen_only },
    { headers: { "Cache-Control": "no-store" } }
  );
}

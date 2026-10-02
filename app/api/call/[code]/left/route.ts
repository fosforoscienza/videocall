import { NextResponse } from "next/server";
import { callByCode, currentParticipant, getRequest, isCallHost, leftCall } from "@/lib/video";
import { codeFromSlug, isLive } from "@/lib/video-types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

// Chi preme "Esci": se era l'ultima persona collegata (in plenaria e nelle stanze) la chiamata termina per tutti
export async function POST(_req: Request, { params }: Ctx) {
  const call = await callByCode(codeFromSlug((await params).code));
  if (!call || !isLive(call)) return NextResponse.json({ ended: true });
  const who = await currentParticipant();
  if (!who) return NextResponse.json({ ended: false }, { status: 401 });
  const allowed = (await isCallHost(call.id, who)) || (await getRequest(call.id, who.identity))?.status === "accepted";
  if (!allowed) return NextResponse.json({ ended: false }, { status: 401 });
  return NextResponse.json(await leftCall(call.id, who.identity));
}

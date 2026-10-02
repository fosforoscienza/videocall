import { NextResponse } from "next/server";
import { callByCode, claimHost, currentParticipant } from "@/lib/video";
import { codeFromSlug, isLive } from "@/lib/video-types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

// L'organizzatore è uscito: chi tocca (il co-organizzatore o chi è entrato per primo) diventa organizzatore.
// Il server controlla nella stanza che l'organizzatore non ci sia davvero e che sia il turno di chi chiede.
export async function POST(_req: Request, { params }: Ctx) {
  const call = await callByCode(codeFromSlug((await params).code));
  if (!call || !isLive(call)) return NextResponse.json({ ok: false }, { status: 404 });
  const who = await currentParticipant();
  if (!who) return NextResponse.json({ ok: false }, { status: 401 });
  const { ok } = await claimHost(call.id, who.identity);
  return NextResponse.json({ ok }, { status: ok ? 200 : 409 });
}

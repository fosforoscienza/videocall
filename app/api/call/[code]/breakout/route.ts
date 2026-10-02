import { NextResponse } from "next/server";
import {
  breakoutPresence,
  callByCode,
  cleanBreakouts,
  currentParticipant,
  getBreakouts,
  getRequest,
  isCallHost,
  notifyBreakouts,
  saveBreakouts,
} from "@/lib/video";
import { codeFromSlug, isLive, type BreakoutState } from "@/lib/video-types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

const json = (data: BreakoutState | { error: string } | { ok: true }, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

async function context(code: string) {
  const call = await callByCode(codeFromSlug(code));
  if (!call || !isLive(call)) return { error: json({ error: "Nessuna videochiamata in corso" }, 404) };
  const who = await currentParticipant();
  if (!who) return { error: json({ error: "Non autorizzato" }, 401) };
  return { call, who, manager: await isCallHost(call.id, who) };
}

// Stanze aperte e quella assegnata a chi chiede. Chi gestisce la chiamata vede anche assegnazioni e presenze.
export async function GET(_req: Request, { params }: Ctx) {
  const ctx = await context((await params).code);
  if ("error" in ctx) return ctx.error;
  const { call, who, manager } = ctx;
  if (!manager && (await getRequest(call.id, who.identity))?.status !== "accepted") return json({ error: "Non autorizzato" }, 401);
  const b = await getBreakouts(call.id);
  const state: BreakoutState = { rooms: b.rooms, mine: b.assign[who.identity] ?? null };
  if (manager) {
    state.assign = b.assign;
    state.presence = await breakoutPresence(call.id, b.rooms);
  }
  return json(state);
}

// L'organizzatore apre, modifica o chiude (rooms vuoto) le stanze; tutti vengono avvisati e si spostano da soli
export async function POST(req: Request, { params }: Ctx) {
  const ctx = await context((await params).code);
  if ("error" in ctx) return ctx.error;
  const { call, manager } = ctx;
  if (!manager) return json({ error: "Non autorizzato" }, 401);
  const body = await req.json().catch(() => null);
  const next = cleanBreakouts(body);
  if (!next) return json({ error: "Richiesta non valida" }, 400);
  const before = await getBreakouts(call.id);
  const res = await saveBreakouts(call.id, next);
  if (res.error) return json({ error: res.error }, 500);
  await notifyBreakouts(call.id, [...before.rooms, ...next.rooms].map((r) => r.id));
  return json({ ok: true });
}

import { NextResponse } from "next/server";
import { callByCode, currentParticipant, getRequest, isCallHost, notifyCall } from "@/lib/video";
import { managePoll, pollsFor, vote } from "@/lib/polls";
import { codeFromSlug, isLive, POLL_TOPIC, type PollAction, type PollsState } from "@/lib/video-types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

const ACTIONS: PollAction[] = ["create", "update", "delete", "open", "close", "show", "hide"];

const json = (data: PollsState | { error: string }, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });

// Chi gestisce la chiamata (organizzatori e co-organizzatori) prepara i sondaggi anche prima che inizi;
// gli altri li vedono e votano solo durante la chiamata, dopo essere stati ammessi
async function context(code: string) {
  const call = await callByCode(codeFromSlug(code));
  if (!call) return { error: json({ error: "Videochiamata terminata" }, 404) };
  const who = await currentParticipant();
  if (!who) return { error: json({ error: "Non autorizzato" }, 401) };
  const manager = await isCallHost(call.id, who);
  if (!manager && (!isLive(call) || (await getRequest(call.id, who.identity))?.status !== "accepted")) {
    return { error: json({ error: "Non autorizzato" }, 401) };
  }
  return { call, who, manager };
}

export async function GET(_req: Request, { params }: Ctx) {
  const ctx = await context((await params).code);
  if ("error" in ctx) return ctx.error;
  const { call, who, manager } = ctx;
  return json({ polls: await pollsFor(call.id, who.identity, manager), manager });
}

// Voto (tutti) o modifica dei sondaggi (solo chi gestisce). Chi è collegato viene avvisato e rilegge i sondaggi.
export async function POST(req: Request, { params }: Ctx) {
  const ctx = await context((await params).code);
  if ("error" in ctx) return ctx.error;
  const { call, who, manager } = ctx;
  const body = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown; choices?: unknown; poll?: unknown } | null;
  const action = body?.action;

  if (action === "vote") {
    if (!isLive(call)) return json({ error: "La videochiamata non è ancora iniziata" }, 400);
    const res = await vote(call.id, body?.id, who, body?.choices);
    if (res.error) return json({ error: res.error }, 400);
    // Un voto segreto cambia qualcosa solo per chi vede i risultati: gli altri non rileggono
    await notifyCall(call.id, POLL_TOPIC, { kind: "vote", secret: res.secret });
  } else {
    if (!manager) return json({ error: "Non autorizzato" }, 401);
    if (!ACTIONS.includes(action as PollAction)) return json({ error: "Richiesta non valida" }, 400);
    const res = await managePoll(call.id, action as PollAction, body?.id, body?.poll);
    if (res.error) return json({ error: res.error }, 400);
    if (isLive(call)) await notifyCall(call.id, POLL_TOPIC, { kind: "change" });
  }
  return json({ polls: await pollsFor(call.id, who.identity, manager), manager });
}

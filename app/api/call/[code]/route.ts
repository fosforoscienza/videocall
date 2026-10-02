import { NextResponse } from "next/server";
import { login, startSession, type VideoUser } from "@/lib/video-auth";
import { ENTER_WITH } from "@/lib/video-config";
import {
  callByCode,
  callToken,
  currentParticipant,
  deleteRequest,
  getRequest,
  hostRole,
  isOpenAccess,
  saveRequest,
  type Participant,
} from "@/lib/video";
import { codeFromSlug, isLive, type CallInfo, type JoinState } from "@/lib/video-types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

const json = (state: JoinState | { error: string }, status = 200) =>
  NextResponse.json(state, { status, headers: { "Cache-Control": "no-store" } });

async function accepted(call: CallInfo, who: Participant) {
  // Chi è stato nominato co-organizzatore (o è diventato organizzatore) rientra con i suoi poteri
  const role = who.host ? null : await hostRole(call.id, who.identity);
  if (role) who = { ...who, host: true, cohost: role === "cohost" };
  const token = await callToken(call.id, who);
  if (!token) return json({ error: "Videochiamate non configurate" }, 500);
  return json({ status: "accepted", name: who.name, host: who.host, listenOnly: !who.host && !!call.listen_only, ...token });
}

// Stato di chi ha aperto il link: in attesa, ammesso (con il gettone per collegarsi), rifiutato...
export async function GET(_req: Request, { params }: Ctx) {
  const code = codeFromSlug((await params).code);
  const call = await callByCode(code);
  if (!call) return json({ status: "ended" });
  const who = await currentParticipant();
  // Programmata e non ancora avviata dall'organizzatore: si aspetta
  if (!isLive(call)) return json({ status: "scheduled", startsAt: call.starts_at ?? null, name: who?.name });
  if (!who) return json({ status: "none" });
  if (who.host) return accepted(call, who);
  const request = await getRequest(call.id, who.identity);
  if (request?.status === "accepted") return accepted(call, who);
  return json({ status: request?.status ?? "none", name: who.name });
}

// Chiede di entrare. Con i dati del modulo fa anche l'accesso; senza usa la sessione attuale.
export async function POST(req: Request, { params }: Ctx) {
  const code = codeFromSlug((await params).code);
  const call = await callByCode(code);
  if (!call) return json({ status: "ended" });

  const body = await req.json().catch(() => ({}));
  let user: VideoUser | undefined;
  if (body.username !== undefined || body.password !== undefined) {
    const result = await login(body.username, body.password);
    if ("error" in result) return json({ error: result.error }, result.status);
    user = result.user;
  }
  const who = await currentParticipant(user);
  if (!who) return json({ error: user ? "Utente non valido" : `Inserisci ${ENTER_WITH}` }, 401);
  if (user) await startSession(user);
  // Ancora da iniziare: l'accesso è fatto, si entra appena l'organizzatore la avvia
  if (!isLive(call)) return json({ status: "scheduled", startsAt: call.starts_at ?? null, name: who.name });

  if (who.host) return accepted(call, who);
  const request = await getRequest(call.id, who.identity);
  // Chi è già stato ammesso rientra subito (pagina ricaricata, connessione caduta...)
  if (request?.status === "accepted") return accepted(call, who);
  // Accesso libero: si entra subito. Chi era stato rifiutato o tolto deve comunque essere riammesso.
  if ((!request || request.status === "pending") && (await isOpenAccess())) {
    const { error } = await saveRequest(call.id, who, "accepted", !request);
    if (error) return json({ error }, 500);
    return accepted(call, who);
  }
  const { error } = await saveRequest(call.id, who, "pending", request?.status !== "pending");
  if (error) return json({ error }, 500);
  return json({ status: "pending", name: who.name });
}

// Rinuncia a entrare: la richiesta sparisce dalla sala d'attesa dell'organizzatore
export async function DELETE(_req: Request, { params }: Ctx) {
  const code = codeFromSlug((await params).code);
  const call = await callByCode(code);
  const who = await currentParticipant();
  if (call && who) {
    const request = await getRequest(call.id, who.identity);
    if (request?.status === "pending") await deleteRequest(call.id, who.identity);
  }
  return json({ status: "none" });
}

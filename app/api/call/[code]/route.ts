import { NextResponse } from "next/server";
import { currentUser, guestUser, startSession, type VideoUser } from "@/lib/video-auth";
import {
  autoEndIfEmpty,
  callByCode,
  callToken,
  currentParticipant,
  deleteRequest,
  getRequest,
  getAccess,
  hostRole,
  passwordMatches,
  saveRequest,
  type Participant,
} from "@/lib/video";
import { codeFromSlug, isLive, needsPassword, type CallInfo, type JoinState } from "@/lib/video-types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

const json = (state: JoinState | { error: string; needsPassword?: boolean }, status = 200) =>
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
  // Rimasta vuota (chi c'era ha chiuso la pagina): termina da sola
  if (await autoEndIfEmpty(call)) return json({ status: "ended" });
  const who = await currentParticipant();
  // Programmata e non ancora avviata dall'organizzatore: si aspetta
  if (!isLive(call)) return json({ status: "scheduled", startsAt: call.starts_at ?? null, name: who?.name });
  if (!who) return json({ status: "none" });
  if (who.host) return accepted(call, who);
  const request = await getRequest(call.id, who.identity);
  if (request?.status === "accepted") return accepted(call, who);
  return json({ status: request?.status ?? "none", name: who.name });
}

// Chiede di entrare. Con il modulo arriva il nome (e la password della riunione, se serve); senza si usa la
// sessione attuale. Accesso libero o password giusta: si entra subito. Sala d'attesa: l'organizzatore ammette.
export async function POST(req: Request, { params }: Ctx) {
  const code = codeFromSlug((await params).code);
  const call = await callByCode(code);
  if (!call) return json({ status: "ended" });
  const access = await getAccess(call.id);

  const body = await req.json().catch(() => ({}));
  const current = await currentUser();
  let user: VideoUser | undefined;
  if (body.name !== undefined) {
    const result = guestUser(body.name, current?.organizer ? null : current);
    if ("error" in result) return json({ error: result.error }, result.status);
    user = current?.organizer ? undefined : result.user;
  }
  const who = await currentParticipant(user ?? current);
  if (!who) return json({ error: "Scrivi il tuo nome" }, 401);
  if (who.host) return isLive(call) ? accepted(call, who) : json({ status: "scheduled", startsAt: call.starts_at ?? null, name: who.name });

  const request = await getRequest(call.id, who.identity);
  // Chi è già stato ammesso rientra subito (pagina ricaricata, connessione caduta...), anche senza password
  if (request?.status === "accepted") {
    if (user) await startSession(user);
    return isLive(call) ? accepted(call, who) : json({ status: "scheduled", startsAt: call.starts_at ?? null, name: who.name });
  }
  // Password della riunione: va scritta ogni volta che non si è ancora stati ammessi
  if (needsPassword(access) && !passwordMatches(access, body.password)) {
    return json({ error: body.password ? "Password della riunione non valida" : "Scrivi la password della riunione", needsPassword: true }, 401);
  }
  if (user) await startSession(user);

  // Libero o con password: ammesso subito (anche prima dell'inizio: entrerà appena l'organizzatore la avvia).
  // Chi era stato rifiutato o tolto deve comunque essere riammesso dall'organizzatore.
  const direct = access.mode !== "waiting" && (!request || request.status === "pending");
  const status = direct ? "accepted" : "pending";
  const { error } = await saveRequest(call.id, who, status, !request || (status === "pending" && request.status !== "pending"));
  if (error) return json({ error }, 500);
  if (!isLive(call)) return json({ status: "scheduled", startsAt: call.starts_at ?? null, name: who.name });
  if (direct) return accepted(call, who);
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

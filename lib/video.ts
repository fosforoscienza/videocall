import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { AccessToken, DataPacket_Kind, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { isDemo } from "./demo-db";
import { supabaseAdmin } from "./supabase-admin";
import { currentUser, type VideoUser } from "./video-auth";
import {
  BREAKOUT_TOPIC,
  DEFAULT_ACCESS,
  isLive,
  MAX_PASSWORD,
  needsPassword,
  type AccessMode,
  type CallAccess,
  MAX_BREAKOUT_NAME,
  MAX_BREAKOUTS,
  type BreakoutRoom,
  type Breakouts,
  type CallInfo,
  type CallRequest,
  type CallStatus,
} from "./video-types";

// Videochiamate: audio e video passano da LiveKit (server esterno), mentre chi può entrare
// lo decide questo server: il gettone per collegarsi viene dato solo a chi l'organizzatore ha ammesso.

export const DB_UPDATE_NEEDED =
  "Il database va aggiornato: esegui supabase/schema.sql nel SQL Editor di Supabase.";

type DbErr = { code?: string; message?: string } | null | undefined;

// Errore del database spiegato: cosa non va e dove correggerlo (al posto di un generico "aggiorna il database")
export function dbError(e: DbErr): string {
  const msg = e?.message ?? "";
  let host = "";
  try {
    host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch {
    // indirizzo non valido: lo dice il caso "non riesco a raggiungere"
  }
  const where = host ? ` (progetto ${host})` : "";
  if (e?.code === "42P01" || e?.code === "PGRST205" || /could not find the table|relation .* does not exist/i.test(msg)) {
    return `Mancano le tabelle delle videochiamate${where}: in questo progetto Supabase apri SQL Editor, incolla tutto supabase/schema.sql e premi Run.`;
  }
  if (e?.code === "42703" || e?.code === "PGRST204") return DB_UPDATE_NEEDED;
  if (e?.code === "42501" || /row-level security/i.test(msg)) {
    return `Supabase blocca la scrittura${where}: in SUPABASE_SERVICE_ROLE_KEY serve la chiave service_role (o "secret"), non quella anon/publishable. Correggila su Vercel e fai Redeploy.`;
  }
  if (/invalid api key|no api key|jwt|unauthorized/i.test(msg) || e?.code === "PGRST301") {
    return `Supabase rifiuta la chiave${where}: SUPABASE_SERVICE_ROLE_KEY deve essere la chiave service_role (o "secret") dello stesso progetto di NEXT_PUBLIC_SUPABASE_URL. Correggila su Vercel e fai Redeploy.`;
  }
  if (/fetch failed|enotfound|getaddrinfo|network|invalid url|requested path is invalid/i.test(msg)) {
    return `Non riesco a raggiungere Supabase${where}: NEXT_PUBLIC_SUPABASE_URL deve essere tipo https://xxxx.supabase.co. Correggila su Vercel e fai Redeploy.`;
  }
  return `Errore del database${where}: ${msg || e?.code || "sconosciuto"}`;
}

const CODE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

// Toglie spazi, virgolette e "NOME=" incollati per errore insieme al valore su Vercel
function envValue(name: string) {
  const v = process.env[name]?.trim().replace(new RegExp(`^${name}\\s*=\\s*`), "").replace(/^["']|["']$/g, "").trim();
  return v || undefined;
}

function config() {
  const raw = envValue("LIVEKIT_URL");
  const key = envValue("LIVEKIT_API_KEY");
  const secret = envValue("LIVEKIT_API_SECRET");
  if (!raw || !key || !secret) return null;
  // Va bene anche l'indirizzo con https://: il browser si collega sempre con wss://
  const url = raw.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://").replace(/\/+$/, "");
  return { url, key, secret };
}

// Controlla che LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET funzionino davvero,
// così l'organizzatore legge cosa correggere su Vercel invece di un generico "connessione persa".
export async function checkLiveKit(): Promise<string | null> {
  const c = config();
  if (!c) return "Videochiamate non configurate: mancano LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET su Vercel.";
  if (/cloud\.livekit\.io/.test(c.url) || !/^wss?:\/\/[^/\s]+$/.test(c.url)) {
    return `LIVEKIT_URL non è giusto ("${c.url}"): deve essere l'indirizzo del progetto, tipo wss://nome-progetto-xxxx.livekit.cloud (lo trovi in LiveKit Cloud → Settings → Project), non quello della pagina del browser.`;
  }
  try {
    await Promise.race([
      rooms()!.listRooms(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    return null;
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401 || status === 403) {
      return "LIVEKIT_API_KEY o LIVEKIT_API_SECRET non sono giusti (o sono di un altro progetto LiveKit): ricopiali da LiveKit Cloud → Settings → API Keys.";
    }
    return `Non riesco a raggiungere il server LiveKit ${c.url}: controlla LIVEKIT_URL su Vercel.`;
  }
}

// In modalità demo (senza database) si possono avviare e programmare chiamate anche senza LiveKit,
// per vedere console, sala d'attesa e pagine d'ingresso: manca solo la stanza con audio e video.
export function videoConfigured() {
  return config() !== null || isDemo();
}

// Stanza LiveKit della plenaria o di una delle stanze in cui è divisa la chiamata
const roomName = (callId: string, breakoutId?: string | null) => (breakoutId ? `vc-${callId}-${breakoutId}` : `vc-${callId}`);
// Plenaria e tutte le stanze aperte (per togliere qualcuno o cambiargli i poteri ovunque si trovi)
async function allRoomNames(callId: string) {
  const { rooms } = await getBreakouts(callId);
  return [roomName(callId), ...rooms.map((r) => roomName(callId, r.id))];
}

function rooms() {
  const c = config();
  if (!c) return null;
  return new RoomServiceClient(c.url.replace(/^ws/, "http"), c.key, c.secret);
}

// Gettone LiveKit per entrare nella stanza. Dura poco: serve solo al momento del collegamento
// (chi viene rimosso non può riusarlo per rientrare più tardi).
export async function callToken(callId: string, who: Participant, breakoutId: string | null = null) {
  const c = config();
  if (!c) return null;
  // Da qui la chiamata può chiudersi da sola quando resta vuota (vedi autoEndIfEmpty)
  await markJoined(callId);
  const at = new AccessToken(c.key, c.secret, {
    identity: who.identity,
    name: who.name,
    ttl: "10m",
    metadata: JSON.stringify({ host: who.host, cohost: !!who.cohost }),
  });
  at.addGrant({
    room: roomName(callId, breakoutId),
    roomJoin: true,
    // Canale dati: chat per tutti; i disegni sullo schermo condiviso si accettano solo dagli organizzatori
    ...(who.host ? { canPublish: true, canSubscribe: true, canPublishData: true } : await guestPermission(callId, breakoutId)),
  });
  return { url: c.url, token: await at.toJwt() };
}

// Toglie qualcuno dalla chiamata: dalla plenaria e da qualunque stanza
export async function removeFromRoom(callId: string, identity: string) {
  const svc = rooms();
  if (!svc) return;
  const names = await allRoomNames(callId);
  await Promise.all(names.map((n) => svc.removeParticipant(n, identity).catch(() => {})));
}

// breakoutId: stanza in cui si trova chi silenzia (vuoto = plenaria)
export async function muteInRoom(callId: string, identity: string, trackSid: string, breakoutId: string | null = null) {
  await rooms()
    ?.mutePublishedTrack(roomName(callId, breakoutId), identity, trackSid, true)
    .catch(() => {});
}

// Spegne il microfono a tutti tranne agli organizzatori (nella plenaria o nella stanza indicata)
export async function muteAllInRoom(callId: string, breakoutId: string | null = null) {
  const svc = rooms();
  if (!svc) return;
  const name = roomName(callId, breakoutId);
  const people = await svc.listParticipants(name).catch(() => []);
  await Promise.all(
    people.flatMap((p) => {
      let host = false;
      try {
        host = JSON.parse(p.metadata || "{}").host === true;
      } catch {
        // metadati non validi: non è un organizzatore
      }
      if (host) return [];
      return p.tracks
        .filter((t) => t.source === TrackSource.MICROPHONE && !t.muted)
        .map((t) => svc.mutePublishedTrack(name, p.identity, t.sid, true).catch(() => {}));
    })
  );
}

// Cosa possono fare i partecipanti che non sono organizzatori. Lo schermo lo condivide l'organizzatore;
// gli altri solo se l'organizzatore l'ha permesso a tutti. In "solo ascolto" non pubblicano niente
// (né microfono né videocamera né schermo): guardano, ascoltano e scrivono in chat.
// Nelle stanze si lavora in piccoli gruppi: si può sempre parlare, anche se la plenaria è in solo ascolto.
async function guestPermission(callId: string, breakoutId: string | null = null) {
  const [listen, shareAll] = await Promise.all([breakoutId ? false : isListenOnly(callId), isShareAll()]);
  if (listen) return { canPublish: false, canSubscribe: true, canPublishData: true, canPublishSources: [] };
  const sources = shareAll
    ? [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]
    : [TrackSource.CAMERA, TrackSource.MICROPHONE];
  return { canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: sources };
}

// Cambia subito i permessi di chi è già nella chiamata (senza farlo rientrare): condivisione schermo
// per tutti o solo ascolto. Gli organizzatori non cambiano.
export async function applyGuestPermissionsInRoom(callId: string) {
  const svc = rooms();
  if (!svc) return;
  const { rooms: open } = await getBreakouts(callId);
  const targets: (string | null)[] = [null, ...open.map((r) => r.id)];
  await Promise.all(
    targets.map(async (b) => {
      const [people, permission] = await Promise.all([
        svc.listParticipants(roomName(callId, b)).catch(() => []),
        guestPermission(callId, b),
      ]);
      await Promise.all(
        people.map((p) =>
          readMeta(p.metadata).host
            ? null
            : svc.updateParticipant(roomName(callId, b), p.identity, { permission }).catch(() => {})
        )
      );
    })
  );
}

// ---------- database ----------

// Ingresso, scelto per ogni riunione: libero, con password o dalla sala d'attesa. Salvato in app_settings.
const accessKey = (callId: string) => `video_access:${callId}`;
const MODES: AccessMode[] = ["open", "password", "waiting"];

// Controlla la scelta che arriva dal browser (con "password" la password è obbligatoria)
export function cleanAccess(raw: unknown): CallAccess | { error: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { mode?: unknown; password?: unknown };
  if (!MODES.includes(r.mode as AccessMode)) return null;
  const mode = r.mode as AccessMode;
  const password = mode === "open" ? "" : String(r.password ?? "").normalize("NFC").trim().slice(0, MAX_PASSWORD);
  if (mode === "password" && !password) return { error: "Scegli la password della riunione" };
  return { mode, password };
}

export async function getAccess(callId: string): Promise<CallAccess> {
  const { data } = await supabaseAdmin().from("app_settings").select("value").eq("key", accessKey(callId)).maybeSingle();
  if (!data) return DEFAULT_ACCESS;
  try {
    const a = cleanAccess(JSON.parse(data.value));
    return a && !("error" in a) ? a : DEFAULT_ACCESS;
  } catch {
    return DEFAULT_ACCESS;
  }
}

export async function setAccess(callId: string, access: CallAccess) {
  const { error } = await supabaseAdmin()
    .from("app_settings")
    .upsert({ key: accessKey(callId), value: JSON.stringify(access), updated_at: new Date().toISOString() });
  return { error: error ? dbError(error) : undefined };
}

// Password della riunione giusta? (confronto che non rivela dai tempi di risposta quanto è giusta)
export function passwordMatches(access: CallAccess, given: unknown) {
  if (!needsPassword(access)) return true;
  const a = createHash("sha256").update(String(given ?? "").normalize("NFC").trim()).digest();
  const b = createHash("sha256").update(access.password).digest();
  return timingSafeEqual(a, b);
}

// Condivisione schermo permessa a tutti (non solo agli organizzatori). Salvata in app_settings.
const SHARE_KEY = "video_share_all";

export async function isShareAll() {
  const { data, error } = await supabaseAdmin().from("app_settings").select("value").eq("key", SHARE_KEY).maybeSingle();
  return !error && data?.value === "1";
}

export async function setShareAll(on: boolean) {
  const { error } = await supabaseAdmin()
    .from("app_settings")
    .upsert({ key: SHARE_KEY, value: on ? "1" : "0", updated_at: new Date().toISOString() });
  return { error: error ? dbError(error) : undefined };
}

// Solo ascolto: i partecipanti (tranne organizzatori e co-organizzatori) non possono parlare né accendere
// la videocamera, ma vedono, ascoltano e scrivono in chat. Si sceglie per ogni chiamata, anche programmata.
const listenKey = (callId: string) => `video_listen:${callId}`;

export async function isListenOnly(callId: string) {
  const { data, error } = await supabaseAdmin().from("app_settings").select("value").eq("key", listenKey(callId)).maybeSingle();
  return !error && data?.value === "1";
}

export async function setListenOnly(callId: string, on: boolean) {
  const { error } = await supabaseAdmin()
    .from("app_settings")
    .upsert({ key: listenKey(callId), value: on ? "1" : "0", updated_at: new Date().toISOString() });
  return { error: error ? dbError(error) : undefined };
}

// Aggiunge solo ascolto e accesso (modo e password) alle chiamate, con una sola lettura per tutte
async function withListenFlags(calls: CallInfo[]): Promise<CallInfo[]> {
  if (!calls.length) return calls;
  const { data } = await supabaseAdmin()
    .from("app_settings")
    .select("key,value")
    .in("key", calls.flatMap((c) => [listenKey(c.id), accessKey(c.id)]));
  const rows = new Map(((data as { key: string; value: string }[] | null) ?? []).map((r) => [r.key, r.value]));
  return calls.map((c) => {
    let access = DEFAULT_ACCESS;
    try {
      const a = cleanAccess(JSON.parse(rows.get(accessKey(c.id)) ?? "null"));
      if (a && !("error" in a)) access = a;
    } catch {
      // impostazione non valida: sala d'attesa
    }
    return {
      ...c,
      listen_only: rows.get(listenKey(c.id)) === "1",
      access: access.mode,
      needs_password: needsPassword(access),
      password: access.password,
    };
  });
}


// Nome (title) e programmazione (starts_at, started_at) sono colonne aggiunte dopo: finché il database
// non è aggiornato le chiamate funzionano lo stesso, senza nome e senza programmazione.
const COLUMN_SETS = ["id,code,created_at,title,starts_at,started_at", "id,code,created_at,title", "id,code,created_at"];

type CallQuery = PromiseLike<{ data: unknown; error: { code?: string } | null }>;

// 42703 / PGRST204 = colonna inesistente (schema.sql non ancora rieseguito)
const missingColumn = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204";

// level 0 = database aggiornato con tutte le colonne
async function withColumnFallback(run: (cols: string) => CallQuery) {
  let res = await run(COLUMN_SETS[0]);
  let level = 0;
  while (level < COLUMN_SETS.length - 1 && missingColumn(res.error)) res = await run(COLUMN_SETS[++level]);
  return { ...res, level };
}

const MAX_TITLE = 80;
export const cleanTitle = (t: unknown) => String(t ?? "").normalize("NFC").trim().replace(/\s+/g, " ").slice(0, MAX_TITLE);

function newCode() {
  return Array.from(randomBytes(10), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

// Tutte le chiamate non terminate: quella in corso e quelle programmate
export async function openCalls(): Promise<{ live: CallInfo | null; scheduled: CallInfo[]; canSchedule: boolean; error?: string }> {
  const { data, error, level } = await withColumnFallback((cols) =>
    supabaseAdmin().from("video_calls").select(cols).is("ended_at", null).order("created_at", { ascending: false })
  );
  if (error) return { live: null, scheduled: [], canSchedule: false, error: dbError(error) };
  const calls = await withListenFlags((data as CallInfo[] | null) ?? []);
  // Più recente per prima (in pratica ce n'è una sola)
  const live =
    calls
      .filter(isLive)
      .sort((a, b) => (b.started_at ?? b.created_at).localeCompare(a.started_at ?? a.created_at))[0] ?? null;
  const scheduled = calls
    .filter((c) => !isLive(c))
    .sort((a, b) => (a.starts_at ?? a.created_at).localeCompare(b.starts_at ?? b.created_at));
  return { live, scheduled, canSchedule: level === 0 };
}

export async function activeCall(): Promise<{ call: CallInfo | null; error?: string }> {
  const { live, error } = await openCalls();
  return { call: live, error };
}

// Chiamata in corso o programmata a cui porta un link
export async function callByCode(code: string): Promise<CallInfo | null> {
  if (!/^[a-z0-9]{6,32}$/.test(code)) return null;
  const { data } = await withColumnFallback((cols) =>
    supabaseAdmin().from("video_calls").select(cols).eq("code", code).is("ended_at", null).maybeSingle()
  );
  if (!data) return null;
  return (await withListenFlags([data as CallInfo]))[0];
}

// Una sola videochiamata alla volta: se ce n'è già una in corso restituisce quella
export async function startCall(
  createdBy: string,
  title = "",
  listenOnly = false,
  access: CallAccess = DEFAULT_ACCESS
): Promise<{ call?: CallInfo; error?: string; warning?: string }> {
  const current = await activeCall();
  if (current.error) return { error: current.error };
  if (current.call) return { call: current.call };
  const code = newCode();
  const payloads: Record<string, unknown>[] = [
    { code, created_by: createdBy, title: title || null, started_at: new Date().toISOString() },
    { code, created_by: createdBy, title: title || null },
    { code, created_by: createdBy },
  ];
  let res = await supabaseAdmin().from("video_calls").insert(payloads[0]).select(COLUMN_SETS[0]).single();
  for (let i = 1; i < payloads.length && missingColumn(res.error); i++) {
    res = await supabaseAdmin().from("video_calls").insert(payloads[i]).select(COLUMN_SETS[i]).single();
  }
  if (res.error) return { error: dbError(res.error) };
  const call = res.data as unknown as CallInfo;
  if (listenOnly) await setListenOnly(call.id, true);
  await setAccess(call.id, access);
  call.listen_only = listenOnly;
  Object.assign(call, { access: access.mode, needs_password: needsPassword(access), password: access.password });
  const warning = title && !call.title ? `La videochiamata è partita senza nome. ${DB_UPDATE_NEEDED}` : undefined;
  return { call, warning };
}

// ---------- videochiamate programmate ----------

export async function scheduleCall(createdBy: string, title: string, startsAt: string, listenOnly = false, access: CallAccess = DEFAULT_ACCESS) {
  const { data, error } = await supabaseAdmin()
    .from("video_calls")
    .insert({ code: newCode(), created_by: createdBy, title: title || null, starts_at: startsAt })
    .select(COLUMN_SETS[0])
    .single();
  if (error) return { error: dbError(error) };
  const call = data as unknown as CallInfo;
  if (listenOnly) await setListenOnly(call.id, true);
  await setAccess(call.id, access);
  return { call };
}

export async function updateScheduled(callId: string, title: string, startsAt: string, listenOnly?: boolean, access?: CallAccess) {
  if (access) {
    const res = await setAccess(callId, access);
    if (res.error) return res;
  }
  const { error } = await supabaseAdmin()
    .from("video_calls")
    .update({ title: title || null, starts_at: startsAt })
    .eq("id", callId)
    .is("started_at", null)
    .is("ended_at", null);
  if (!error && typeof listenOnly === "boolean") return setListenOnly(callId, listenOnly);
  return { error: error ? dbError(error) : undefined };
}

// Annulla una chiamata programmata: il suo link smette di funzionare
export async function cancelScheduled(callId: string) {
  const { error } = await supabaseAdmin()
    .from("video_calls")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", callId)
    .is("started_at", null);
  return { error: error ? dbError(error) : undefined };
}

// L'organizzatore avvia una chiamata programmata (anche prima dell'ora prevista)
export async function startScheduled(callId: string) {
  const current = await activeCall();
  if (current.error) return { error: current.error };
  if (current.call && current.call.id !== callId) {
    return { error: "C'è già una videochiamata in corso: terminala prima di avviarne un'altra." };
  }
  const { error } = await supabaseAdmin()
    .from("video_calls")
    .update({ started_at: new Date().toISOString() })
    .eq("id", callId)
    .is("started_at", null)
    .is("ended_at", null);
  return { error: error ? dbError(error) : undefined };
}

export async function renameCall(callId: string, title: string) {
  const { error } = await supabaseAdmin()
    .from("video_calls")
    .update({ title: title || null })
    .eq("id", callId);
  return { error: error ? dbError(error) : undefined };
}

// Chiude la chiamata per tutti: chi è dentro viene scollegato e il link smette di funzionare
export async function endCall(callId: string) {
  const { error } = await supabaseAdmin()
    .from("video_calls")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", callId);
  const svc = rooms();
  if (svc) {
    const names = await allRoomNames(callId);
    await Promise.all(names.map((n) => svc.deleteRoom(n).catch(() => {})));
  }
  await saveBreakouts(callId, { rooms: [], assign: {} });
  return { error: error ? dbError(error) : undefined };
}

export async function listRequests(callId: string): Promise<CallRequest[]> {
  const { data } = await supabaseAdmin()
    .from("video_call_requests")
    .select("identity,name,status,requested_at")
    .eq("call_id", callId)
    .order("requested_at");
  return (data as CallRequest[] | null) ?? [];
}

export async function getRequest(callId: string, identity: string): Promise<CallRequest | null> {
  const { data } = await supabaseAdmin()
    .from("video_call_requests")
    .select("identity,name,status,requested_at")
    .eq("call_id", callId)
    .eq("identity", identity)
    .maybeSingle();
  return (data as CallRequest | null) ?? null;
}

export async function saveRequest(callId: string, who: Participant, status: CallStatus, newRequest: boolean) {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin()
    .from("video_call_requests")
    .upsert({
      call_id: callId,
      identity: who.identity,
      name: who.name,
      status,
      updated_at: now,
      ...(newRequest ? { requested_at: now } : {}),
    });
  return { error: error ? dbError(error) : undefined };
}

export async function setRequestStatus(callId: string, identities: string[], status: CallStatus, onlyPending = false) {
  let q = supabaseAdmin()
    .from("video_call_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("call_id", callId)
    .in("identity", identities);
  if (onlyPending) q = q.eq("status", "pending");
  const { error } = await q;
  return { error: error ? dbError(error) : undefined };
}

export async function deleteRequest(callId: string, identity: string) {
  await supabaseAdmin().from("video_call_requests").delete().eq("call_id", callId).eq("identity", identity);
}

// ---------- chi sta usando la pagina ----------

// cohost: co-organizzatore nominato durante la chiamata (ha gli stessi poteri dell'organizzatore)
export type Participant = { identity: string; name: string; host: boolean; cohost?: boolean };

// Utente attuale (o appena entrato) visto dalla videochiamata. Gli organizzatori entrano senza sala d'attesa.
export async function currentParticipant(user?: VideoUser | null): Promise<Participant | null> {
  const u = user === undefined ? await currentUser() : user;
  if (!u) return null;
  return { identity: u.id, name: u.name, host: u.organizer };
}

// Organizzatore (da lib/video-auth.ts): avvia, programma e gestisce le videochiamate
export async function requireOrganizer(): Promise<VideoUser | null> {
  const u = await currentUser();
  return u?.organizer ? u : null;
}

// ---------- co-organizzatori ----------
// Durante una chiamata l'organizzatore può nominare co-organizzatori; se l'organizzatore esce, il co-organizzatore
// (o, se non c'è, chi è entrato per primo) diventa organizzatore. Ruoli salvati in app_settings, per chiamata.

type HostRole = "host" | "cohost";
const hostsKey = (callId: string) => `video_hosts:${callId}`;

async function getHosts(callId: string): Promise<Record<string, HostRole>> {
  const { data } = await supabaseAdmin().from("app_settings").select("value").eq("key", hostsKey(callId)).maybeSingle();
  try {
    return data ? (JSON.parse(data.value) as Record<string, HostRole>) : {};
  } catch {
    return {};
  }
}

async function saveHosts(callId: string, hosts: Record<string, HostRole>) {
  const { error } = await supabaseAdmin()
    .from("app_settings")
    .upsert({ key: hostsKey(callId), value: JSON.stringify(hosts), updated_at: new Date().toISOString() });
  return { error: error ? dbError(error) : undefined };
}

export async function hostRole(callId: string, identity: string): Promise<HostRole | null> {
  return (await getHosts(callId))[identity] ?? null;
}

const ALL_SOURCES = [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO];

const readMeta = (metadata: string | undefined) => {
  try {
    const m = JSON.parse(metadata || "{}");
    return { host: m.host === true, cohost: m.cohost === true };
  } catch {
    return { host: false, cohost: false };
  }
};

// Dà (o toglie) i poteri da organizzatore a chi è già nella chiamata, senza farlo rientrare
async function applyRole(callId: string, identity: string, role: HostRole | null) {
  const svc = rooms();
  if (!svc) return;
  const permission = role
    ? { canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: ALL_SOURCES }
    : await guestPermission(callId);
  const metadata = JSON.stringify({ host: !!role, cohost: role === "cohost" });
  const { rooms: open } = await getBreakouts(callId);
  await Promise.all(
    [null, ...open.map((r) => r.id)].map(async (b) =>
      svc
        .updateParticipant(roomName(callId, b), identity, {
          metadata,
          permission: role ? permission : await guestPermission(callId, b),
        })
        .catch(() => {})
    )
  );
}

export async function setCohost(callId: string, identity: string, on: boolean) {
  const hosts = await getHosts(callId);
  if (on) hosts[identity] = "cohost";
  else delete hosts[identity];
  const res = await saveHosts(callId, hosts);
  if (!res.error) await applyRole(callId, identity, on ? "cohost" : null);
  return res;
}

// Chi resta diventa organizzatore se l'organizzatore non c'è più: il co-organizzatore, altrimenti
// chi è entrato per primo. Il server controlla nella stanza che sia davvero il suo turno.
export async function claimHost(callId: string, identity: string): Promise<{ ok: boolean }> {
  const svc = rooms();
  if (!svc) return { ok: false };
  const people = await svc.listParticipants(roomName(callId)).catch(() => null);
  if (!people || !people.some((p) => p.identity === identity)) return { ok: false };
  const others = people.filter((p) => p.identity !== identity).map((p) => ({ p, m: readMeta(p.metadata) }));
  if (others.some(({ m }) => m.host && !m.cohost)) return { ok: false }; // l'organizzatore c'è ancora
  // ...o è solo passato in una delle stanze
  const { rooms: open } = await getBreakouts(callId);
  for (const r of open) {
    const there = await svc.listParticipants(roomName(callId, r.id)).catch(() => []);
    if (there.some((p) => readMeta(p.metadata).host && !readMeta(p.metadata).cohost)) return { ok: false };
  }
  const hosts = await getHosts(callId);
  if (hosts[identity] !== "cohost") {
    // Senza co-organizzatore tocca a chi è entrato per primo
    if (others.some(({ m }) => m.host)) return { ok: false };
    const first = [...people].sort(
      (a, b) => Number(a.joinedAt) - Number(b.joinedAt) || a.identity.localeCompare(b.identity)
    )[0];
    if (first?.identity !== identity) return { ok: false };
  }
  hosts[identity] = "host";
  const res = await saveHosts(callId, hosts);
  if (res.error) return { ok: false };
  await applyRole(callId, identity, "host");
  return { ok: true };
}

// Chi può gestire la chiamata in corso: gli organizzatori e i co-organizzatori/organizzatori nominati
export async function requireCallHost(): Promise<{ admin: boolean; name: string } | null> {
  const admin = await requireOrganizer();
  if (admin) return { admin: true, name: admin.name };
  const who = await currentParticipant();
  if (!who) return null;
  const { call } = await activeCall();
  if (!call) return null;
  return (await hostRole(call.id, who.identity)) ? { admin: false, name: who.name } : null;
}

// ---------- stanze (divisione in gruppi) ----------
// Stanze, nomi e assegnazioni sono salvati in app_settings, per chiamata: { rooms: [{id, name}], assign: {identity: id} }

const breakoutKey = (callId: string) => `video_breakouts:${callId}`;
const BREAKOUT_ID = /^[a-z0-9]{1,12}$/;

export async function getBreakouts(callId: string): Promise<Breakouts> {
  const { data } = await supabaseAdmin().from("app_settings").select("value").eq("key", breakoutKey(callId)).maybeSingle();
  return cleanBreakouts(data ? safeJson(data.value) : null) ?? { rooms: [], assign: {} };
}

function safeJson(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

// Controlla quello che arriva dal browser: al massimo MAX_BREAKOUTS stanze con un nome, ogni persona in una stanza sola
export function cleanBreakouts(raw: unknown): Breakouts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { rooms?: unknown; assign?: unknown };
  if (!Array.isArray(r.rooms)) return null;
  const rooms: BreakoutRoom[] = [];
  for (const [i, room] of r.rooms.slice(0, MAX_BREAKOUTS).entries()) {
    const x = room as { id?: unknown; name?: unknown };
    const id = typeof x.id === "string" && BREAKOUT_ID.test(x.id) && !rooms.some((o) => o.id === x.id) ? x.id : newBreakoutId();
    const name = cleanTitle(x.name).slice(0, MAX_BREAKOUT_NAME) || `Stanza ${i + 1}`;
    rooms.push({ id, name });
  }
  const assign: Record<string, string> = {};
  if (r.assign && typeof r.assign === "object") {
    for (const [identity, id] of Object.entries(r.assign as Record<string, unknown>)) {
      if (typeof id === "string" && identity.length <= 200 && rooms.some((o) => o.id === id)) assign[identity] = id;
    }
  }
  return { rooms, assign };
}

function newBreakoutId() {
  return Array.from(randomBytes(8), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

export async function saveBreakouts(callId: string, b: Breakouts) {
  const { error } = await supabaseAdmin()
    .from("app_settings")
    .upsert({ key: breakoutKey(callId), value: JSON.stringify(b), updated_at: new Date().toISOString() });
  return { error: error ? dbError(error) : undefined };
}

// Avvisa chi è collegato (in plenaria e nelle stanze, anche quelle appena chiuse) che le stanze sono cambiate:
// ognuno rilegge la sua assegnazione e, se serve, si sposta da solo
export async function notifyBreakouts(callId: string, roomIds: string[]) {
  const svc = rooms();
  if (!svc) return;
  const data = new TextEncoder().encode(JSON.stringify({ changed: Date.now() }));
  const names = new Set([roomName(callId), ...roomIds.map((id) => roomName(callId, id))]);
  await Promise.all(
    [...names].map((n) => svc.sendData(n, data, DataPacket_Kind.RELIABLE, { topic: BREAKOUT_TOPIC }).catch(() => {}))
  );
}

// Chi è collegato in plenaria ("main") e in ogni stanza (per il pannello dell'organizzatore)
export async function breakoutPresence(callId: string, open: BreakoutRoom[]): Promise<Record<string, string[]>> {
  const svc = rooms();
  if (!svc) return {};
  const targets: [string, string][] = [["main", roomName(callId)], ...open.map((r): [string, string] => [r.id, roomName(callId, r.id)])];
  const lists = await Promise.all(targets.map(([, n]) => svc.listParticipants(n).catch(() => [])));
  return Object.fromEntries(targets.map(([key], i) => [key, lists[i].map((p) => p.identity)]));
}

// Chi può gestire questa chiamata: organizzatori e co-organizzatori/organizzatori nominati
export async function isCallHost(callId: string, who: Participant) {
  return who.host || (await hostRole(callId, who.identity)) !== null;
}

// ---------- chiusura automatica ----------
// Quando l'ultima persona esce la chiamata termina da sola (il link smette di funzionare):
// - subito, se l'ultima persona preme "Esci" (leftCall);
// - dopo EMPTY_GRACE di stanza vuota, se chi c'era ha chiuso la pagina o perso la connessione
//   (lo controllano le pagine che chiedono lo stato della chiamata: gestione, link, sala d'attesa).
// Non scatta finché nessuno è mai entrato (l'organizzatore può avviarla e entrare dopo).

const EMPTY_GRACE = 60 * 1000;
const CHECK_EVERY = 15 * 1000;
const joinedKey = (callId: string) => `video_joined:${callId}`;
const emptyKey = (callId: string) => `video_empty_since:${callId}`;
const lastCheck = new Map<string, number>();

async function markJoined(callId: string) {
  await supabaseAdmin()
    .from("app_settings")
    .upsert({ key: joinedKey(callId), value: "1", updated_at: new Date().toISOString() });
}

// Identità collegate in plenaria e in tutte le stanze (null se LiveKit non risponde: meglio non chiudere)
async function connectedIdentities(callId: string): Promise<string[] | null> {
  const svc = rooms();
  if (!svc) return null;
  const names = await allRoomNames(callId);
  // Una stanza rimasta vuota viene eliminata da LiveKit: "non trovata" vuol dire nessuno collegato
  const lists = await Promise.all(
    names.map((n) =>
      svc.listParticipants(n).then(
        (l) => l,
        (e: { status?: number; code?: string; message?: string }) =>
          e?.status === 404 || e?.code === "not_found" || /not.?found|does not exist/i.test(e?.message ?? "") ? [] : null
      )
    )
  );
  if (lists.some((l) => l === null)) return null;
  return lists.flatMap((l) => l!.map((p) => p.identity));
}

// "Esci" premuto: se non resta nessun altro, la chiamata termina per tutti
export async function leftCall(callId: string, identity: string) {
  const people = await connectedIdentities(callId);
  if (!people || people.some((id) => id !== identity)) return { ended: false };
  await endCall(callId);
  return { ended: true };
}

export async function autoEndIfEmpty(call: CallInfo) {
  if (!isLive(call) || !videoConfigured()) return false;
  const now = Date.now();
  if (now - (lastCheck.get(call.id) ?? 0) < CHECK_EVERY) return false;
  lastCheck.set(call.id, now);
  const db = supabaseAdmin();
  const [{ data: joined }, { data: empty }] = await Promise.all([
    db.from("app_settings").select("value").eq("key", joinedKey(call.id)).maybeSingle(),
    db.from("app_settings").select("value").eq("key", emptyKey(call.id)).maybeSingle(),
  ]);
  if (!joined) return false;
  const people = await connectedIdentities(call.id);
  if (people === null) return false;
  if (people.length) {
    if (empty?.value) await db.from("app_settings").upsert({ key: emptyKey(call.id), value: "", updated_at: new Date().toISOString() });
    return false;
  }
  const since = Number(empty?.value) || 0;
  if (!since) {
    await db.from("app_settings").upsert({ key: emptyKey(call.id), value: String(now), updated_at: new Date().toISOString() });
    return false;
  }
  if (now - since < EMPTY_GRACE) return false;
  await endCall(call.id);
  return true;
}

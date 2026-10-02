import "server-only";
import { randomBytes } from "crypto";
import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { isDemo } from "./demo-db";
import { supabaseAdmin } from "./supabase-admin";
import { currentUser, type VideoUser } from "./video-auth";
import { isLive, type CallInfo, type CallRequest, type CallStatus } from "./video-types";

// Videochiamate: audio e video passano da LiveKit (server esterno), mentre chi può entrare
// lo decide questo server: il gettone per collegarsi viene dato solo a chi l'organizzatore ha ammesso.

export const DB_UPDATE_NEEDED =
  "Il database va aggiornato: esegui supabase/schema.sql nel SQL Editor di Supabase.";

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

const roomName = (callId: string) => `vc-${callId}`;

function rooms() {
  const c = config();
  if (!c) return null;
  return new RoomServiceClient(c.url.replace(/^ws/, "http"), c.key, c.secret);
}

// Gettone LiveKit per entrare nella stanza. Dura poco: serve solo al momento del collegamento
// (chi viene rimosso non può riusarlo per rientrare più tardi).
export async function callToken(callId: string, who: Participant) {
  const c = config();
  if (!c) return null;
  const at = new AccessToken(c.key, c.secret, {
    identity: who.identity,
    name: who.name,
    ttl: "10m",
    metadata: JSON.stringify({ host: who.host, cohost: !!who.cohost }),
  });
  at.addGrant({
    room: roomName(callId),
    roomJoin: true,
    // Canale dati: chat per tutti; i disegni sullo schermo condiviso si accettano solo dagli organizzatori
    ...(who.host ? { canPublish: true, canSubscribe: true, canPublishData: true } : await guestPermission(callId)),
  });
  return { url: c.url, token: await at.toJwt() };
}

export async function removeFromRoom(callId: string, identity: string) {
  await rooms()
    ?.removeParticipant(roomName(callId), identity)
    .catch(() => {});
}

export async function muteInRoom(callId: string, identity: string, trackSid: string) {
  await rooms()
    ?.mutePublishedTrack(roomName(callId), identity, trackSid, true)
    .catch(() => {});
}

// Spegne il microfono a tutti tranne agli organizzatori
export async function muteAllInRoom(callId: string) {
  const svc = rooms();
  if (!svc) return;
  const people = await svc.listParticipants(roomName(callId)).catch(() => []);
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
        .map((t) => svc.mutePublishedTrack(roomName(callId), p.identity, t.sid, true).catch(() => {}));
    })
  );
}

// Cosa possono fare i partecipanti che non sono organizzatori. Lo schermo lo condivide l'organizzatore;
// gli altri solo se l'organizzatore l'ha permesso a tutti. In "solo ascolto" non pubblicano niente
// (né microfono né videocamera né schermo): guardano, ascoltano e scrivono in chat.
async function guestPermission(callId: string) {
  const [listen, shareAll] = await Promise.all([isListenOnly(callId), isShareAll()]);
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
  const [people, permission] = await Promise.all([
    svc.listParticipants(roomName(callId)).catch(() => []),
    guestPermission(callId),
  ]);
  await Promise.all(
    people.map((p) =>
      readMeta(p.metadata).host
        ? null
        : svc.updateParticipant(roomName(callId), p.identity, { permission }).catch(() => {})
    )
  );
}

// ---------- database ----------

// Ingresso: con la sala d'attesa (predefinita) l'organizzatore ammette uno per uno;
// con l'accesso libero chi ha il link entra subito. Salvato in app_settings.
const OPEN_KEY = "video_open_access";

export async function isOpenAccess() {
  const { data, error } = await supabaseAdmin().from("app_settings").select("value").eq("key", OPEN_KEY).maybeSingle();
  return !error && data?.value === "1";
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
  return { error: error ? DB_UPDATE_NEEDED : undefined };
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
  return { error: error ? DB_UPDATE_NEEDED : undefined };
}

// Aggiunge listen_only alle chiamate (una sola lettura per tutte)
async function withListenFlags(calls: CallInfo[]): Promise<CallInfo[]> {
  if (!calls.length) return calls;
  const { data } = await supabaseAdmin()
    .from("app_settings")
    .select("key,value")
    .in("key", calls.map((c) => listenKey(c.id)));
  const on = new Set(((data as { key: string; value: string }[] | null) ?? []).filter((r) => r.value === "1").map((r) => r.key));
  return calls.map((c) => ({ ...c, listen_only: on.has(listenKey(c.id)) }));
}

export async function setOpenAccess(on: boolean) {
  const { error } = await supabaseAdmin()
    .from("app_settings")
    .upsert({ key: OPEN_KEY, value: on ? "1" : "0", updated_at: new Date().toISOString() });
  return { error: error ? DB_UPDATE_NEEDED : undefined };
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
  if (error) return { live: null, scheduled: [], canSchedule: false, error: DB_UPDATE_NEEDED };
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
  listenOnly = false
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
  if (res.error) return { error: DB_UPDATE_NEEDED };
  const call = res.data as unknown as CallInfo;
  if (listenOnly) await setListenOnly(call.id, true);
  call.listen_only = listenOnly;
  const warning = title && !call.title ? `La videochiamata è partita senza nome. ${DB_UPDATE_NEEDED}` : undefined;
  return { call, warning };
}

// ---------- videochiamate programmate ----------

export async function scheduleCall(createdBy: string, title: string, startsAt: string, listenOnly = false) {
  const { data, error } = await supabaseAdmin()
    .from("video_calls")
    .insert({ code: newCode(), created_by: createdBy, title: title || null, starts_at: startsAt })
    .select(COLUMN_SETS[0])
    .single();
  if (error) return { error: DB_UPDATE_NEEDED };
  const call = data as unknown as CallInfo;
  if (listenOnly) await setListenOnly(call.id, true);
  return { call };
}

export async function updateScheduled(callId: string, title: string, startsAt: string, listenOnly?: boolean) {
  const { error } = await supabaseAdmin()
    .from("video_calls")
    .update({ title: title || null, starts_at: startsAt })
    .eq("id", callId)
    .is("started_at", null)
    .is("ended_at", null);
  if (!error && typeof listenOnly === "boolean") return setListenOnly(callId, listenOnly);
  return { error: error ? DB_UPDATE_NEEDED : undefined };
}

// Annulla una chiamata programmata: il suo link smette di funzionare
export async function cancelScheduled(callId: string) {
  const { error } = await supabaseAdmin()
    .from("video_calls")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", callId)
    .is("started_at", null);
  return { error: error ? DB_UPDATE_NEEDED : undefined };
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
  return { error: error ? DB_UPDATE_NEEDED : undefined };
}

export async function renameCall(callId: string, title: string) {
  const { error } = await supabaseAdmin()
    .from("video_calls")
    .update({ title: title || null })
    .eq("id", callId);
  return { error: error ? DB_UPDATE_NEEDED : undefined };
}

// Chiude la chiamata per tutti: chi è dentro viene scollegato e il link smette di funzionare
export async function endCall(callId: string) {
  const { error } = await supabaseAdmin()
    .from("video_calls")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", callId);
  await rooms()
    ?.deleteRoom(roomName(callId))
    .catch(() => {});
  return { error: error ? DB_UPDATE_NEEDED : undefined };
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
  return { error: error ? DB_UPDATE_NEEDED : undefined };
}

export async function setRequestStatus(callId: string, identities: string[], status: CallStatus, onlyPending = false) {
  let q = supabaseAdmin()
    .from("video_call_requests")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("call_id", callId)
    .in("identity", identities);
  if (onlyPending) q = q.eq("status", "pending");
  const { error } = await q;
  return { error: error ? DB_UPDATE_NEEDED : undefined };
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
  return { error: error ? DB_UPDATE_NEEDED : undefined };
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
  await svc
    .updateParticipant(roomName(callId), identity, {
      metadata: JSON.stringify({ host: !!role, cohost: role === "cohost" }),
      permission,
    })
    .catch(() => {});
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

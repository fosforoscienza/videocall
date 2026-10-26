import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { DEMO_ORGANIZER, isDemo } from "./local-db";
import { env } from "./env";
import { supabaseAdmin } from "./supabase-admin";

// ============================================================================================
//  ADATTATORE DEGLI UTENTI — l'unico file da cambiare per collegare le videochiamate a un altro sito.
//
//  Le videochiamate hanno bisogno solo di sapere chi sta usando la pagina:
//    - id:        identificativo stabile e unico (es. "m:42"). Non deve cambiare tra una visita e l'altra.
//    - name:      nome mostrato agli altri
//    - organizer: true se può avviare e gestire le videochiamate
//
//  Implementazione inclusa (nessun elenco di utenti da gestire):
//    - amministratori dalla variabile d'ambiente VIDEO_ORGANIZERS ("mario:password1;anna:password2"):
//      sono organizzatori e in più creano ed eliminano gli altri utenti dalla pagina di gestione
//    - utenti creati dagli amministratori: organizzatori anche loro (e, se scelto, amministratori),
//      salvati nel database (app_settings, password cifrata con scrypt)
//    - partecipanti: solo il nome, scritto entrando dal link (la password della riunione, se c'è,
//      la controlla lib/video.ts per ogni riunione)
//    - sessione in un cookie firmato (SESSION_SECRET), valida 7 giorni
//
//  Per usare il login di un altro sito: riscrivi currentUser() perché legga la sessione di quel sito
//  (cookie, token, NextAuth, Supabase Auth...) e restituisca { id, name, organizer }. login() e
//  startSession() servono solo se vuoi che si possa entrare anche dal modulo della videochiamata.
// ============================================================================================

// admin: può creare ed eliminare utenti (chi è in VIDEO_ORGANIZERS o un utente creato come amministratore;
// non va nel cookie, si ricalcola ogni volta)
export type VideoUser = { id: string; name: string; organizer: boolean; admin?: boolean };

const COOKIE = "video_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 giorni

// In modalità demo (senza Supabase) basta una chiave fissa: non c'è niente di riservato da proteggere
const DEMO_SECRET = "videochiamate-modalita-demo-senza-database";

function secret() {
  const s = env("SESSION_SECRET") ?? (isDemo() ? DEMO_SECRET : undefined);
  if (!s || s.length < 16) throw new Error("SESSION_SECRET mancante o troppo corto (almeno 16 caratteri)");
  return new TextEncoder().encode(s);
}

// Chi sta usando la pagina (null = nessun accesso)
export async function currentUser(): Promise<VideoUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.id !== "string" || typeof payload.name !== "string") return null;
    const user: VideoUser = { id: payload.id, name: payload.name, organizer: payload.organizer === true };
    if (!user.organizer) return user;
    // Un organizzatore tolto da VIDEO_ORGANIZERS, o un utente eliminato (o con la password cambiata), perde subito i poteri;
    // un utente a cui si toglie "amministratore" smette subito di gestire gli utenti
    if (organizers().some((o) => o.id === user.id)) return { ...user, admin: true };
    const stored = (await storedUsers()).users.find((u) => userId(u.name) === user.id);
    return stored && stored.key === payload.k ? { ...user, admin: stored.admin === true } : null;
  } catch {
    return null;
  }
}

// key: chiave dell'utente creato dalla pagina di gestione (cambia quando lo si ricrea: le vecchie sessioni scadono)
export async function startSession(user: VideoUser, key?: string) {
  const token = await new SignJWT({ id: user.id, name: user.name, organizer: user.organizer, ...(key ? { k: key } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

const clean = (v: unknown) => String(v ?? "").normalize("NFC").trim();
const lower = (v: string) => v.toLowerCase();

// Confronto che non rivela (dai tempi di risposta) quanto della password è giusto
function same(a: string, b: string) {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

const userId = (name: string) => `o:${lower(name)}`;

// In modalità demo, se VIDEO_ORGANIZERS è vuota, si entra con demo / demo
function organizers() {
  const list = env("VIDEO_ORGANIZERS") ?? (isDemo() ? `${DEMO_ORGANIZER.name}:${DEMO_ORGANIZER.password}` : "");
  return list
    .split(";")
    .map((pair) => {
      const i = pair.indexOf(":");
      const name = clean(i < 0 ? pair : pair.slice(0, i));
      const password = i < 0 ? "" : pair.slice(i + 1).trim();
      return { id: userId(name), name, password };
    })
    .filter((o) => o.name && o.password);
}

// Accesso degli organizzatori (pagina di gestione): restituisce l'utente o l'errore da mostrare
export async function login(
  rawUser: unknown,
  rawPassword: unknown
): Promise<{ user: VideoUser; key?: string } | { error: string; status: number }> {
  const username = clean(rawUser);
  const password = clean(rawPassword);
  if (!username || !password) return { error: "Scrivi nome e password", status: 400 };
  const org = organizers().find((o) => lower(o.name) === lower(username));
  if (org) {
    if (same(password, org.password)) return { user: { id: org.id, name: org.name, organizer: true, admin: true } };
    return { error: "Credenziali non valide", status: 401 };
  }
  const stored = (await storedUsers()).users.find((u) => lower(u.name) === lower(username));
  if (stored && (await passwordOk(password, stored))) {
    return { user: { id: userId(stored.name), name: stored.name, organizer: true, admin: stored.admin === true }, key: stored.key };
  }
  return { error: "Credenziali non valide", status: 401 };
}

// ---------- utenti creati dagli amministratori ----------
// Salvati in app_settings come elenco JSON: { name, salt, hash, key, admin, created_at }

type StoredUser = { name: string; salt: string; hash: string; key: string; admin?: boolean; created_at: string };
const USERS_KEY = "video_users";
const MIN_PASSWORD = 8;
const MAX_NAME = 40;

const scryptAsync = promisify(scrypt) as (password: string, salt: string, keylen: number) => Promise<Buffer>;

async function passwordOk(password: string, u: StoredUser) {
  const hash = await scryptAsync(password, u.salt, 32);
  const saved = Buffer.from(u.hash, "base64");
  return saved.length === hash.length && timingSafeEqual(hash, saved);
}

async function storedUsers(): Promise<{ users: StoredUser[]; error?: string }> {
  const { data, error } = await supabaseAdmin().from("app_settings").select("value").eq("key", USERS_KEY).maybeSingle();
  if (error) return { users: [], error: `Errore del database: ${error.message || error.code}` };
  try {
    const list = JSON.parse((data as { value: string } | null)?.value ?? "[]");
    return { users: Array.isArray(list) ? (list as StoredUser[]) : [] };
  } catch {
    return { users: [] };
  }
}

async function saveUsers(users: StoredUser[]) {
  const { error } = await supabaseAdmin()
    .from("app_settings")
    .upsert({ key: USERS_KEY, value: JSON.stringify(users), updated_at: new Date().toISOString() });
  return { error: error ? `Errore del database: ${error.message || error.code}` : undefined };
}

// Elenco per la pagina di gestione: gli amministratori fissi (da VIDEO_ORGANIZERS) e gli utenti creati
// (me: id di chi guarda, per non fargli eliminare o declassare sé stesso)
export async function listUsers(me: string) {
  const { users, error } = await storedUsers();
  return {
    admins: organizers().map((o) => o.name),
    users: users.map((u) => ({ name: u.name, admin: u.admin === true, me: userId(u.name) === me, created_at: u.created_at })),
    error,
  };
}

const findUser = (users: StoredUser[], rawName: unknown) => {
  const name = lower(clean(rawName).replace(/\s+/g, " "));
  return users.find((u) => lower(u.name) === name);
};

// Crea un utente (admin: anche amministratore) o, se c'è già, gli cambia la password (le sue sessioni aperte
// scadono; resta amministratore o no come prima)
export async function saveUser(rawName: unknown, rawPassword: unknown, admin = false): Promise<{ error?: string; status?: number }> {
  const name = clean(rawName).replace(/\s+/g, " ");
  const password = clean(rawPassword);
  if (!name || name.length > MAX_NAME) return { error: `Scrivi un nome (massimo ${MAX_NAME} caratteri)`, status: 400 };
  if (password.length < MIN_PASSWORD) return { error: `La password deve avere almeno ${MIN_PASSWORD} caratteri`, status: 400 };
  if (organizers().some((o) => lower(o.name) === lower(name))) {
    return { error: "Questo nome è già un amministratore (VIDEO_ORGANIZERS)", status: 400 };
  }
  const { users, error } = await storedUsers();
  if (error) return { error, status: 500 };
  const salt = randomBytes(16).toString("base64");
  const hash = (await scryptAsync(password, salt, 32)).toString("base64");
  const old = users.find((u) => lower(u.name) === lower(name));
  const user: StoredUser = {
    name,
    salt,
    hash,
    key: randomBytes(9).toString("base64url"),
    admin: old ? old.admin === true : admin,
    created_at: old?.created_at ?? new Date().toISOString(),
  };
  const res = await saveUsers([...users.filter((u) => u !== old), user].sort((a, b) => a.name.localeCompare(b.name)));
  return res.error ? { error: res.error, status: 500 } : {};
}

// Dà o toglie il ruolo di amministratore (non a sé stessi: così resta sempre chi può gestire gli utenti)
export async function setUserAdmin(rawName: unknown, on: boolean, me: string): Promise<{ error?: string; status?: number }> {
  const { users, error } = await storedUsers();
  if (error) return { error, status: 500 };
  const user = findUser(users, rawName);
  if (!user) return { error: "Utente non trovato", status: 404 };
  if (userId(user.name) === me) return { error: "Non puoi cambiare il tuo ruolo: chiedilo a un altro amministratore", status: 400 };
  const res = await saveUsers(users.map((u) => (u === user ? { ...u, admin: on } : u)));
  return res.error ? { error: res.error, status: 500 } : {};
}

export async function deleteUser(rawName: unknown, me: string): Promise<{ error?: string; status?: number }> {
  const { users, error } = await storedUsers();
  if (error) return { error, status: 500 };
  const user = findUser(users, rawName);
  if (!user) return { error: "Utente non trovato", status: 404 };
  if (userId(user.name) === me) return { error: "Non puoi eliminare te stesso: chiedilo a un altro amministratore", status: 400 };
  const res = await saveUsers(users.filter((u) => u !== user));
  return res.error ? { error: res.error, status: 500 } : {};
}

// Partecipante che entra dal link con il suo nome. Chi ha già una sessione da partecipante tiene la stessa
// identità (così resta ammesso se ricarica la pagina o cambia nome); il nome si aggiorna.
export function guestUser(rawName: unknown, current: VideoUser | null): { user: VideoUser } | { error: string; status: number } {
  const name = clean(rawName).replace(/\s+/g, " ").slice(0, 60);
  if (!name) return { error: "Scrivi il tuo nome", status: 400 };
  const id = current && !current.organizer && current.id.startsWith("g:") ? current.id : `g:${randomBytes(9).toString("base64url")}`;
  return { user: { id, name, organizer: false } };
}

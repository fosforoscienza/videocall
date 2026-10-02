import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { supabaseAdmin } from "./supabase-admin";
import { VIDEO_CONFIG } from "./video-config";

// ============================================================================================
//  ADATTATORE DEGLI UTENTI — l'unico file da cambiare per collegare le videochiamate a un altro sito.
//
//  Le videochiamate hanno bisogno solo di sapere chi sta usando la pagina:
//    - id:        identificativo stabile e unico (es. "m:42"). Non deve cambiare tra una visita e l'altra.
//    - name:      nome mostrato agli altri
//    - organizer: true se può avviare e gestire le videochiamate
//
//  Implementazione inclusa:
//    - organizzatori dalla variabile d'ambiente VIDEO_ORGANIZERS ("mario:password1;anna:password2")
//    - partecipanti dalla tabella video_members (username + codice), oppure solo con il nome
//      se in lib/video-config.ts guestLogin = "name"
//    - sessione in un cookie firmato (SESSION_SECRET), valida 7 giorni
//
//  Per usare il login di un altro sito: riscrivi currentUser() perché legga la sessione di quel sito
//  (cookie, token, NextAuth, Supabase Auth...) e restituisca { id, name, organizer }. login() e
//  startSession() servono solo se vuoi che si possa entrare anche dal modulo della videochiamata.
// ============================================================================================

export type VideoUser = { id: string; name: string; organizer: boolean };

const COOKIE = "video_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 giorni

function secret() {
  const s = process.env.SESSION_SECRET;
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
    // Un organizzatore tolto da VIDEO_ORGANIZERS perde subito i poteri
    if (user.organizer && !organizers().some((o) => o.id === user.id)) return null;
    return user;
  } catch {
    return null;
  }
}

export async function startSession(user: VideoUser) {
  const token = await new SignJWT({ ...user })
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

function organizers() {
  return (process.env.VIDEO_ORGANIZERS ?? "")
    .split(";")
    .map((pair) => {
      const i = pair.indexOf(":");
      const name = clean(i < 0 ? pair : pair.slice(0, i));
      const password = i < 0 ? "" : pair.slice(i + 1).trim();
      return { id: `o:${lower(name)}`, name, password };
    })
    .filter((o) => o.name && o.password);
}

// Controlla i dati scritti nel modulo d'ingresso: restituisce l'utente o l'errore da mostrare
export async function login(rawUser: unknown, rawPassword: unknown): Promise<{ user: VideoUser } | { error: string; status: number }> {
  const username = clean(rawUser);
  const password = clean(rawPassword);
  if (!username) return { error: "Scrivi il tuo nome", status: 400 };

  // Organizzatori (variabile d'ambiente VIDEO_ORGANIZERS)
  const org = organizers().find((o) => lower(o.name) === lower(username));
  if (org) {
    if (password && same(password, org.password)) return { user: { id: org.id, name: org.name, organizer: true } };
    return { error: "Credenziali non valide", status: 401 };
  }

  // Solo nome: chiunque abbia il link (l'organizzatore decide comunque chi far entrare)
  if (VIDEO_CONFIG.guestLogin === "name") {
    const name = username.replace(/\s+/g, " ").slice(0, 60);
    return { user: { id: `g:${randomBytes(9).toString("base64url")}`, name, organizer: false } };
  }

  // Iscritti nella tabella video_members
  if (!password) return { error: `Inserisci ${VIDEO_CONFIG.credentials}`, status: 400 };
  const { data } = await supabaseAdmin()
    .from("video_members")
    .select("id,username,code,name")
    .ilike("username", username.replace(/[\\%_]/g, (c) => `\\${c}`))
    .maybeSingle();
  if (!data || !same(password, String(data.code))) return { error: "Credenziali non valide", status: 401 };
  return { user: { id: `m:${data.id}`, name: data.name || data.username, organizer: false } };
}

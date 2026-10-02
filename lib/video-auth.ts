import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { DEMO_ORGANIZER, isDemo } from "./demo-db";

// ============================================================================================
//  ADATTATORE DEGLI UTENTI — l'unico file da cambiare per collegare le videochiamate a un altro sito.
//
//  Le videochiamate hanno bisogno solo di sapere chi sta usando la pagina:
//    - id:        identificativo stabile e unico (es. "m:42"). Non deve cambiare tra una visita e l'altra.
//    - name:      nome mostrato agli altri
//    - organizer: true se può avviare e gestire le videochiamate
//
//  Implementazione inclusa (nessun elenco di utenti da gestire):
//    - organizzatori dalla variabile d'ambiente VIDEO_ORGANIZERS ("mario:password1;anna:password2")
//    - partecipanti: solo il nome, scritto entrando dal link (la password della riunione, se c'è,
//      la controlla lib/video.ts per ogni riunione)
//    - sessione in un cookie firmato (SESSION_SECRET), valida 7 giorni
//
//  Per usare il login di un altro sito: riscrivi currentUser() perché legga la sessione di quel sito
//  (cookie, token, NextAuth, Supabase Auth...) e restituisca { id, name, organizer }. login() e
//  startSession() servono solo se vuoi che si possa entrare anche dal modulo della videochiamata.
// ============================================================================================

export type VideoUser = { id: string; name: string; organizer: boolean };

const COOKIE = "video_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 giorni

// In modalità demo (senza Supabase) basta una chiave fissa: non c'è niente di riservato da proteggere
const DEMO_SECRET = "videochiamate-modalita-demo-senza-database";

function secret() {
  const s = process.env.SESSION_SECRET || (isDemo() ? DEMO_SECRET : undefined);
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

// In modalità demo, se VIDEO_ORGANIZERS è vuota, si entra con demo / demo
function organizers() {
  const list = process.env.VIDEO_ORGANIZERS || (isDemo() ? `${DEMO_ORGANIZER.name}:${DEMO_ORGANIZER.password}` : "");
  return list
    .split(";")
    .map((pair) => {
      const i = pair.indexOf(":");
      const name = clean(i < 0 ? pair : pair.slice(0, i));
      const password = i < 0 ? "" : pair.slice(i + 1).trim();
      return { id: `o:${lower(name)}`, name, password };
    })
    .filter((o) => o.name && o.password);
}

// Accesso degli organizzatori (pagina di gestione): restituisce l'utente o l'errore da mostrare
export async function login(rawUser: unknown, rawPassword: unknown): Promise<{ user: VideoUser } | { error: string; status: number }> {
  const username = clean(rawUser);
  const password = clean(rawPassword);
  if (!username || !password) return { error: "Scrivi nome e password", status: 400 };
  const org = organizers().find((o) => lower(o.name) === lower(username));
  if (org && same(password, org.password)) return { user: { id: org.id, name: org.name, organizer: true } };
  return { error: "Credenziali non valide", status: 401 };
}

// Partecipante che entra dal link con il suo nome. Chi ha già una sessione da partecipante tiene la stessa
// identità (così resta ammesso se ricarica la pagina o cambia nome); il nome si aggiorna.
export function guestUser(rawName: unknown, current: VideoUser | null): { user: VideoUser } | { error: string; status: number } {
  const name = clean(rawName).replace(/\s+/g, " ").slice(0, 60);
  if (!name) return { error: "Scrivi il tuo nome", status: 400 };
  const id = current && !current.organizer && current.id.startsWith("g:") ? current.id : `g:${randomBytes(9).toString("base64url")}`;
  return { user: { id, name, organizer: false } };
}

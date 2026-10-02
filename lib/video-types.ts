// Tipi delle videochiamate condivisi tra server e browser

// title: nome scelto dall'organizzatore (facoltativo)
// starts_at: data e ora programmate; started_at: vuoto finché l'organizzatore non la avvia
export type CallInfo = {
  id: string;
  code: string;
  created_at: string;
  title?: string | null;
  starts_at?: string | null;
  started_at?: string | null;
  // Solo ascolto: i partecipanti vedono, ascoltano e scrivono in chat, ma non parlano
  listen_only?: boolean;
};

// Una chiamata è in corso quando è stata avviata (le chiamate create prima della programmazione non hanno started_at)
export const isLive = (c: CallInfo) => c.started_at !== null;

// pending = in sala d'attesa, accepted = ammesso, rejected = non ammesso, removed = tolto dalla chiamata
export type CallStatus = "pending" | "accepted" | "rejected" | "removed";

export type CallRequest = { identity: string; name: string; status: CallStatus; requested_at: string };

// Risposta di /api/call/[code]: stato di chi sta aprendo il link
export type JoinState =
  | { status: "none" | "pending" | "rejected" | "removed" | "ended"; name?: string }
  | { status: "scheduled"; startsAt: string | null; name?: string }
  | { status: "accepted"; name: string; host: boolean; listenOnly: boolean; url: string; token: string };

export type HostAction = "accept" | "reject" | "remove" | "mute" | "mute_all" | "accept_all" | "make_cohost" | "remove_cohost";

// Link della videochiamata: /call/nome-della-chiamata-codice. Il nome serve solo a renderlo leggibile;
// conta il codice finale, così i link restano validi anche se la chiamata viene rinominata.
export function callSlug(call: { code: string; title?: string | null }) {
  const name = (call.title ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  return name ? `${name}-${call.code}` : call.code;
}

export function codeFromSlug(slug: string) {
  const s = decodeURIComponent(slug).toLowerCase();
  return s.slice(s.lastIndexOf("-") + 1);
}

// Date delle videochiamate programmate, sempre all'ora italiana (uguale su server e telefono)
const WHEN = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});
// es. "domenica 4 ottobre alle ore 21:00"
export const formatWhen = (iso: string) => WHEN.format(new Date(iso));

// Valore per <input type="datetime-local"> (ora del telefono) e ritorno
export function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : "");

import "server-only";
import { randomBytes } from "crypto";
import { supabaseAdmin } from "./supabase-admin";
import { dbError, type Participant } from "./video";
import {
  MAX_POLL_OPTION,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION,
  MAX_POLLS,
  pollPublic,
  type Poll,
  type PollAction,
  type PollView,
} from "./video-types";

// ============================================================================================
//  SONDAGGI — salvati in app_settings, come le altre impostazioni delle chiamate (niente tabelle nuove):
//    - "video_polls:<chiamata>": i sondaggi della chiamata (li cambia solo chi la gestisce)
//    - "video_vote:<chiamata>:<sondaggio>:<identità>": un voto per riga, così chi vota nello stesso
//      momento non cancella il voto degli altri; votando di nuovo si cambia il proprio voto.
//      Nei sondaggi a più risposte il voto è l'elenco delle risposte scelte; togliendole tutte il voto sparisce.
// ============================================================================================

const pollsKey = (callId: string) => `video_polls:${callId}`;
const votePrefix = (callId: string, pollId?: string) => `video_vote:${callId}:${pollId ? `${pollId}:` : ""}`;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
const POLL_ID = /^[a-z0-9]{1,12}$/;
const ID_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
// Righe lette per volta (Supabase ne restituisce al massimo 1000)
const PAGE = 1000;

const cleanText = (v: unknown, max: number) => String(v ?? "").normalize("NFC").trim().replace(/\s+/g, " ").slice(0, max);
const newId = () => Array.from(randomBytes(8), (b) => ID_CHARS[b % ID_CHARS.length]).join("");

type Vote = { poll: string; choices: number[]; identity: string; name: string };

// Domanda, risposte e tipo scritti dall'organizzatore: controllati qui
export function cleanPollInput(raw: unknown): Pick<Poll, "question" | "options" | "secret" | "multiple"> | { error: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as { question?: unknown; options?: unknown; secret?: unknown; multiple?: unknown };
  const question = cleanText(r.question, MAX_POLL_QUESTION);
  if (!question) return { error: "Scrivi la domanda" };
  const options = (Array.isArray(r.options) ? r.options : [])
    .map((o) => cleanText(o, MAX_POLL_OPTION))
    .filter(Boolean)
    .slice(0, MAX_POLL_OPTIONS);
  if (options.length < 2) return { error: "Servono almeno due risposte" };
  return { question, options, secret: r.secret === true, multiple: r.multiple === true };
}

export async function getPolls(callId: string): Promise<Poll[]> {
  const { data } = await supabaseAdmin().from("app_settings").select("value").eq("key", pollsKey(callId)).maybeSingle();
  let list: unknown;
  try {
    list = data ? JSON.parse((data as { value: string }).value) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap((x): Poll[] => {
    const p = x as Partial<Poll>;
    const input = cleanPollInput(p);
    if (typeof p.id !== "string" || !POLL_ID.test(p.id) || "error" in input) return [];
    const status = p.status === "open" || p.status === "closed" ? p.status : "draft";
    return [{ id: p.id, ...input, status, shown: p.shown === true }];
  });
}

async function savePolls(callId: string, polls: Poll[]) {
  const { error } = await supabaseAdmin()
    .from("app_settings")
    .upsert({ key: pollsKey(callId), value: JSON.stringify(polls), updated_at: new Date().toISOString() });
  return { error: error ? dbError(error) : undefined };
}

// Tutti i voti della chiamata, a pagine
async function listVotes(callId: string): Promise<Vote[]> {
  const votes: Vote[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin()
      .from("app_settings")
      .select("key,value")
      .ilike("key", `${escapeLike(votePrefix(callId))}%`)
      .order("key")
      .range(from, from + PAGE - 1);
    const rows = (data as { key: string; value: string }[] | null) ?? [];
    if (error) break;
    for (const row of rows) {
      try {
        // (i voti salvati prima delle risposte multiple hanno una sola "choice")
        const v = JSON.parse(row.value) as Partial<Vote> & { choice?: unknown };
        const choices = Array.isArray(v.choices) ? v.choices : [v.choice];
        if (typeof v.poll === "string" && typeof v.identity === "string") {
          votes.push({ poll: v.poll, choices: choices.filter(Number.isInteger) as number[], identity: v.identity, name: typeof v.name === "string" ? v.name : "" });
        }
      } catch {
        // voto non valido: ignorato
      }
    }
    if (rows.length < PAGE) break;
  }
  return votes;
}

// Sondaggi visti da chi chiede: chi gestisce la chiamata li vede tutti (anche quelli preparati) con i risultati;
// gli altri vedono quelli aperti o chiusi e i risultati solo se sono palesi o mostrati dall'organizzatore
export async function pollsFor(callId: string, identity: string, manager: boolean): Promise<PollView[]> {
  const polls = (await getPolls(callId)).filter((p) => manager || p.status !== "draft");
  if (!polls.length) return [];
  const votes = await listVotes(callId);
  return polls.map((p) => {
    // Solo le risposte che esistono (e una sola, se il sondaggio non è a più risposte)
    const given = votes
      .filter((v) => v.poll === p.id)
      .map((v) => ({ ...v, choices: v.choices.filter((c) => c >= 0 && c < p.options.length).slice(0, p.multiple ? undefined : 1) }))
      .filter((v) => v.choices.length > 0);
    const view: PollView = { ...p, mine: given.find((v) => v.identity === identity)?.choices ?? [], voters: given.length };
    if (manager || pollPublic(p)) {
      const chose = (i: number) => given.filter((v) => v.choices.includes(i));
      view.counts = p.options.map((_, i) => chose(i).length);
      // Nomi: nei palesi a tutti, nei segreti solo a organizzatori e co-organizzatori (anche dopo aver mostrato i risultati)
      if (manager || !p.secret) view.names = p.options.map((_, i) => chose(i).map((v) => v.name));
    }
    return view;
  });
}

// choices: le risposte scelte (una sola se il sondaggio non è a più risposte; vuoto = tolgo il mio voto)
export async function vote(callId: string, pollId: unknown, who: Participant, raw: unknown) {
  const poll = (await getPolls(callId)).find((p) => p.id === pollId);
  if (!poll) return { error: "Questo sondaggio non c'è più" };
  if (poll.status !== "open") return { error: "Il sondaggio è chiuso" };
  const list = Array.isArray(raw) ? raw : [];
  const valid = (c: unknown): c is number => typeof c === "number" && Number.isInteger(c) && c >= 0 && c < poll.options.length;
  if (!list.every(valid) || list.length > poll.options.length) return { error: "Scelta non valida" };
  const choices = [...new Set(list)].sort((a, b) => a - b);
  if (!poll.multiple && choices.length !== 1) return { error: "Scegli una risposta" };
  const key = `${votePrefix(callId, poll.id)}${who.identity}`;
  const value: Vote = { poll: poll.id, choices, identity: who.identity, name: who.name };
  const { error } = choices.length
    ? await supabaseAdmin().from("app_settings").upsert({ key, value: JSON.stringify(value), updated_at: new Date().toISOString() })
    : await supabaseAdmin().from("app_settings").delete().eq("key", key);
  return { error: error ? dbError(error) : undefined, secret: poll.secret };
}

// L'organizzatore prepara, modifica, apre, chiude ed elimina i sondaggi e mostra (o nasconde) i risultati dei segreti
export async function managePoll(callId: string, action: PollAction, id: unknown, input: unknown): Promise<{ error?: string }> {
  const polls = await getPolls(callId);
  if (action === "create") {
    if (polls.length >= MAX_POLLS) return { error: `Al massimo ${MAX_POLLS} sondaggi per videochiamata` };
    const clean = cleanPollInput(input);
    if ("error" in clean) return clean;
    const open = (input as { open?: unknown } | null)?.open === true;
    return savePolls(callId, [...polls, { id: newId(), ...clean, status: open ? "open" : "draft", shown: false }]);
  }
  const poll = polls.find((p) => p.id === id);
  if (!poll) return { error: "Questo sondaggio non c'è più" };
  if (action === "delete") {
    const res = await savePolls(callId, polls.filter((p) => p !== poll));
    if (!res.error) {
      await supabaseAdmin().from("app_settings").delete().ilike("key", `${escapeLike(votePrefix(callId, poll.id))}%`);
    }
    return res;
  }
  if (action === "update") {
    // Si cambia solo finché non è stato aperto: i voti già dati resterebbero legati alle risposte di prima
    if (poll.status !== "draft") return { error: "Il sondaggio è già stato aperto: non si può più modificare" };
    const clean = cleanPollInput(input);
    if ("error" in clean) return clean;
    Object.assign(poll, clean);
  } else if (action === "open") poll.status = "open";
  else if (action === "close") poll.status = "closed";
  else if (action === "show" || action === "hide") poll.shown = action === "show";
  else return { error: "Richiesta non valida" };
  return savePolls(callId, polls);
}

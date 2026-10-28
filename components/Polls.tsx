"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_POLL_OPTION, MAX_POLL_OPTIONS, MAX_POLL_QUESTION, type PollAction, type PollView, type PollsState } from "@/lib/video-types";

type PollInput = { question: string; options: string[]; secret: boolean; multiple: boolean; open?: boolean };

export type PollsHook = {
  state: PollsState | null;
  busy: boolean;
  error: string;
  load: () => Promise<void>;
  // avviso dal server (nella stanza): rilegge i sondaggi
  nudge: (payload?: unknown) => void;
  act: (action: PollAction, id?: string, poll?: PollInput) => Promise<boolean>;
  // risposte scelte (vuoto = tolgo il voto, solo nei sondaggi a più risposte)
  vote: (id: string, choices: number[]) => Promise<boolean>;
};

// Sondaggi di una chiamata: letti all'apertura, ogni `every` ms (0 = mai) e quando il server avvisa
export function usePolls(code: string | undefined, enabled = true, every = 15000): PollsHook {
  const [state, setState] = useState<PollsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const manager = useRef(false);
  useEffect(() => {
    manager.current = !!state?.manager;
  });

  const load = useCallback(async () => {
    if (!code) return;
    const res = await fetch(`/api/call/${code}/polls`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json().catch(() => null)) as PollsState | null;
    if (data && Array.isArray(data.polls)) setState(data);
  }, [code]);

  useEffect(() => {
    if (!enabled || !code) return;
    load();
    if (!every) return;
    const t = setInterval(() => document.visibilityState === "visible" && load(), every);
    return () => clearInterval(t);
  }, [enabled, code, every, load]);

  // Tanti avvisi di fila (tutti votano insieme) fanno una lettura sola, un po' sfasata tra le persone
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);
  const nudge = useCallback(
    (payload?: unknown) => {
      const p = (payload ?? {}) as { kind?: unknown; secret?: unknown };
      // Voto in un sondaggio segreto: cambia qualcosa solo per chi vede i risultati
      if (p.kind === "vote" && p.secret === true && !manager.current) return;
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        load();
      }, 300 + Math.random() * 1200);
    },
    [load]
  );

  const send = useCallback(
    async (body: Record<string, unknown>) => {
      if (!code) return false;
      setBusy(true);
      setError("");
      const res = await fetch(`/api/call/${code}/polls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as (PollsState & { error?: string }) | null;
      setBusy(false);
      if (!res?.ok) {
        setError(data?.error || (res ? "Non riesco a salvare, riprova" : "Connessione assente, riprova"));
        return false;
      }
      if (data && Array.isArray(data.polls)) setState(data);
      return true;
    },
    [code]
  );
  const act = useCallback((action: PollAction, id?: string, poll?: PollInput) => send({ action, id, poll }), [send]);
  const vote = useCallback((id: string, choices: number[]) => send({ action: "vote", id, choices }), [send]);

  return { state, busy, error, load, nudge, act, vote };
}

// Sondaggi da votare (aperti, senza il mio voto): per il numerino sul pulsante
export const pollsToVote = (s: PollsState | null) => s?.polls.filter((p) => p.status === "open" && !p.mine.length).length ?? 0;

// Novità già mostrate a questo partecipante (sondaggio aperto, risultati mostrati), per chiamata.
// Restano per tutta la visita della pagina: spostandosi tra le stanze non si ripresentano.
const seen = new Set<string>();

// Cosa far vedere da solo a chi partecipa: un sondaggio appena aperto da votare, o i risultati appena mostrati
export function pollToShow(code: string, s: PollsState | null): { id: string; results: boolean } | null {
  if (!s || s.manager) return null;
  const first = !seen.has(`${code}:`);
  seen.add(`${code}:`);
  let show: { id: string; results: boolean } | null = null;
  for (const p of s.polls) {
    const openKey = `${code}:${p.id}:open`;
    const shownKey = `${code}:${p.id}:shown`;
    // Risultati già visibili entrando: niente avviso
    if (p.secret && p.shown && !seen.has(shownKey)) {
      seen.add(shownKey);
      if (!first && !show) show = { id: p.id, results: true };
    }
    if (p.status === "open") {
      if (!seen.has(openKey)) {
        seen.add(openKey);
        if (!p.mine.length && !show) show = { id: p.id, results: false };
      }
    } else seen.delete(openKey); // riaperto più avanti: si ripresenta
  }
  return show;
}

const STATUS: Record<PollView["status"], string> = { draft: "📝 Preparato", open: "🟢 Aperto", closed: "⏹️ Chiuso" };

function PollCard({ poll, polls, live, onEdit }: { poll: PollView; polls: PollsHook; live: boolean; onEdit: () => void }) {
  const manager = !!polls.state?.manager;
  const canVote = poll.status === "open";
  // Percentuali su chi ha votato (con più risposte la somma può superare il 100%)
  const pct = (n: number) => (poll.voters ? Math.round((n / poll.voters) * 100) : 0);
  const voted = poll.mine.length > 0;
  // Una risposta: la scelta sostituisce la precedente. Più risposte: ogni tocco aggiunge o toglie quella risposta.
  const choose = (i: number) =>
    polls.vote(poll.id, poll.multiple ? (poll.mine.includes(i) ? poll.mine.filter((c) => c !== i) : [...poll.mine, i]) : [i]);
  const remove = () => confirm(`Eliminare il sondaggio "${poll.question}"? Si perdono anche i voti.`) && polls.act("delete", poll.id);

  return (
    <section className="poll">
      <div className="poll-head">
        <h3 className="poll-question">{poll.question}</h3>
        <span className="poll-tags">
          {poll.secret ? "🔒 Segreto" : "👁️ Palese"}
          {poll.multiple && " · ☑️ Più risposte"}
          {manager || poll.status === "closed" ? ` · ${STATUS[poll.status]}` : ""}
        </span>
      </div>
      <div className="poll-options">
        {poll.options.map((o, i) => {
          const n = poll.counts?.[i];
          const names = poll.names?.[i] ?? [];
          const mine = poll.mine.includes(i);
          return (
            <div key={i} className="poll-option-wrap">
              <button
                type="button"
                className={`poll-option ${mine ? "mine" : ""}`}
                onClick={() => choose(i)}
                disabled={!canVote || polls.busy}
                aria-pressed={mine}
              >
                {n !== undefined && <span className="poll-bar" style={{ width: `${pct(n)}%` }} />}
                <span className="poll-option-text">
                  {poll.multiple ? (mine ? "☑ " : "☐ ") : mine && "✓ "}
                  {o}
                </span>
                {n !== undefined && (
                  <span className="poll-count">
                    {n} · {pct(n)}%
                  </span>
                )}
              </button>
              {names.length > 0 && <p className="poll-names">{names.join(", ")}</p>}
            </div>
          );
        })}
      </div>
      <p className="muted poll-note">
        {poll.voters} {poll.voters === 1 ? "voto" : "voti"}
        {canVote &&
          (poll.multiple
            ? voted
              ? " · tocca una risposta per aggiungerla o toglierla, finché il sondaggio è aperto"
              : " · scegli una o più risposte"
            : voted
              ? " · puoi cambiare il voto finché il sondaggio è aperto"
              : " · scegli una risposta")}
        {poll.secret
          ? manager
            ? poll.shown
              ? " · risultati visibili a tutti (i nomi solo agli organizzatori)"
              : " · risultati e nomi li vedono solo gli organizzatori"
            : poll.shown
              ? " · voto segreto"
              : " · voto segreto: i risultati li vedono solo gli organizzatori"
          : " · voto palese: tutti vedono chi ha votato e cosa"}
      </p>
      {manager && (
        <div className="row poll-actions">
          {poll.status === "draft" && (
            <button className="btn btn-ghost btn-small" onClick={onEdit} disabled={polls.busy}>
              Modifica
            </button>
          )}
          {poll.status !== "open" && (
            <button className="btn btn-ghost btn-small" onClick={remove} disabled={polls.busy}>
              Elimina
            </button>
          )}
          {poll.secret && poll.status !== "draft" && (
            <button className="btn btn-ghost btn-small" onClick={() => polls.act(poll.shown ? "hide" : "show", poll.id)} disabled={polls.busy}>
              {poll.shown ? "Nascondi i risultati" : "Mostra i risultati a tutti"}
            </button>
          )}
          {poll.status === "open" ? (
            <button className="btn btn-gold btn-small" onClick={() => polls.act("close", poll.id)} disabled={polls.busy}>
              Chiudi il sondaggio
            </button>
          ) : (
            // Prima che la chiamata inizi si prepara soltanto: si apre durante la videochiamata
            live && <button className="btn btn-gold btn-small" onClick={() => polls.act("open", poll.id)} disabled={polls.busy}>
              {poll.status === "draft" ? "Apri il sondaggio" : "Riapri"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// Nuovo sondaggio (o modifica di uno preparato): domanda, da 2 a MAX_POLL_OPTIONS risposte, segreto o palese
function PollForm({ poll, polls, live, onDone }: { poll?: PollView; polls: PollsHook; live: boolean; onDone: () => void }) {
  const [question, setQuestion] = useState(poll?.question ?? "");
  const [options, setOptions] = useState<string[]>(poll?.options ?? ["", ""]);
  const [secret, setSecret] = useState(poll?.secret ?? true);
  const [multiple, setMultiple] = useState(poll?.multiple ?? false);
  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ready = !!question.trim() && filled.length >= 2;

  const save = async (open: boolean) => {
    const data = { question: question.trim(), options: filled, secret, multiple, open };
    if (await (poll ? polls.act("update", poll.id, data) : polls.act("create", undefined, data))) {
      if (poll && open) await polls.act("open", poll.id);
      onDone();
    }
  };

  return (
    <section className="poll poll-form">
      <label className="field">
        <span>Domanda</span>
        <input
          className="input"
          placeholder="es. Dove andiamo al campo estivo?"
          maxLength={MAX_POLL_QUESTION}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>
      <div className="field">
        <span>Risposte</span>
        {options.map((o, i) => (
          <div key={i} className="row poll-form-option">
            <input
              className="input"
              placeholder={`Risposta ${i + 1}`}
              maxLength={MAX_POLL_OPTION}
              value={o}
              onChange={(e) => setOptions((os) => os.map((x, j) => (j === i ? e.target.value : x)))}
              aria-label={`Risposta ${i + 1}`}
            />
            {options.length > 2 && (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => setOptions((os) => os.filter((_, j) => j !== i))}
                aria-label={`Togli la risposta ${i + 1}`}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {options.length < MAX_POLL_OPTIONS && (
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setOptions((os) => [...os, ""])}>
            + Aggiungi una risposta
          </button>
        )}
      </div>
      <div className="field">
        <span>Quante risposte</span>
        <div className="view-toggle">
          <button type="button" className={multiple ? "" : "active"} onClick={() => setMultiple(false)}>
            ◉ Una risposta
          </button>
          <button type="button" className={multiple ? "active" : ""} onClick={() => setMultiple(true)}>
            ☑️ Più risposte
          </button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {multiple ? "Ognuno può scegliere tutte le risposte che vuole." : "Ognuno sceglie una sola risposta."}
        </p>
      </div>
      <div className="field">
        <span>Voto</span>
        <div className="view-toggle">
          <button type="button" className={secret ? "active" : ""} onClick={() => setSecret(true)}>
            🔒 Segreto
          </button>
          <button type="button" className={secret ? "" : "active"} onClick={() => setSecret(false)}>
            👁️ Palese
          </button>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          {secret
            ? "Gli organizzatori vedono i risultati e chi ha votato cosa. Gli altri non vedono niente finché non mostri i risultati, e anche allora solo i numeri, senza nomi."
            : "Tutti vedono i risultati con il nome di chi ha votato e cosa ha scelto."}
        </p>
      </div>
      {polls.error && <p className="error">{polls.error}</p>}
      <div className="row poll-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={onDone} disabled={polls.busy}>
          Annulla
        </button>
        <button type="button" className={`btn btn-small ${live ? "btn-ghost" : "btn-gold"}`} onClick={() => save(false)} disabled={!ready || polls.busy}>
          {poll ? "Salva" : "Prepara"}
        </button>
        {live && (
          <button type="button" className="btn btn-gold btn-small" onClick={() => save(true)} disabled={!ready || polls.busy}>
            {poll ? "Salva e apri" : "Crea e apri subito"}
          </button>
        )}
      </div>
    </section>
  );
}

// Elenco dei sondaggi: chi gestisce li prepara, apre, chiude e mostra i risultati; gli altri votano.
// focus: mostra solo quel sondaggio (appena aperto, o con i risultati appena mostrati)
export default function PollsPanel({
  polls,
  live = true,
  focus,
  onShowAll,
}: {
  polls: PollsHook;
  // chiamata in corso: si può aprire subito un sondaggio appena scritto
  live?: boolean;
  focus?: string | null;
  onShowAll?: () => void;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const { state } = polls;
  if (!state) return <p className="muted">{polls.error || "Carico i sondaggi..."}</p>;
  const list = focus ? state.polls.filter((p) => p.id === focus) : state.polls;

  return (
    <div className="polls">
      {state.polls.length === 0 && editing !== "new" && (
        <p className="muted" style={{ margin: 0 }}>
          {state.manager
            ? "Nessun sondaggio. Preparali prima e aprili quando vuoi durante la videochiamata."
            : "Nessun sondaggio per ora."}
        </p>
      )}
      {list.map((p) =>
        editing === p.id ? (
          <PollForm key={p.id} poll={p} polls={polls} live={live} onDone={() => setEditing(null)} />
        ) : (
          <PollCard key={p.id} poll={p} polls={polls} live={live} onEdit={() => setEditing(p.id)} />
        )
      )}
      {!editing && polls.error && <p className="error">{polls.error}</p>}
      {focus && state.polls.length > list.length && onShowAll && (
        <button className="btn btn-ghost" onClick={onShowAll}>
          Tutti i sondaggi ({state.polls.length})
        </button>
      )}
      {state.manager &&
        !focus &&
        (editing === "new" ? (
          <PollForm polls={polls} live={live} onDone={() => setEditing(null)} />
        ) : (
          <button className="btn btn-ghost" onClick={() => setEditing("new")} disabled={!!editing}>
            + Nuovo sondaggio
          </button>
        ))}
    </div>
  );
}

// Sondaggi nella pagina di gestione: della chiamata in corso (risultati aggiornati spesso) o di una programmata
export function CallPolls({ code, live }: { code: string; live: boolean }) {
  const polls = usePolls(code, true, live ? 5000 : 0);
  return <PollsPanel polls={polls} live={live} />;
}

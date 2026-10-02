"use client";

import { useState } from "react";
import { MAX_BREAKOUT_NAME, MAX_BREAKOUTS, type BreakoutRoom } from "@/lib/video-types";

export type Person = { identity: string; name: string };

// "Dividi in stanze": quante stanze, che nome e chi va in ognuna. Ogni persona sta in una stanza sola:
// spuntandola in una stanza viene tolta dall'altra.
export default function BreakoutEditor({
  people,
  rooms: initialRooms,
  assign: initialAssign,
  busy,
  error,
  onSave,
  onCloseRooms,
  onCancel,
}: {
  people: Person[];
  rooms: BreakoutRoom[];
  assign: Record<string, string>;
  busy: boolean;
  error: string;
  onSave: (rooms: BreakoutRoom[], assign: Record<string, string>) => void;
  // solo se le stanze sono già aperte
  onCloseRooms?: () => void;
  onCancel: () => void;
}) {
  const active = initialRooms.length > 0;
  // Le stanze nuove ricevono qui il loro codice (lettere minuscole e cifre, come vuole il server)
  const [rooms, setRooms] = useState<BreakoutRoom[]>(() =>
    active ? initialRooms : [newRoom(0), newRoom(1)]
  );
  const [assign, setAssign] = useState<Record<string, string>>(() => ({ ...initialAssign }));

  const setCount = (n: number) => {
    const count = Math.max(1, Math.min(MAX_BREAKOUTS, n));
    setRooms((rs) => (count > rs.length ? [...rs, ...Array.from({ length: count - rs.length }, (_, i) => newRoom(rs.length + i))] : rs.slice(0, count)));
    // Chi era in una stanza tolta torna senza stanza
    setAssign((a) => {
      const keep = new Set(rooms.slice(0, count).map((r) => r.id));
      return Object.fromEntries(Object.entries(a).filter(([, id]) => keep.has(id)));
    });
  };
  const rename = (id: string, name: string) => setRooms((rs) => rs.map((r) => (r.id === id ? { ...r, name } : r)));
  const toggle = (identity: string, id: string) =>
    setAssign((a) => {
      const next = { ...a };
      if (next[identity] === id) delete next[identity];
      else next[identity] = id;
      return next;
    });
  // Chi non ha ancora una stanza viene distribuito dove ci sono meno persone
  const spread = () =>
    setAssign((a) => {
      const next = { ...a };
      const count = (id: string) => Object.values(next).filter((x) => x === id).length;
      for (const p of people) {
        if (next[p.identity] && rooms.some((r) => r.id === next[p.identity])) continue;
        const target = [...rooms].sort((x, y) => count(x.id) - count(y.id))[0];
        if (target) next[p.identity] = target.id;
      }
      return next;
    });

  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name || "un'altra stanza";
  const unassigned = people.filter((p) => !rooms.some((r) => r.id === assign[p.identity])).length;
  const save = () =>
    onSave(
      rooms.map((r, i) => ({ id: r.id, name: r.name.trim() || `Stanza ${i + 1}` })),
      Object.fromEntries(Object.entries(assign).filter(([, id]) => rooms.some((r) => r.id === id)))
    );

  return (
    <div className="call-breakout">
      <div className="call-breakout-count">
        <span className="field-label">Quante stanze</span>
        <div className="call-stepper">
          <button type="button" onClick={() => setCount(rooms.length - 1)} disabled={rooms.length <= 1} aria-label="Una stanza in meno">
            −
          </button>
          <strong>{rooms.length}</strong>
          <button type="button" onClick={() => setCount(rooms.length + 1)} disabled={rooms.length >= MAX_BREAKOUTS} aria-label="Una stanza in più">
            +
          </button>
        </div>
      </div>

      {people.length > 0 ? (
        <div className="row call-breakout-tools">
          <span className="muted">{unassigned ? `${unassigned} senza stanza (restano in plenaria)` : "Tutti hanno una stanza"}</span>
          {unassigned > 0 && (
            <button type="button" className="btn btn-ghost btn-small" onClick={spread}>
              Distribuisci
            </button>
          )}
        </div>
      ) : (
        <p className="muted call-sheet-label">Nessun partecipante ammesso: puoi preparare le stanze e assegnare le persone più tardi.</p>
      )}

      {rooms.map((r, i) => {
        const inHere = people.filter((p) => assign[p.identity] === r.id).length;
        return (
          <section key={r.id} className="call-breakout-room">
            <label className="field">
              <span>
                Stanza {i + 1} · {inHere} {inHere === 1 ? "persona" : "persone"}
              </span>
              <input
                className="input"
                value={r.name}
                maxLength={MAX_BREAKOUT_NAME}
                placeholder={`Stanza ${i + 1}`}
                onChange={(e) => rename(r.id, e.target.value)}
              />
            </label>
            {people.map((p) => {
              const where = assign[p.identity];
              const elsewhere = where && where !== r.id && rooms.some((x) => x.id === where);
              return (
                <label key={p.identity} className="call-check">
                  <input type="checkbox" checked={where === r.id} onChange={() => toggle(p.identity, r.id)} />
                  <span className={elsewhere ? "muted" : ""}>
                    {p.name}
                    {elsewhere && <small> · in {roomName(where)}</small>}
                  </span>
                </label>
              );
            })}
          </section>
        );
      })}

      {error && <p className="error">{error}</p>}
      <button className="btn btn-gold" onClick={save} disabled={busy}>
        {busy ? "Un attimo..." : active ? "Aggiorna le stanze" : "Apri le stanze"}
      </button>
      {onCloseRooms && (
        <button className="btn btn-danger" onClick={onCloseRooms} disabled={busy}>
          Chiudi tutte le stanze
        </button>
      )}
      <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
        Annulla
      </button>
    </div>
  );
}

let seq = 0;
function newRoom(i: number): BreakoutRoom {
  seq += 1;
  return { id: `n${Date.now().toString(36).slice(-6)}${seq}`, name: `Stanza ${i + 1}` };
}

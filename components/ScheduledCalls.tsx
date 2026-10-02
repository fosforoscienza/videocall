"use client";

import { useEffect, useState } from "react";
import type { HostCall } from "@/lib/useHostCall";
import ListenToggle from "./ListenToggle";
import { callSlug, DEFAULT_ACCESS, formatWhen, fromLocalInput, shareText, toLocalInput, type CallAccess, type CallInfo } from "@/lib/video-types";
import AccessPicker from "./AccessPicker";

const SOON = 15 * 60 * 1000;

async function shareLink(call: CallInfo, link: string, onCopied: () => void) {
  const text = shareText(call.title, call.needs_password ? call.password : "", call.starts_at ? formatWhen(call.starts_at) : undefined);
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
  if (nav.share) {
    await nav.share({ title: call.title || "Videochiamata", text, url: link }).catch(() => {});
    return;
  }
  await navigator.clipboard?.writeText(link).catch(() => {});
  onCopied();
}

function Item({ call, host, now }: { call: CallInfo; host: HostCall; now: number }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(call.title ?? "");
  const [when, setWhen] = useState(call.starts_at ? toLocalInput(call.starts_at) : "");
  const [listen, setListen] = useState(!!call.listen_only);
  const [access, setAccess] = useState<CallAccess>({ mode: call.access ?? DEFAULT_ACCESS.mode, password: call.password ?? "" });
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}/call/${callSlug(call)}`;
  const startsAt = call.starts_at ? Date.parse(call.starts_at) : 0;
  const due = startsAt - now < SOON;

  const copied2s = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (editing) {
    return (
      <div className="call-plan-item">
        <input className="input" placeholder="Nome (facoltativo)" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Nome della videochiamata programmata" />
        <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Data e ora" />
        <ListenToggle value={listen} onChange={setListen} />
        <AccessPicker value={access} onChange={setAccess} />
        <div className="row call-plan-actions">
          <button className="btn btn-ghost btn-small" onClick={() => setEditing(false)}>
            Annulla
          </button>
          <button
            className="btn btn-gold btn-small"
            disabled={!when || host.busy || (access.mode === "password" && !access.password.trim())}
            onClick={async () => {
              const a = { mode: access.mode, password: access.password.trim() };
              if (await host.plan("update", { id: call.id, title: title.trim(), startsAt: fromLocalInput(when), listenOnly: listen, access: a })) setEditing(false);
            }}
          >
            Salva
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`call-plan-item ${due ? "due" : ""}`}>
      <div>
        <div className="call-plan-title">{call.title || "Videochiamata senza nome"}</div>
        <div className="call-plan-when">
          📅 {call.starts_at ? formatWhen(call.starts_at) : "Data da decidere"}
          {due && <strong> · è ora di iniziare</strong>}
        </div>
        {call.listen_only && <div className="call-plan-when">🎧 Solo ascolto e chat</div>}
        <div className="call-plan-when">
          {call.access === "open" ? "🔓 Accesso libero" : call.access === "password" ? "🔑 Con password" : "🚪 Sala d'attesa"}
          {call.needs_password && (
            <>
              {" · "}password <strong>{call.password}</strong>
            </>
          )}
        </div>
      </div>
      <div className="row call-plan-actions">
        <button
          className="btn btn-ghost btn-small"
          onClick={async () => {
            await navigator.clipboard?.writeText(link).catch(() => {});
            copied2s();
          }}
        >
          {copied ? "Copiato!" : "Copia link"}
        </button>
        <button className="btn btn-ghost btn-small" onClick={() => shareLink(call, link, copied2s)}>
          Condividi
        </button>
        <button className="btn btn-ghost btn-small" onClick={() => setEditing(true)}>
          Modifica
        </button>
        <button
          className="btn btn-ghost btn-small"
          onClick={() => confirm("Annullare questa videochiamata? Il suo link smetterà di funzionare.") && host.plan("cancel", { id: call.id })}
        >
          Elimina
        </button>
        <button
          className={`btn btn-small ${due ? "btn-gold" : "btn-ghost"}`}
          disabled={host.busy || !!host.call}
          title={host.call ? "Termina prima la videochiamata in corso" : undefined}
          onClick={() => host.plan("start", { id: call.id })}
        >
          Avvia ora
        </button>
      </div>
    </div>
  );
}

// Videochiamate programmate: il link si può condividere subito; chi lo apre prima vede quando inizia
// e ci entra appena l'organizzatore preme "Avvia ora".
export default function ScheduledCalls({ host }: { host: HostCall }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [listen, setListen] = useState(false);
  const [access, setAccess] = useState<CallAccess>(DEFAULT_ACCESS);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="card section">
      <h3>Programmate ({host.scheduled.length})</h3>
      {!host.canSchedule && (
        <p className="error">Per programmare le videochiamate il database va aggiornato: esegui di nuovo supabase/schema.sql nel SQL Editor di Supabase.</p>
      )}
      {host.scheduled.length === 0 && host.canSchedule && (
        <p className="muted" style={{ margin: 0 }}>
          Nessuna videochiamata programmata. Il link si può condividere subito: chi lo apre vede quando inizia.
        </p>
      )}
      {host.scheduled.map((c) => (
        <Item key={`${c.id}-${c.title}-${c.starts_at}-${c.listen_only}-${c.access}-${c.password}`} call={c} host={host} now={now} />
      ))}
      {open ? (
        <div className="call-plan-item">
          <input className="input" placeholder="Nome (facoltativo)" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Nome della nuova videochiamata" />
          <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Data e ora della nuova videochiamata" />
          <ListenToggle value={listen} onChange={setListen} />
          <AccessPicker value={access} onChange={setAccess} />
          <div className="row call-plan-actions">
            <button className="btn btn-ghost btn-small" onClick={() => setOpen(false)}>
              Annulla
            </button>
            <button
              className="btn btn-gold btn-small"
              disabled={!when || host.busy || (access.mode === "password" && !access.password.trim())}
              onClick={async () => {
                const a = { mode: access.mode, password: access.password.trim() };
                if (await host.plan("create", { title: title.trim(), startsAt: fromLocalInput(when), listenOnly: listen, access: a })) {
                  setOpen(false);
                  setTitle("");
                  setWhen("");
                  setListen(false);
                  setAccess(DEFAULT_ACCESS);
                }
              }}
            >
              Programma
            </button>
          </div>
        </div>
      ) : (
        host.canSchedule && (
          <button className="btn btn-ghost" onClick={() => setOpen(true)} disabled={!host.configured}>
            + Programma una videochiamata
          </button>
        )
      )}
    </section>
  );
}

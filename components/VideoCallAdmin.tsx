"use client";

import { useCallback, useState } from "react";
import VideoRoom, { type LeaveReason } from "./VideoRoom";
import AccessToggle from "./AccessToggle";
import ScheduledCalls from "./ScheduledCalls";
import ListenToggle from "./ListenToggle";
import type { HostCall } from "@/lib/useHostCall";
import { callSlug } from "@/lib/video-types";
import { ENTER_WITH } from "@/lib/video-config";

// Scheda Video dell'organizzatore: avvia la videochiamata, condivide il link, decide chi entra
export default function VideoCallAdmin({ host }: { host: HostCall }) {
  const { loaded, configured, call, requests, pending, error, busy } = host;
  const [room, setRoom] = useState<{ url: string; token: string } | null>(null);
  const [joinError, setJoinError] = useState("");
  const [joining, setJoining] = useState(false);
  const [copied, setCopied] = useState(false);
  // Nome scelto prima di avviare / nome in modifica durante la chiamata (null = non in modifica)
  const [newTitle, setNewTitle] = useState("");
  const [newListen, setNewListen] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const link = call && typeof window !== "undefined" ? `${window.location.origin}/call/${callSlug(call)}` : "";
  const admitted = requests.filter((r) => r.status === "accepted");

  async function enter() {
    setJoining(true);
    setJoinError("");
    const res = await fetch("/api/admin/call/token", { cache: "no-store" }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (res?.ok && data?.token) setRoom({ url: data.url, token: data.token });
    else setJoinError(data?.error || "Non riesco a entrare, riprova");
    setJoining(false);
  }

  async function copy() {
    await navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function share() {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (!nav.share) return copy();
    await nav
      .share({ title: call?.title || "Videochiamata", text: `Entra nella videochiamata${call?.title ? ` "${call.title}"` : ""} con ${ENTER_WITH}`, url: link })
      .catch(() => {});
  }

  async function end() {
    if (!confirm("Terminare la videochiamata per tutti? Il link smetterà di funzionare.")) return;
    await host.end();
  }

  const onLeave = useCallback(
    (reason: LeaveReason, detail?: string) => {
      setRoom(null);
      if (reason === "error") setJoinError(`Connessione persa: premi di nuovo "Entra".${detail ? ` (${detail})` : ""}`);
      if (reason === "duplicate") setJoinError("Sei entrato nella videochiamata da un altro dispositivo.");
    },
    []
  );

  if (!loaded) return <p className="muted">{error || "Carico..."}</p>;

  return (
    <div className="scroll call-admin">
      <section className={`card section ${call ? "call-live" : ""}`}>
        <h3>{call ? (call.listen_only ? "🔴 Videochiamata in corso · 🎧 solo ascolto" : "🔴 Videochiamata in corso") : "Videochiamata"}</h3>
        {!configured && (
          <p className="error">
            Videochiamate non configurate: su Vercel mancano LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET (vedi README).
          </p>
        )}
        {!call ? (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Avvia una videochiamata e condividi il link: i partecipanti entrano con {ENTER_WITH} e tu decidi
              chi far entrare.
            </p>
            <label className="field">
              <span>Nome della videochiamata (facoltativo)</span>
              <input
                className="input"
                placeholder="es. Riunione capisquadra"
                maxLength={80}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </label>
            <ListenToggle value={newListen} onChange={setNewListen} />
            <button
              className="btn btn-gold"
              onClick={async () => {
                await host.start(newTitle.trim(), newListen);
                setNewTitle("");
                setNewListen(false);
              }}
              disabled={busy || !configured}
            >
              {busy ? "Avvio..." : "Avvia videochiamata"}
            </button>
          </>
        ) : (
          <>
            <div className="field">
              <span>Nome della videochiamata</span>
              <div className="row">
                <input
                  className="input"
                  placeholder="Senza nome"
                  maxLength={80}
                  value={nameDraft ?? call.title ?? ""}
                  onChange={(e) => setNameDraft(e.target.value)}
                  aria-label="Nome della videochiamata"
                />
                {nameDraft !== null && nameDraft.trim() !== (call.title ?? "") && (
                  <button
                    className="btn btn-gold btn-small"
                    onClick={async () => {
                      await host.rename(nameDraft.trim());
                      setNameDraft(null);
                    }}
                    disabled={busy}
                  >
                    Salva
                  </button>
                )}
              </div>
            </div>
            <div className="call-link">
              <input className="input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link della videochiamata" />
              <div className="row">
                <button className="btn btn-ghost btn-small" onClick={copy}>
                  {copied ? "Copiato!" : "Copia"}
                </button>
                <button className="btn btn-ghost btn-small" onClick={share}>
                  Condividi
                </button>
              </div>
            </div>
            <button className="btn btn-gold" onClick={enter} disabled={joining}>
              {joining ? "Entro..." : "Entra nella videochiamata"}
            </button>
            {joinError && <p className="error">{joinError}</p>}
          </>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <ScheduledCalls host={host} />

      <section className="card section">
        <h3>{call ? "Modalità, ingresso e schermo" : "Ingresso e schermo"}</h3>
        <AccessToggle host={host} />
      </section>

      {call && (!host.openAccess || pending.length > 0) && (
        <section className="card section">
          <h3>Sala d&apos;attesa ({pending.length})</h3>
          {pending.length === 0 && (
            <p className="muted" style={{ margin: 0 }}>
              Nessuno sta aspettando. Chi apre il link compare qui.
            </p>
          )}
          {pending.map((r) => (
            <div key={r.identity} className="list-row">
              <span className="call-person">{r.name}</span>
              <div className="row">
                <button className="btn btn-ghost btn-small" onClick={() => host.act("reject", r.identity)}>
                  Rifiuta
                </button>
                <button className="btn btn-gold btn-small" onClick={() => host.act("accept", r.identity)}>
                  Ammetti
                </button>
              </div>
            </div>
          ))}
          {pending.length > 1 && (
            <button className="btn btn-ghost" onClick={() => host.act("accept_all")}>
              Ammetti tutti
            </button>
          )}
        </section>
      )}

      {call && admitted.length > 0 && (
        <section className="card section">
          <h3>Ammessi ({admitted.length})</h3>
          {admitted.map((r) => (
            <div key={r.identity} className="list-row">
              <span className="call-person">{r.name}</span>
              <button
                className="btn btn-danger btn-small"
                onClick={() => confirm(`Togliere ${r.name} dalla videochiamata?`) && host.act("remove", r.identity)}
              >
                Rimuovi
              </button>
            </div>
          ))}
        </section>
      )}

      {call && (
        <button className="btn btn-danger" onClick={end} disabled={busy}>
          Termina videochiamata
        </button>
      )}

      {room && (
        <VideoRoom key={room.token} url={room.url} token={room.token} host={host} link={link} title={call?.title ?? ""} onLeave={onLeave} />
      )}
    </div>
  );
}

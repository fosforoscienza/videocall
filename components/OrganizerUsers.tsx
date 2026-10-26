"use client";

import { useCallback, useEffect, useState } from "react";

// me: è chi sta guardando (non può eliminare sé stesso né togliersi il ruolo di amministratore)
type User = { name: string; admin: boolean; me: boolean; created_at: string };

// Utenti che possono organizzare le videochiamate (solo per gli amministratori: chi è in VIDEO_ORGANIZERS e gli
// utenti creati come amministratori): si creano con nome e password, scegliendo se sono anche amministratori;
// si elimina chi non serve più. Con lo stesso nome si cambia la password.
export default function OrganizerUsers() {
  const [admins, setAdmins] = useState<string[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users", { cache: "no-store" }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (res?.ok) {
      setAdmins(data.admins ?? []);
      setUsers(data.users ?? []);
      setError("");
    } else setError(data?.error || "Connessione assente, riprova");
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function send(body: Record<string, string | boolean>) {
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (!res?.ok) setError(data?.error || "Connessione assente, riprova");
    await load();
    setBusy(false);
    return !!res?.ok;
  }

  const exists = users.some((u) => u.name.toLowerCase() === username.trim().toLowerCase());

  return (
    <section className="card section">
      <h3>Utenti ({admins.length + users.length})</h3>
      <p className="muted" style={{ margin: 0 }}>
        Chi è in questo elenco entra da questa pagina con nome e password e può avviare e programmare le videochiamate.
        Gli amministratori gestiscono anche gli utenti; quelli in VIDEO_ORGANIZERS su Coolify non si possono togliere da qui.
      </p>
      {admins.map((name) => (
        <div className="list-row" key={`a-${name}`}>
          <span className="call-plan-title">{name}</span>
          <span className="muted">🛡️ amministratore fisso</span>
        </div>
      ))}
      {users.map((u) => (
        <div className="list-row call-user-row" key={u.name}>
          <div>
            <div className="call-plan-title">
              {u.name}
              {u.me && <span className="muted"> (tu)</span>}
            </div>
            <div className="call-plan-when">{u.admin ? "🛡️ Amministratore" : "👤 Organizzatore"}</div>
          </div>
          <div className="row call-plan-actions">
            {!u.me && (
              <button
                className="btn btn-ghost btn-small"
                disabled={busy}
                onClick={() =>
                  confirm(
                    u.admin
                      ? `Togliere a ${u.name} il ruolo di amministratore? Potrà ancora organizzare le videochiamate.`
                      : `Rendere ${u.name} amministratore? Potrà creare, modificare ed eliminare gli utenti.`
                  ) && send({ action: "admin", username: u.name, admin: !u.admin })
                }
              >
                {u.admin ? "Togli admin" : "Rendi admin"}
              </button>
            )}
            <button
              className="btn btn-ghost btn-small"
              disabled={busy}
              onClick={() => {
                setUsername(u.name);
                setPassword("");
                setOpen(true);
              }}
            >
              Password
            </button>
            {!u.me && (
              <button
                className="btn btn-ghost btn-small"
                disabled={busy}
                onClick={() => confirm(`Eliminare ${u.name}? Non potrà più entrare.`) && send({ action: "delete", username: u.name })}
              >
                Elimina
              </button>
            )}
          </div>
        </div>
      ))}
      {loaded && !error && users.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Nessun altro utente.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {open ? (
        <form
          className="call-plan-item"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await send({ action: "save", username, password, admin: makeAdmin })) {
              setOpen(false);
              setUsername("");
              setPassword("");
              setMakeAdmin(false);
            }
          }}
        >
          <input
            className="input"
            placeholder="Nome"
            aria-label="Nome del nuovo utente"
            autoComplete="off"
            autoCapitalize="none"
            maxLength={40}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <input
            className="input"
            placeholder="Password (almeno 8 caratteri)"
            aria-label="Password del nuovo utente"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {exists ? (
            <p className="muted" style={{ margin: 0 }}>
              Esiste già: gli cambi la password (dovrà rientrare).
            </p>
          ) : (
            <>
              <div className="view-toggle">
                <button type="button" className={makeAdmin ? "" : "active"} onClick={() => setMakeAdmin(false)}>
                  👤 Organizzatore
                </button>
                <button type="button" className={makeAdmin ? "active" : ""} onClick={() => setMakeAdmin(true)}>
                  🛡️ Amministratore
                </button>
              </div>
              <p className="muted" style={{ margin: 0 }}>
                {makeAdmin
                  ? "Amministratore: organizza le videochiamate e in più crea, modifica ed elimina gli utenti."
                  : "Organizzatore: avvia, programma e gestisce le videochiamate."}
              </p>
            </>
          )}
          <div className="row call-plan-actions">
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => {
                setOpen(false);
                setMakeAdmin(false);
              }}
            >
              Annulla
            </button>
            <button className="btn btn-gold btn-small" disabled={busy || !username.trim() || !password.trim()}>
              {exists ? "Cambia password" : "Crea utente"}
            </button>
          </div>
        </form>
      ) : (
        <button className="btn btn-ghost" onClick={() => setOpen(true)}>
          + Nuovo utente
        </button>
      )}
    </section>
  );
}

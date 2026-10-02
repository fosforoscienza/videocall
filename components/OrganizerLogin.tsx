"use client";

import { useState } from "react";
import { VIDEO_CONFIG } from "@/lib/video-config";

// Accesso degli organizzatori (nomi e password nella variabile d'ambiente VIDEO_ORGANIZERS).
// demo: credenziali di prova da mostrare quando l'app gira senza database (lib/demo-db.ts)
export default function OrganizerLogin({ demo }: { demo?: { name: string; password: string } }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (res?.ok) window.location.reload();
    else {
      setError(data?.error || "Connessione assente, riprova");
      setLoading(false);
    }
  }

  return (
    <div className="login">
      <div className="login-hero">
        <p className="subtitle">{VIDEO_CONFIG.brand}</p>
        <h1 className="title">
          Video<span>chiamate</span>
        </h1>
      </div>
      <form className="card" onSubmit={submit}>
        <p className="muted call-hint">Accesso per gli organizzatori. I partecipanti entrano dal link della videochiamata.</p>
        {demo && (
          <p className="muted call-hint">
            Modalità demo, senza database: entra con <b>{demo.name}</b> / <b>{demo.password}</b>.
          </p>
        )}
        <input
          className="input"
          placeholder="Nome organizzatore"
          aria-label="Nome organizzatore"
          autoComplete="username"
          autoCapitalize="none"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="input"
          placeholder="Password"
          aria-label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        <button className="btn btn-gold" disabled={loading}>
          {loading ? "Un attimo..." : "Entra"}
        </button>
      </form>
    </div>
  );
}

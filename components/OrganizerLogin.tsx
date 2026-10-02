"use client";

import { useState } from "react";
import { VIDEO_CONFIG } from "@/lib/video-config";

// Accesso degli organizzatori (nomi e password nella variabile d'ambiente VIDEO_ORGANIZERS)
export default function OrganizerLogin() {
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
        <input
          className="input"
          placeholder="Nome organizzatore"
          aria-label="Nome e cognome"
          autoComplete="username"
          autoCapitalize="none"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="input"
          placeholder="Password"
          aria-label="Codice socio"
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

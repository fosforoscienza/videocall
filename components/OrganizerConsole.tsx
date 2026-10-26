"use client";

import VideoCallAdmin from "./VideoCallAdmin";
import OrganizerUsers from "./OrganizerUsers";
import { useHostCall } from "@/lib/useHostCall";

// Pagina dell'organizzatore: intestazione con il suo nome e la gestione delle videochiamate
// (admin: in più l'elenco degli utenti che possono organizzare)
export default function OrganizerConsole({ name, admin }: { name: string; admin: boolean }) {
  const host = useHostCall();
  return (
    <div className="admin">
      <div className="topbar">
        <div>
          <h1 className="title">Videochiamate</h1>
          <span className="muted">{name}</span>
        </div>
        <button
          className="btn btn-ghost btn-small"
          onClick={async () => {
            await fetch("/api/logout", { method: "POST" }).catch(() => {});
            window.location.reload();
          }}
        >
          Esci
        </button>
      </div>
      <VideoCallAdmin host={host}>{admin && <OrganizerUsers />}</VideoCallAdmin>
    </div>
  );
}

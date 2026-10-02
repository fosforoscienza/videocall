"use client";

import VideoCallAdmin from "./VideoCallAdmin";
import { useHostCall } from "@/lib/useHostCall";

// Pagina dell'organizzatore: intestazione con il suo nome e la gestione delle videochiamate
export default function OrganizerConsole({ name }: { name: string }) {
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
      <VideoCallAdmin host={host} />
    </div>
  );
}

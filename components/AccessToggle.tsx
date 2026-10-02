"use client";

import type { HostCall } from "@/lib/useHostCall";
import ListenToggle from "./ListenToggle";
import { ENTER_WITH } from "@/lib/video-config";

// Scelte dell'organizzatore: sala d'attesa o accesso libero, chi può condividere lo schermo
// e, a chiamata in corso, se i partecipanti possono parlare o solo ascoltare
export default function AccessToggle({ host }: { host: HostCall }) {
  return (
    <div className="section">
      {host.call && <ListenToggle value={host.listenOnly} onChange={host.setListenOnly} disabled={host.busy} live />}
      <div className="view-toggle">
        <button className={host.openAccess ? "" : "active"} onClick={() => host.setOpenAccess(false)} disabled={host.busy}>
          Sala d&apos;attesa
        </button>
        <button className={host.openAccess ? "active" : ""} onClick={() => host.setOpenAccess(true)} disabled={host.busy}>
          Accesso libero
        </button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {host.openAccess
          ? `Chi apre il link ed entra con ${ENTER_WITH} è subito nella videochiamata.`
          : "Chi apre il link aspetta finché non lo ammetti."}
      </p>
      <div className="view-toggle">
        <button className={host.shareAll ? "" : "active"} onClick={() => host.setShareAll(false)} disabled={host.busy}>
          🖥️ Solo organizzatori
        </button>
        <button className={host.shareAll ? "active" : ""} onClick={() => host.setShareAll(true)} disabled={host.busy}>
          🖥️ Tutti
        </button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {host.shareAll
          ? "Tutti possono condividere lo schermo (da computer). Vale subito, anche a chiamata in corso."
          : "Solo gli organizzatori possono condividere lo schermo."}
      </p>
    </div>
  );
}

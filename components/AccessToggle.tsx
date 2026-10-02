"use client";

import { useState } from "react";
import type { HostCall } from "@/lib/useHostCall";
import { DEFAULT_ACCESS, type CallAccess } from "@/lib/video-types";
import AccessPicker from "./AccessPicker";
import ListenToggle from "./ListenToggle";

// Scelte dell'organizzatore: a chiamata in corso come si entra (libero, password, sala d'attesa) e se i
// partecipanti possono parlare o solo ascoltare; sempre, chi può condividere lo schermo
export default function AccessToggle({ host }: { host: HostCall }) {
  const call = host.call;
  const saved: CallAccess = call ? { mode: call.access ?? DEFAULT_ACCESS.mode, password: call.password ?? "" } : DEFAULT_ACCESS;
  // Modifica in corso (null = mostra quella salvata)
  const [draft, setDraft] = useState<CallAccess | null>(null);
  const shown = draft ?? saved;
  const changed = !!draft && (draft.mode !== saved.mode || draft.password.trim() !== saved.password);
  const invalid = shown.mode === "password" && !shown.password.trim();

  return (
    <div className="section">
      {call && (
        <>
          <ListenToggle value={host.listenOnly} onChange={host.setListenOnly} disabled={host.busy} live />
          <AccessPicker value={shown} onChange={setDraft} disabled={host.busy} />
          {changed && (
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-ghost btn-small" onClick={() => setDraft(null)} disabled={host.busy}>
                Annulla
              </button>
              <button
                className="btn btn-gold btn-small"
                disabled={host.busy || invalid}
                onClick={async () => {
                  if (await host.setAccess({ mode: shown.mode, password: shown.password.trim() })) setDraft(null);
                }}
              >
                Salva accesso
              </button>
            </div>
          )}
        </>
      )}
      <div className="view-toggle">
        <button className={host.shareAll ? "" : "active"} onClick={() => host.setShareAll(false)} disabled={host.busy}>
          Schermo: solo organizzatori
        </button>
        <button className={host.shareAll ? "active" : ""} onClick={() => host.setShareAll(true)} disabled={host.busy}>
          Schermo: tutti
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

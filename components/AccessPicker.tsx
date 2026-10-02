"use client";

import { MAX_PASSWORD, type CallAccess } from "@/lib/video-types";

const MODES: { mode: CallAccess["mode"]; label: string }[] = [
  { mode: "open", label: "🔓 Libero" },
  { mode: "password", label: "🔑 Password" },
  { mode: "waiting", label: "🚪 Sala d'attesa" },
];

// Come si entra nella riunione: libero (basta il nome), con la password della riunione, oppure dalla sala
// d'attesa (l'organizzatore ammette; si può chiedere anche la password)
export default function AccessPicker({
  value,
  onChange,
  disabled,
}: {
  value: CallAccess;
  onChange: (a: CallAccess) => void;
  disabled?: boolean;
}) {
  const { mode, password } = value;
  return (
    <div className="call-access">
      <div className="view-toggle view-toggle-3">
        {MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            className={mode === m.mode ? "active" : ""}
            onClick={() => onChange({ mode: m.mode, password: m.mode === "open" ? "" : password })}
            disabled={disabled}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode !== "open" && (
        <input
          className="input"
          placeholder={mode === "password" ? "Password della riunione" : "Password (facoltativa)"}
          aria-label="Password della riunione"
          maxLength={MAX_PASSWORD}
          autoComplete="off"
          spellCheck={false}
          value={password}
          onChange={(e) => onChange({ mode, password: e.target.value })}
          disabled={disabled}
        />
      )}
      <p className="muted" style={{ margin: 0 }}>
        {mode === "open"
          ? "Chi ha il link entra subito scrivendo il suo nome."
          : mode === "password"
            ? "Chi ha il link entra scrivendo il suo nome e questa password."
            : password
              ? "Chi ha il link scrive nome e password, poi aspetta che tu lo ammetta."
              : "Chi ha il link scrive il suo nome e aspetta che tu lo ammetta."}
      </p>
    </div>
  );
}

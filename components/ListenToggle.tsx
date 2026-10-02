"use client";

// Tipo di videochiamata: riunione (tutti parlano) o webinar (i partecipanti guardano, ascoltano
// e scrivono in chat; parlano solo organizzatori e co-organizzatori)
export default function ListenToggle({
  value,
  onChange,
  disabled,
  live,
}: {
  value: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  live?: boolean;
}) {
  return (
    <>
      <div className="view-toggle">
        <button type="button" className={value ? "" : "active"} onClick={() => onChange(false)} disabled={disabled}>
          🎙️ Riunione
        </button>
        <button type="button" className={value ? "active" : ""} onClick={() => onChange(true)} disabled={disabled}>
          📺 Webinar
        </button>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {value
          ? `Webinar: i partecipanti vedono e ascoltano gli organizzatori e scrivono in chat, ma non possono accendere microfono né videocamera.${live ? " Per far parlare qualcuno rendilo co-organizzatore." : ""}`
          : `Tutti possono accendere microfono e videocamera.${live ? " Vale subito, anche a chiamata in corso." : ""}`}
      </p>
    </>
  );
}

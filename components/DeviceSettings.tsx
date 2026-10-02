"use client";

import { useEffect, useState } from "react";

export type DeviceKind = "videoinput" | "audioinput" | "audiooutput";
export type DeviceChoice = Partial<Record<DeviceKind, string>>;

const KEY = "video-call-devices";

// Dispositivi scelti l'ultima volta (su questo telefono o computer)
export function loadDevices(): DeviceChoice {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as DeviceChoice;
  } catch {
    return {};
  }
}

export function saveDevice(kind: DeviceKind, id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadDevices(), [kind]: id }));
  } catch {
    // memoria del browser non disponibile: la scelta vale solo per questa chiamata
  }
}

// Scegliere l'altoparlante non è possibile ovunque (per esempio su iPhone e iPad)
export const canChooseOutput = () => typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;

// Elenco di fotocamere, microfoni e altoparlanti, aggiornato quando se ne collega o scollega uno
export function useDeviceList() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    const load = () =>
      md
        .enumerateDevices()
        .then((list) => setDevices(list.filter((d) => d.deviceId)))
        .catch(() => {});
    load();
    md.addEventListener?.("devicechange", load);
    return () => md.removeEventListener?.("devicechange", load);
  }, []);
  return devices;
}

const LABELS: Record<DeviceKind, { title: string; icon: string; fallback: string }> = {
  videoinput: { title: "Fotocamera", icon: "📹", fallback: "Fotocamera" },
  audioinput: { title: "Microfono", icon: "🎙️", fallback: "Microfono" },
  audiooutput: { title: "Altoparlante", icon: "🔊", fallback: "Altoparlante" },
};

// Scelta di fotocamera, microfono (ingresso) e altoparlante (uscita)
export default function DeviceSettings({
  devices,
  value,
  onChange,
  kinds = ["videoinput", "audioinput", "audiooutput"],
}: {
  devices: MediaDeviceInfo[];
  value: DeviceChoice;
  onChange: (kind: DeviceKind, id: string) => void;
  kinds?: DeviceKind[];
}) {
  const shown = kinds.filter((k) => k !== "audiooutput" || canChooseOutput());
  return (
    <div className="call-devices">
      {shown.map((kind) => {
        const list = devices.filter((d) => d.kind === kind);
        const l = LABELS[kind];
        return (
          <label key={kind} className="field">
            <span>
              {l.icon} {l.title}
            </span>
            {list.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {kind === "audiooutput" ? "Quello predefinito del dispositivo" : "Nessuno trovato (o permesso non dato)"}
              </p>
            ) : (
              <select className="input" value={value[kind] ?? list[0].deviceId} onChange={(e) => onChange(kind, e.target.value)}>
                {list.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `${l.fallback} ${i + 1}`}
                  </option>
                ))}
              </select>
            )}
          </label>
        );
      })}
    </div>
  );
}

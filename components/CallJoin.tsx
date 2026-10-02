"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createLocalTracks, Track, VideoPresets, type LocalTrack } from "livekit-client";
import Icon from "./Icons";
import VideoRoom, { type LeaveReason } from "./VideoRoom";
import DeviceSettings, { loadDevices, saveDevice, useDeviceList, type DeviceChoice, type DeviceKind } from "./DeviceSettings";
import { useHostCall } from "@/lib/useHostCall";
import { formatWhen, type AccessMode, type BreakoutRoom, type JoinState } from "@/lib/video-types";
import { fetchRoomTicket } from "@/lib/breakout-client";
import { VIDEO_CONFIG } from "@/lib/video-config";

type Phase =
  | { kind: "form" }
  | { kind: "scheduled"; startsAt: string | null }
  | { kind: "waiting" }
  | {
      kind: "room";
      url: string;
      token: string;
      host: boolean;
      listenOnly: boolean;
      // stanza in cui si è (null = plenaria); media e notice dopo uno spostamento tra le stanze
      breakout?: BreakoutRoom | null;
      media?: { camera: boolean; mic: boolean };
      notice?: string;
    }
  | { kind: "rejected" | "removed" | "ended" | "left" | "duplicate" | "error" };

const MESSAGES: Record<"rejected" | "removed" | "ended" | "left" | "duplicate" | "error", { icon: string; title: string; text: string; retry?: string }> = {
  rejected: { icon: "🚪", title: "Non sei stato ammesso", text: "L'organizzatore non ti ha fatto entrare.", retry: "Chiedi di nuovo" },
  removed: { icon: "🚪", title: "Sei uscito dalla chiamata", text: "L'organizzatore ti ha tolto dalla videochiamata.", retry: "Chiedi di rientrare" },
  ended: { icon: "📴", title: "Videochiamata terminata", text: "Questa videochiamata è finita o il link non è più valido." },
  left: { icon: "👋", title: "Hai lasciato la chiamata", text: "Puoi rientrare quando vuoi finché la videochiamata è in corso.", retry: "Rientra" },
  duplicate: { icon: "📱", title: "Sei entrato da un altro dispositivo", text: "La videochiamata continua sull'altro telefono o computer.", retry: "Rientra da qui" },
  error: { icon: "📶", title: "Connessione persa", text: "Non riesco a collegarmi alla videochiamata.", retry: "Riprova" },
};

// "Inizia tra 2 giorni", "tra 25 minuti"... (vuoto finché il browser non conosce l'ora)
function countdown(startsAt: string | null, now: number | null) {
  if (now === null) return "";
  const ms = startsAt ? Date.parse(startsAt) - now : 0;
  if (ms <= 60 * 1000) return "Sta per iniziare: aspettiamo l'organizzatore";
  const min = Math.round(ms / 60000);
  if (min < 60) return `Inizia tra ${min} ${min === 1 ? "minuto" : "minuti"}`;
  const h = Math.round(min / 60);
  if (h < 24) return `Inizia tra ${h} ${h === 1 ? "ora" : "ore"}`;
  const d = Math.round(h / 24);
  return `Inizia tra ${d} ${d === 1 ? "giorno" : "giorni"}`;
}

// Pagina del link della videochiamata: accesso (vedi lib/video-config.ts), sala d'attesa con
// l'anteprima della fotocamera e, quando l'organizzatore ammette, la videochiamata.
export default function CallJoin({
  code,
  exists,
  me,
  showAppLink,
  access = "waiting",
  needsPassword = false,
  title = "",
  live = true,
  startsAt = null,
  listenOnly = false,
}: {
  listenOnly?: boolean;
  title?: string;
  live?: boolean;
  startsAt?: string | null;
  // Come si entra in questa riunione (scelto dall'organizzatore) e se serve la password della riunione
  access?: AccessMode;
  needsPassword?: boolean;
  code: string;
  exists: boolean;
  me: { name: string } | null;
  showAppLink: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(
    !exists ? { kind: "ended" } : live ? { kind: "form" } : { kind: "scheduled", startsAt }
  );
  // Ora attuale per il conto alla rovescia (solo nel browser, dopo il primo disegno)
  const [now, setNow] = useState<number | null>(null);
  const [name, setName] = useState(me?.name ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [previewError, setPreviewError] = useState("");
  // Fotocamera, microfono e altoparlante scelti (ricordati per la prossima volta)
  const [devices, setDevices] = useState<DeviceChoice>({});
  const [showDevices, setShowDevices] = useState(false);
  const deviceList = useDeviceList();
  useEffect(() => setDevices(loadDevices()), []);
  const camOnRef = useRef(camOn);
  const micOnRef = useRef(micOn);
  const preview = useRef<HTMLVideoElement>(null);
  const tracksRef = useRef<LocalTrack[]>([]);
  const wantPreview = useRef(false);
  const [known, setKnown] = useState(me !== null);
  // Solo ascolto: niente fotocamera né microfono, si guarda, si ascolta e si scrive in chat
  const [listen, setListen] = useState(listenOnly);
  const listenRef = useRef(listenOnly);
  // Gli organizzatori (già riconosciuti) non scrivono la password della riunione
  const askPassword = needsPassword && !showAppLink;
  const enterLabel = access === "waiting" ? "Chiedi di entrare" : "Entra";

  const isHost = phase.kind === "room" && phase.host;
  const host = useHostCall(isHost);

  const stopPreview = useCallback(() => {
    wantPreview.current = false;
    tracksRef.current.forEach((t) => t.stop());
    tracksRef.current = [];
    setTracks([]);
  }, []);
  useEffect(() => stopPreview, [stopPreview]);

  // Anteprima della fotocamera in sala d'attesa (chiede subito i permessi, così all'ingresso partono da sole)
  const startPreview = useCallback(async () => {
    if (wantPreview.current) return;
    wantPreview.current = true;
    setPreviewError("");
    try {
      const saved = loadDevices();
      const t = await createLocalTracks({
        audio: saved.audioinput ? { deviceId: saved.audioinput } : true,
        video: { facingMode: "user", resolution: VideoPresets.h540.resolution, deviceId: saved.videoinput },
      }).catch(() =>
        // dispositivo salvato non più collegato: quelli predefiniti
        createLocalTracks({ audio: true, video: { facingMode: "user", resolution: VideoPresets.h540.resolution } })
      );
      // Nel frattempo è già entrato (o ha annullato): l'anteprima non serve più
      if (!wantPreview.current) return t.forEach((x) => x.stop());
      t.forEach((x) => {
        if (x.kind === Track.Kind.Video && !camOnRef.current) x.mute().catch(() => {});
        if (x.kind === Track.Kind.Audio && !micOnRef.current) x.mute().catch(() => {});
      });
      tracksRef.current = t;
      setTracks(t);
    } catch {
      if (!wantPreview.current) return;
      setPreviewError("Non riesco ad accedere a fotocamera e microfono: consenti l'accesso nelle impostazioni del browser.");
    }
  }, []);

  const videoTrack = tracks.find((t) => t.kind === Track.Kind.Video);
  useEffect(() => {
    const el = preview.current;
    if (!el || !videoTrack) return;
    videoTrack.attach(el);
    return () => {
      videoTrack.detach(el);
    };
  }, [videoTrack, phase.kind]);

  const apply = useCallback(
    (state: JoinState) => {
      if (state.name) {
        setName(state.name);
        setKnown(true);
      }
      if (state.status === "accepted") {
        stopPreview();
        listenRef.current = state.listenOnly;
        setListen(state.listenOnly);
        setPhase({ kind: "room", url: state.url, token: state.token, host: state.host, listenOnly: state.listenOnly });
      } else if (state.status === "scheduled") {
        stopPreview();
        setPhase({ kind: "scheduled", startsAt: state.startsAt });
      } else if (state.status === "pending") setPhase({ kind: "waiting" });
      else if (state.status === "none") setPhase({ kind: "form" });
      else setPhase({ kind: state.status });
    },
    [stopPreview]
  );

  async function join(withCredentials: boolean) {
    setError("");
    setLoading(true);
    // Il tocco su "Entra" permette al browser di chiedere fotocamera e microfono
    // (non per chi accede prima che la chiamata inizi)
    if (phase.kind !== "scheduled" && !listenRef.current) startPreview();
    try {
      const res = await fetch(`/api/call/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // la password (se serve) va anche a chi è già riconosciuto: il server la chiede finché non si è ammessi
        body: JSON.stringify(withCredentials ? { name: username, password } : askPassword ? { password } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Errore, riprova");
      apply(data as JoinState);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore, riprova");
      stopPreview();
    }
    setLoading(false);
  }

  // Chiamata programmata: controlla se l'organizzatore l'ha avviata. Chi ha già fatto l'accesso entra da solo.
  const joinRef = useRef(join);
  useEffect(() => {
    joinRef.current = join;
  });
  useEffect(() => {
    if (phase.kind !== "scheduled") return;
    let alive = true;
    setNow(Date.now());
    const check = async () => {
      setNow(Date.now());
      const res = await fetch(`/api/call/${code}`, { cache: "no-store" }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as JoinState | null;
      if (!alive || !res?.ok || !data || data.status === "scheduled") return;
      if (data.status === "ended") apply(data);
      else if (data.name || data.status === "accepted") joinRef.current(false);
      else setPhase({ kind: "form" });
    };
    const interval = setInterval(check, 10000);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase.kind, code, apply]);

  // In sala d'attesa controlla spesso se l'organizzatore ha deciso
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    let alive = true;
    const check = async () => {
      const res = await fetch(`/api/call/${code}`, { cache: "no-store" }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as JoinState | null;
      if (alive && res?.ok && data && data.status !== "pending") apply(data);
    };
    const interval = setInterval(check, 2000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [phase.kind, code, apply]);

  // In sala d'attesa, finché non si entra, fotocamera e microfono si possono spegnere
  const toggleCam = () => {
    const t = tracks.find((x) => x.kind === Track.Kind.Video);
    if (t) (camOn ? t.mute() : t.unmute()).catch(() => {});
    camOnRef.current = !camOn;
    setCamOn(!camOn);
  };
  const toggleMic = () => {
    const t = tracks.find((x) => x.kind === Track.Kind.Audio);
    if (t) (micOn ? t.mute() : t.unmute()).catch(() => {});
    micOnRef.current = !micOn;
    setMicOn(!micOn);
  };

  // In sala d'attesa il cambio si vede subito nell'anteprima
  const changeDevice = (kind: DeviceKind, id: string) => {
    setDevices((d) => ({ ...d, [kind]: id }));
    saveDevice(kind, id);
    const t = tracksRef.current.find((x) => x.kind === (kind === "videoinput" ? Track.Kind.Video : Track.Kind.Audio));
    if (kind !== "audiooutput" && t) t.setDeviceId(id).catch(() => setPreviewError("Non riesco a usare il dispositivo scelto: provane un altro."));
  };

  const cancel = async () => {
    stopPreview();
    setPhase({ kind: "form" });
    await fetch(`/api/call/${code}`, { method: "DELETE" }).catch(() => {});
  };

  // Spostamento tra plenaria e stanze: nuovo gettone, la stanza si ricollega
  const switchRoom = useCallback(
    async (roomId: string | null, media: { camera: boolean; mic: boolean }, notice?: string) => {
      const t = await fetchRoomTicket(code, roomId);
      if ("error" in t) return t.error;
      setPhase({ kind: "room", url: t.url, token: t.token, host: t.host, listenOnly: t.listenOnly, breakout: t.room, media, notice });
    },
    [code]
  );

  const [leaveDetail, setLeaveDetail] = useState("");
  const onLeave = useCallback((reason: LeaveReason, detail?: string) => {
    setLeaveDetail(detail ?? "");
    setPhase({ kind: reason });
  }, []);

  if (phase.kind === "room") {
    return (
      <VideoRoom
        key={phase.token}
        url={phase.url}
        token={phase.token}
        initial={{
          camera: (phase.media ? phase.media.camera : camOn) && !phase.listenOnly,
          mic: (phase.media ? phase.media.mic : micOn) && !phase.listenOnly,
          devices,
        }}
        host={isHost ? host : undefined}
        link={isHost ? window.location.href : undefined}
        title={(isHost ? host.call?.title : null) ?? title}
        claimUrl={phase.breakout ? undefined : `/api/call/${code}/claim`}
        onHostChange={(h) => setPhase((ph) => (ph.kind === "room" ? { ...ph, host: h } : ph))}
        onLeave={onLeave}
        code={code}
        breakout={phase.breakout ?? null}
        onSwitchRoom={switchRoom}
        initialNotice={phase.notice}
      />
    );
  }

  const head = (
    <div className="login-hero">
      {title ? (
        <>
          <p className="subtitle">Videochiamata · {VIDEO_CONFIG.brand}</p>
          <h1 className="title call-join-title">{title}</h1>
        </>
      ) : (
        <>
          <p className="subtitle">{VIDEO_CONFIG.brand}</p>
          <h1 className="title">
            Video<span>chiamata</span>
          </h1>
        </>
      )}
    </div>
  );

  const hint = listen
    ? "🎧 Solo ascolto: vedi e ascolti gli organizzatori e puoi scrivere in chat."
    : "Si accenderanno fotocamera e microfono.";

  if (phase.kind === "form" || phase.kind === "scheduled") {
    const scheduled = phase.kind === "scheduled";
    return (
      <div className="login call-join">
        {head}
        {scheduled && (
          <div className="card call-when">
            <div className="call-when-date">📅 {phase.startsAt ? formatWhen(phase.startsAt) : "A breve"}</div>
            <div className="call-when-left">{countdown(phase.startsAt, now)}</div>
          </div>
        )}
        {known ? (
          <div className="card call-form">
            {scheduled ? (
              <p className="call-who">
                Sei pronto, <strong>{name}</strong>! Lascia aperta questa pagina: appena l&apos;organizzatore avvia la
                videochiamata entri da solo.
              </p>
            ) : (
              <>
                <p className="call-who">
                  Entri come <strong>{name}</strong>
                </p>
                {askPassword && (
                  <input
                    className="input"
                    placeholder="Password della riunione"
                    aria-label="Password della riunione"
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && join(false)}
                  />
                )}
                {error && <p className="error">{error}</p>}
                <button className="btn btn-gold" onClick={() => join(false)} disabled={loading}>
                  {loading ? "Un attimo..." : enterLabel}
                </button>
                <p className="muted call-hint">{hint}</p>
              </>
            )}
            <button
              className="call-switch"
              onClick={async () => {
                await fetch("/api/logout", { method: "POST" }).catch(() => {});
                setKnown(false);
                setError("");
              }}
            >
              Non sei tu? Entra con un altro nome
            </button>
          </div>
        ) : (
          <form
            className="card call-form"
            onSubmit={(e) => {
              e.preventDefault();
              join(true);
            }}
          >
            <p className="muted call-hint">
              {scheduled
                ? "Accedi già adesso: entrerai appena inizia."
                : askPassword
                  ? "Scrivi il tuo nome e la password della riunione."
                  : access === "waiting"
                    ? "Scrivi il tuo nome per chiedere di entrare."
                    : "Scrivi il tuo nome per entrare."}
            </p>
            <input
              className="input"
              placeholder="Il tuo nome e cognome"
              aria-label="Nome e cognome"
              autoComplete="name"
              autoCapitalize="words"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            {askPassword && (
              <input
                className="input"
                placeholder="Password della riunione"
                aria-label="Password della riunione"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            {error && <p className="error">{error}</p>}
            <button className="btn btn-gold" disabled={loading}>
              {loading ? "Un attimo..." : scheduled ? "Accedi" : enterLabel}
            </button>
            <p className="muted call-hint">{hint}</p>
          </form>
        )}
      </div>
    );
  }

  if (phase.kind === "waiting") {
    return (
      <div className="login call-join">
        {head}
        <div className="card call-form">
          {listen ? (
            <p className="call-who">🎧 Videochiamata in solo ascolto: vedrai e ascolterai gli organizzatori e potrai scrivere in chat.</p>
          ) : (
            <>
              <div className="call-preview">
                <video ref={preview} className="mirror" autoPlay playsInline muted style={videoTrack && camOn ? undefined : { display: "none" }} />
                {!(videoTrack && camOn) && <div className="call-avatar">{name.slice(0, 1).toUpperCase() || "?"}</div>}
                <div className="call-preview-controls">
                  <button className={`call-btn ${micOn ? "" : "off"}`} onClick={toggleMic} aria-label={micOn ? "Spegni microfono" : "Accendi microfono"} title={micOn ? "Spegni microfono" : "Accendi microfono"}>
                    <Icon name={micOn ? "mic" : "mic-off"} />
                  </button>
                  <button className={`call-btn ${camOn ? "" : "off"}`} onClick={toggleCam} aria-label={camOn ? "Spegni fotocamera" : "Accendi fotocamera"} title={camOn ? "Spegni fotocamera" : "Accendi fotocamera"}>
                    <Icon name={camOn ? "cam" : "cam-off"} />
                  </button>
                </div>
              </div>
              {previewError && <p className="error">{previewError}</p>}
              <button className="call-switch" onClick={() => setShowDevices(!showDevices)}>
                ⚙️ {showDevices ? "Nascondi" : "Scegli"} fotocamera, microfono e altoparlante
              </button>
              {showDevices && <DeviceSettings devices={deviceList} value={devices} onChange={changeDevice} />}
            </>
          )}
          <p className="call-wait">
            <span className="call-dots" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            In attesa che l&apos;organizzatore ti faccia entrare
          </p>
          <button className="btn btn-ghost" onClick={cancel}>
            Annulla
          </button>
        </div>
      </div>
    );
  }

  const msg = MESSAGES[phase.kind];
  return (
    <div className="standby call-join">
      <div className="standby-body">
        <div className="standby-icon" aria-hidden>
          {msg.icon}
        </div>
        <h1 className="title">{msg.title}</h1>
        <p className="call-end-text">{msg.text}</p>
        {phase.kind === "error" && leaveDetail && <p className="muted call-detail">{leaveDetail}</p>}
        {msg.retry && (
          <button className="btn btn-gold" onClick={() => join(false)} disabled={loading}>
            {loading ? "Un attimo..." : msg.retry}
          </button>
        )}
        {error && <p className="error">{error}</p>}
        {showAppLink && (
          <a className="btn btn-ghost" href={VIDEO_CONFIG.consolePath}>
            Vai alla gestione
          </a>
        )}
      </div>
    </div>
  );
}

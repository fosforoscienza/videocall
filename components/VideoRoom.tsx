"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ConnectionState,
  createLocalAudioTrack,
  DisconnectReason,
  Room,
  RoomEvent,
  ScreenSharePresets,
  Track,
  VideoPresets,
  type LocalVideoTrack,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
} from "livekit-client";
import type { HostCall } from "@/lib/useHostCall";
import ScreenBoard from "./ScreenBoard";
import AccessToggle from "./AccessToggle";
import CallChat, { CHAT_MAX, CHAT_TOPIC, type ChatMessage } from "./CallChat";
import DeviceSettings, { loadDevices, saveDevice, useDeviceList, type DeviceChoice, type DeviceKind } from "./DeviceSettings";
import { playSound } from "@/lib/sounds";
import { applyBoard, BOARD_TOPIC, COLORS, syncMessages, type BoardMsg, type Stroke, type Tool } from "@/lib/board";
import { ENTER_WITH, VIDEO_CONFIG } from "@/lib/video-config";
import Icon from "./Icons";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function screenOf(participants: Participant[]) {
  return participants
    .map((p) => ({ p, pub: p.getTrackPublication(Track.Source.ScreenShare) }))
    .find(({ pub }) => pub?.track && !pub.isMuted);
}

export type LeaveReason = "left" | "removed" | "ended" | "duplicate" | "error";

// Disposizione decisa dall'organizzatore e uguale per tutti: griglia o chi parla in grande,
// più eventualmente una persona fissata in grande
type Layout = { mode: "grid" | "speaker"; pin: string | null };
const LAYOUT_TOPIC = "layout";
const PAGER_H = 40;

const RESOLUTION = VideoPresets.h540.resolution;

function isHost(p: Participant) {
  try {
    return JSON.parse(p.metadata || "{}").host === true;
  } catch {
    return false;
  }
}

// Co-organizzatore: stessi poteri dell'organizzatore, nominato durante la chiamata
function isCohost(p: Participant) {
  try {
    return JSON.parse(p.metadata || "{}").cohost === true;
  } catch {
    return false;
  }
}

// Organizzatore "pieno" (non co-organizzatore): non può essere silenziato o tolto dagli altri
const isFullHost = (p: Participant) => isHost(p) && !isCohost(p);

// Numero di colonne che rende i riquadri più grandi possibile nello spazio disponibile
// Persone divise nelle file nel modo più uniforme possibile (es. 5 → 3 + 2, 7 → 3 + 2 + 2): nelle file con meno
// persone i riquadri si allargano fino a riempire la riga, così non restano spazi vuoti.
// La griglia ha tante colonne quante ne servono a far combaciare tutte le file (minimo comune multiplo).
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
function rowSpans(n: number, cols: number) {
  if (n <= 0) return { columns: Math.max(1, cols), spans: [] as number[] };
  const rows = Math.ceil(n / cols);
  const base = Math.floor(n / rows);
  const extra = n % rows;
  const counts = Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
  const columns = counts.reduce((l, c) => (l * c) / gcd(l, c), 1);
  return { columns, spans: counts.flatMap((c) => Array<number>(c).fill(columns / c)) };
}

function gridFor(n: number, w: number, h: number, gap: number) {
  let cols = 1;
  let best = 0;
  for (let c = 1; c <= n; c++) {
    const rows = Math.ceil(n / c);
    const size = Math.min((w - gap * (c - 1)) / c, ((h - gap * (rows - 1)) / rows) * 1.25);
    if (size > best) {
      best = size;
      cols = c;
    }
  }
  const rows = Math.ceil(n / cols);
  const rowH = Math.max(80, (h - gap * (rows - 1)) / rows);
  return { cols, rowH };
}

type TileMenu = {
  pinned: boolean;
  onPin: () => void;
  onMute?: () => void;
  onRemove?: () => void;
  onCohost?: () => void;
  isCohost?: boolean;
};

function Tile({
  p,
  mirror,
  big = false,
  pinned = false,
  menu,
  span,
}: {
  p: Participant;
  mirror: boolean;
  big?: boolean;
  pinned?: boolean;
  menu?: () => void;
  // colonne occupate nella griglia (per allargare i riquadri delle file meno piene)
  span?: number;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const pub = p.getTrackPublication(Track.Source.Camera);
  const track = pub?.track;
  const videoOn = !!track && !pub?.isMuted;
  const micOn = p.isMicrophoneEnabled;

  useEffect(() => {
    const el = video.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  const name = p.name || p.identity;
  return (
    <div
      className={`call-tile ${big ? "big" : ""} ${p.isLocal ? "local" : ""} ${p.isSpeaking && micOn ? "speaking" : ""}`}
      style={span && span > 1 ? { gridColumn: `span ${span}` } : undefined}
    >
      <video ref={video} className={mirror ? "mirror" : ""} autoPlay playsInline muted style={videoOn ? undefined : { display: "none" }} />
      {!videoOn && <div className="call-avatar">{name.slice(0, 1).toUpperCase()}</div>}
      <div className="call-name">
        {pinned && <span aria-label="Fissato">📌</span>}
        {!micOn && <span aria-label="Microfono spento">🔇</span>}
        <span className="call-name-text">{p.isLocal ? `${name} (tu)` : name}</span>
        {isHost(p) && (
          <span className="call-host-badge" title={isCohost(p) ? "Co-organizzatore" : "Organizzatore"}>
            <span className="long">{isCohost(p) ? "Co-organizzatore" : "Organizzatore"}</span>
            <span className="short">{isCohost(p) ? "☆" : "★"}</span>
          </span>
        )}
      </div>
      {/* Comandi dell'organizzatore sul riquadro (si aprono in un pannello, comodo anche sul telefono) */}
      {menu && (
        <button className="call-tile-more" onClick={menu} aria-label={`Opzioni per ${name}`}>
          ⋯
        </button>
      )}
    </div>
  );
}

function RemoteAudio({ track }: { track: RemoteTrack }) {
  const el = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = el.current;
    if (!a) return;
    track.attach(a);
    return () => {
      track.detach(a);
    };
  }, [track]);
  return <audio ref={el} autoPlay />;
}

// Stanza della videochiamata a tutto schermo. Fotocamera e microfono si accendono da soli all'ingresso.
// Con `host` mostra anche la sala d'attesa e i comandi dell'organizzatore.
export default function VideoRoom({
  url,
  token,
  initial = { camera: true, mic: true },
  host,
  link,
  title = "",
  claimUrl,
  onHostChange,
  onLeave,
}: {
  title?: string;
  // indirizzo per diventare organizzatore se quello attuale esce (solo dalla pagina del link)
  claimUrl?: string;
  // il server ha dato o tolto i poteri da organizzatore a questo partecipante
  onHostChange?: (host: boolean) => void;
  url: string;
  token: string;
  initial?: { camera: boolean; mic: boolean; devices?: DeviceChoice };
  host?: HostCall;
  link?: string;
  onLeave: (reason: LeaveReason, detail?: string) => void;
}) {
  const [room, setRoom] = useState<Room | null>(null);
  const [, setTick] = useState(0);
  const [connected, setConnected] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [canFlip, setCanFlip] = useState(false);
  const [panel, setPanel] = useState(false);
  const [copied, setCopied] = useState(false);
  // Lavagna sopra lo schermo condiviso
  const strokes = useRef<Stroke[]>([]);
  const [boardVersion, setBoardVersion] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const chatOpenRef = useRef(false);
  useLayoutEffect(() => {
    chatOpenRef.current = chatOpen;
  });
  // Disposizione: persona fissata, chi parla in grande, pagine dei riquadri
  const [layout, setLayout] = useState<Layout>({ mode: "grid", pin: null });
  // Vista scelta da ciascuno solo per sé (vuota = segue quella dell'organizzatore)
  const [myLayout, setMyLayout] = useState<Layout | null>(null);
  // Finestrella automatica cambiando scheda: attiva salvo scelta diversa (ricordata)
  const [autoPip, setAutoPip] = useState(() => {
    try {
      return localStorage.getItem("video-auto-pip") !== "0";
    } catch {
      return true;
    }
  });
  const layoutRef = useRef(layout);
  useLayoutEffect(() => {
    layoutRef.current = layout;
  });
  const [lastSpeaker, setLastSpeaker] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [viewMenu, setViewMenu] = useState(false);
  // Persona di cui l'organizzatore ha aperto il menu (⋯ sul riquadro)
  const [sheet, setSheet] = useState<string | null>(null);
  // Dispositivi: scelti dall'utente, ricordati per la prossima volta
  const [devChoice, setDevChoice] = useState<DeviceChoice>(() => ({ ...loadDevices(), ...(initial.devices ?? {}) }));
  const devChoiceRef = useRef(devChoice);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const deviceList = useDeviceList();
  // Cosa l'utente vuole acceso (serve a capire se un errore del browser è reale)
  const wantCam = useRef(initial.camera);
  const wantMic = useRef(initial.mic);
  // Finestrella sempre in primo piano (Picture-in-Picture) quando si cambia scheda
  const [pipWin, setPipWin] = useState<Window | null>(null);
  const pipWinRef = useRef<Window | null>(null);
  const pipAuto = useRef(false);
  // Chrome ha chiesto di aprire la finestrella da sola (serve a capire perché non si è aperta)
  const pipAsked = useRef(false);
  const pipHintShown = useRef(false);
  useLayoutEffect(() => {
    pipWinRef.current = pipWin;
  });
  // Telefono: i comandi secondari stanno nel menu "Altro"
  const [moreOpen, setMoreOpen] = useState(false);
  const [notice, setNotice] = useState("");
  // Vero mentre spengo io il mio microfono: se si spegne in altro modo è stato l'organizzatore
  const selfMuting = useRef(false);
  const onLeaveRef = useRef(onLeave);
  useLayoutEffect(() => {
    onLeaveRef.current = onLeave;
  });

  useEffect(() => {
    // Fotocamera, microfono e altoparlante scelti in sala d'attesa (o l'ultima volta)
    const dev = devChoiceRef.current;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: RESOLUTION, facingMode: "user", deviceId: dev.videoinput },
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, deviceId: dev.audioinput },
      audioOutput: dev.audiooutput ? { deviceId: dev.audiooutput } : undefined,
    });
    setRoom(room);
    const bump = () => setTick((t) => t + 1);
    const events = [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.ConnectionStateChanged,
      RoomEvent.AudioPlaybackStatusChanged,
      RoomEvent.ParticipantNameChanged,
      RoomEvent.ParticipantMetadataChanged,
      RoomEvent.ParticipantPermissionsChanged,
    ] as const;
    events.forEach((e) => room.on(e, bump));
    let joined = false;
    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      // Se il collegamento fallisce all'ingresso, il motivo lo dà room.connect più sotto
      if (!joined) return;
      const r: LeaveReason =
        reason === DisconnectReason.CLIENT_INITIATED
          ? "left"
          : reason === DisconnectReason.PARTICIPANT_REMOVED
            ? "removed"
            : reason === DisconnectReason.ROOM_DELETED
              ? "ended"
              : reason === DisconnectReason.DUPLICATE_IDENTITY
                ? "duplicate"
                : "error";
      onLeaveRef.current(r, r === "error" && reason !== undefined ? DisconnectReason[reason] : undefined);
    });
    // Disegni: si accettano solo quelli degli organizzatori
    room.on(RoomEvent.DataReceived, (payload: Uint8Array, from?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic === CHAT_TOPIC && from) {
        try {
          const m = JSON.parse(decoder.decode(payload)) as { id?: unknown; text?: unknown };
          if (typeof m.text !== "string" || !m.text.trim()) return;
          // Il nome viene dalla stanza (dato dal server), non dal messaggio
          const msg: ChatMessage = {
            id: `${from.identity}-${String(m.id ?? Math.random())}`,
            name: from.name || from.identity,
            text: m.text.slice(0, CHAT_MAX),
            ts: Date.now(),
            mine: false,
          };
          setMessages((ms) => [...ms, msg]);
          if (!chatOpenRef.current) {
            setUnread((n) => n + 1);
            playSound("food");
          }
        } catch {
          // messaggio non valido: ignorato
        }
        return;
      }
      if (topic === LAYOUT_TOPIC && from && isHost(from)) {
        try {
          const l = JSON.parse(decoder.decode(payload)) as Layout;
          setLayout({ mode: l.mode === "speaker" ? "speaker" : "grid", pin: typeof l.pin === "string" ? l.pin : null });
          // Nuova scelta dell'organizzatore per tutti: si torna a seguirla
          setMyLayout(null);
        } catch {
          // messaggio non valido: ignorato
        }
        return;
      }
      if (topic !== BOARD_TOPIC || !from || !isHost(from)) return;
      try {
        applyBoard(strokes.current, JSON.parse(decoder.decode(payload)) as BoardMsg);
        setBoardVersion((v) => v + 1);
      } catch {
        // messaggio non valido: ignorato
      }
    });
    // Chi parla per ultimo (serve alla vista "chi parla in grande")
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      const other = speakers.find((x) => !x.isLocal);
      if (other) setLastSpeaker(other.identity);
    });
    // Microfono spento dall'organizzatore: avviso
    room.on(RoomEvent.TrackMuted, (pub, who) => {
      if (who.isLocal && pub.source === Track.Source.Microphone && !selfMuting.current) {
        setNotice("L'organizzatore ti ha spento il microfono. Puoi riaccenderlo quando devi parlare.");
      }
    });
    // Chi entra riceve dall'organizzatore la disposizione attuale
    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      const l = layoutRef.current;
      if (!isHost(room.localParticipant) || (l.mode === "grid" && !l.pin)) return;
      room.localParticipant
        .publishData(encoder.encode(JSON.stringify(l)), { reliable: true, topic: LAYOUT_TOPIC, destinationIdentities: [p.identity] })
        .catch(() => {});
    });
    // Chi entra mentre lo schermo è condiviso riceve i disegni già fatti
    room.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      if (!room.localParticipant.isScreenShareEnabled || !strokes.current.length) return;
      for (const m of syncMessages(strokes.current)) {
        room.localParticipant
          .publishData(encoder.encode(JSON.stringify(m)), { reliable: true, topic: BOARD_TOPIC, destinationIdentities: [p.identity] })
          .catch(() => {});
      }
    });
    // Il browser a volte segnala un errore momentaneo (es. fotocamera ancora occupata per un attimo)
    // ma poi tutto parte: l'avviso compare solo se fotocamera o microfono restano davvero spenti
    let devCheck: ReturnType<typeof setTimeout> | undefined;
    const checkDevices = () => {
      clearTimeout(devCheck);
      devCheck = setTimeout(() => {
        const lp = room.localParticipant;
        const cam = wantCam.current && !lp.isCameraEnabled;
        const mic = wantMic.current && !lp.isMicrophoneEnabled;
        if (cam || mic) {
          setMediaError(
            `Non riesco ad accendere ${cam && mic ? "fotocamera e microfono" : cam ? "la fotocamera" : "il microfono"}: controlla i permessi del browser o scegli un altro dispositivo (⚙️).`
          );
        } else setMediaError((e) => (e.startsWith("Non riesco ad accendere") ? "" : e));
      }, 2000);
    };
    room.on(RoomEvent.MediaDevicesError, checkDevices);

    let cancelled = false;
    (async () => {
      try {
        await room.connect(url, token);
      } catch (e) {
        if (!cancelled) onLeaveRef.current("error", e instanceof Error ? e.message : String(e));
        return;
      }
      if (cancelled) return;
      joined = true;
      setConnected(true);
      // Fotocamera e microfono accesi in automatico (salvo scelta diversa nella sala d'attesa)
      const lp = room.localParticipant;
      if (initial.mic) await lp.setMicrophoneEnabled(true).catch(() => {});
      else if (lp.permissions?.canPublish !== false) {
        // Microfono collegato ma spento (come nelle altre app di videochiamata): Chrome apre da solo
        // la finestrella cambiando scheda solo se la pagina sta usando microfono o fotocamera
        try {
          const mic = await createLocalAudioTrack(room.options.audioCaptureDefaults);
          await mic.mute();
          if (cancelled) mic.stop();
          else await lp.publishTrack(mic);
        } catch {
          // nessun microfono o permesso negato: si entra senza
        }
      }
      await lp.setCameraEnabled(initial.camera).catch(() => {});
      if (cancelled) return;
      bump();
      checkDevices();
      const devices = await navigator.mediaDevices?.enumerateDevices().catch(() => []);
      if (!cancelled) setCanFlip((devices ?? []).filter((d) => d.kind === "videoinput").length > 1);
    })();

    // Lo schermo del telefono resta acceso durante la chiamata
    let wake: { release: () => Promise<void> } | null = null;
    const lockScreen = () => {
      if (document.visibilityState !== "visible") return;
      (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof wake> } }).wakeLock
        ?.request("screen")
        .then((w) => {
          if (cancelled) w?.release().catch(() => {});
          else wake = w;
        })
        .catch(() => {});
    };
    lockScreen();
    document.addEventListener("visibilitychange", lockScreen);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", lockScreen);
      wake?.release().catch(() => {});
      room.removeAllListeners();
      room.disconnect();
    };
    // La stanza si collega una volta sola: url, token e scelte iniziali servono solo all'ingresso
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Spazio per i riquadri (tra gli avvisi in alto e la barra dei comandi)
  const [size, setSize] = useState({ w: 360, h: 600 });
  const observer = useRef<ResizeObserver | null>(null);
  const body = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    observer.current = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.current.observe(el);
  }, []);

  // ---------- solo ascolto ----------
  // I partecipanti non possono pubblicare (permesso dato dal server): guardano, ascoltano e scrivono in chat.
  // Sul "palco" restano organizzatori, co-organizzatori e chi trasmette qualcosa; gli altri sono solo contati.
  const listening = !!room && connected && !isHost(room.localParticipant) && room.localParticipant.permissions?.canPublish === false;
  const listenMode = host ? host.listenOnly : listening;
  const lastListening = useRef<boolean | null>(null);
  useEffect(() => {
    if (!connected) return;
    if (listening && room) {
      // Spegne subito fotocamera, microfono e schermo (il server li ha già tolti dalla chiamata)
      wantCam.current = false;
      wantMic.current = false;
      setMediaError("");
      const lp = room.localParticipant;
      lp.setMicrophoneEnabled(false).catch(() => {});
      lp.setCameraEnabled(false).catch(() => {});
      lp.setScreenShareEnabled(false).catch(() => {});
    }
    if (lastListening.current !== null && lastListening.current !== listening) {
      setNotice(
        listening
          ? "🎧 Ora la videochiamata è in solo ascolto: vedi e ascolti gli organizzatori e puoi scrivere in chat."
          : "🎙️ Ora puoi accendere microfono e videocamera."
      );
    }
    lastListening.current = listening;
  }, [listening, connected, room]);

  // ---------- disposizione ----------
  const everyone: Participant[] = room && connected ? [room.localParticipant, ...room.remoteParticipants.values()] : [];
  const onStage = (p: Participant) => !listenMode || isHost(p) || p.trackPublications.size > 0;
  const all = everyone.filter(onStage);
  const audience = everyone.length - all.length;
  const screenNow = screenOf(all);
  // Vista effettiva: l'organizzatore usa (e decide) quella per tutti, gli altri possono sceglierne una propria
  const view: Layout = host ? layout : (myLayout ?? layout);
  const pinnedP = view.pin ? (all.find((p) => p.identity === view.pin) ?? null) : null;
  // "Chi parla in grande": l'ultima persona che ha parlato (non io: io mi vedo nei riquadri)
  const featuredP =
    view.mode === "speaker" && !pinnedP
      ? (all.find((p) => p.identity === lastSpeaker && !p.isLocal) ?? all.find((p) => !p.isLocal) ?? null)
      : null;
  const mainP = screenNow ? null : (pinnedP ?? featuredP);
  const hasMain = !!screenNow || !!mainP;
  const others = mainP ? all.filter((p) => p !== mainP) : all;
  const { w, h } = size;
  const landscape = w >= 700 && w > h * 1.1;
  // Quanti riquadri per pagina: tutti in griglia, oppure piccoli a lato (computer) o sotto (telefono)
  let perPage: number;
  let sideCols = 1;
  let sideTileH = 0;
  if (!hasMain) {
    // Telefono: almeno due colonne; schermo basso (orizzontale): righe più basse
    const minW = w < 700 ? 140 : 230;
    const minH = h < 450 ? 100 : w < 700 ? 110 : 150;
    perPage = Math.min(16, Math.max(1, Math.floor((w + 8) / (minW + 8)) * Math.floor((h - PAGER_H + 8) / (minH + 8))));
  } else if (landscape) {
    // Colonna a lato: una colonna di riquadri grandi se ci stanno tutti, altrimenti due colonne (schermi larghi)
    const oneColH = Math.round(220 * 0.7);
    const oneColRows = Math.max(1, Math.floor((h + 8) / (oneColH + 8)));
    if (h < 450) {
      // Telefono in orizzontale: due colonne di riquadri bassi
      sideCols = 2;
      sideTileH = 84;
    } else if (others.length <= oneColRows || w < 1000) {
      sideCols = 1;
      sideTileH = w < 1000 ? Math.round(190 * 0.7) : oneColH;
    } else {
      sideCols = 2;
      sideTileH = Math.round(150 * 0.7);
    }
    perPage = sideCols * Math.max(1, Math.floor((h - PAGER_H + 8) / (sideTileH + 8)));
  } else {
    // Fila sotto: riquadri più grandi su tablet
    const tablet = w >= 600;
    sideTileH = tablet ? 150 : 96;
    sideCols = Math.max(2, Math.floor((w + 8) / ((tablet ? 200 : 112) + 8)));
    perPage = sideCols;
  }
  const pages = Math.max(1, Math.ceil(others.length / perPage));
  const curPage = Math.min(page, pages - 1);
  const visible = others.slice(curPage * perPage, (curPage + 1) * perPage);

  // Chi parla dev'essere sempre visibile: se è in un'altra pagina, si passa a quella
  const speakingIds = room && connected ? room.activeSpeakers.filter((p) => !p.isLocal).map((p) => p.identity) : [];
  const hiddenSpeaker = speakingIds.find((id) => others.some((p) => p.identity === id) && !visible.some((p) => p.identity === id));
  const speakerPage = hiddenSpeaker ? Math.floor(others.findIndex((p) => p.identity === hiddenSpeaker) / perPage) : -1;
  useEffect(() => {
    if (speakerPage < 0) return;
    // Un attimo di attesa, per non saltare di pagina per un colpo di tosse
    const t = setTimeout(() => setPage(speakerPage), 600);
    return () => clearTimeout(t);
  }, [speakerPage, hiddenSpeaker]);

  // L'organizzatore cambia la disposizione per tutti
  const shareLayout = useCallback(
    (next: Layout) => {
      setLayout(next);
      setPage(0);
      room?.localParticipant.publishData(encoder.encode(JSON.stringify(next)), { reliable: true, topic: LAYOUT_TOPIC }).catch(() => {});
    },
    [room]
  );

  // Avviso quando l'organizzatore permette (o toglie) a tutti la condivisione dello schermo
  const shareAllowed = room && connected && !host && !listening ? (() => {
    const src = room.localParticipant.permissions?.canPublishSources ?? [];
    return src.length === 0 || src.includes(3);
  })() : null;
  const lastShareAllowed = useRef<boolean | null>(null);
  useEffect(() => {
    if (shareAllowed === null) return;
    if (lastShareAllowed.current !== null && lastShareAllowed.current !== shareAllowed) {
      setNotice(shareAllowed ? "Ora puoi condividere il tuo schermo (pulsante 🖥️, da computer)." : "La condivisione dello schermo è tornata solo all'organizzatore.");
    }
    lastShareAllowed.current = shareAllowed;
  }, [shareAllowed]);

  // Poteri da organizzatore dati o tolti durante la chiamata (co-organizzatore, o organizzatore se quello è uscito)
  const meHost = room && connected ? isHost(room.localParticipant) : null;
  const meCohost = room && connected ? isCohost(room.localParticipant) : false;
  const lastMeHost = useRef<boolean | null>(null);
  const lastMeCohost = useRef(false);
  const onHostChangeRef = useRef(onHostChange);
  useLayoutEffect(() => {
    onHostChangeRef.current = onHostChange;
  });
  useEffect(() => {
    if (meHost === null) return;
    const before = lastMeHost.current;
    if (before !== null && (before !== meHost || lastMeCohost.current !== meCohost)) {
      if (meHost && meCohost) setNotice("Sei co-organizzatore: puoi ammettere, silenziare e gestire la videochiamata.");
      else if (meHost) setNotice("L'organizzatore è uscito: ora sei tu l'organizzatore della videochiamata.");
      else setNotice("Non sei più co-organizzatore.");
    }
    if (before !== meHost) onHostChangeRef.current?.(meHost);
    lastMeHost.current = meHost;
    lastMeCohost.current = meCohost;
  }, [meHost, meCohost]);

  // Se l'organizzatore esce, tocca al co-organizzatore o, se non c'è, a chi è entrato per primo.
  // Si aspetta qualche secondo (l'organizzatore potrebbe solo aver ricaricato la pagina); decide il server.
  const fullHostHere = everyone.some(isFullHost);
  const sawHost = useRef(false);
  if (fullHostHere) sawHost.current = true;
  const cohostsHere = everyone.filter((p) => isHost(p) && isCohost(p));
  const byJoin = (list: Participant[]) =>
    [...list].sort((a, b) => (a.joinedAt?.getTime() ?? 0) - (b.joinedAt?.getTime() ?? 0) || a.identity.localeCompare(b.identity))[0];
  const heir = !fullHostHere && everyone.length ? (cohostsHere.length ? byJoin(cohostsHere) : byJoin(everyone)) : undefined;
  const iAmHeir = !!claimUrl && !!heir && heir.isLocal && sawHost.current;
  useEffect(() => {
    if (!iAmHeir || !claimUrl) return;
    const t = setTimeout(() => {
      fetch(claimUrl, { method: "POST" }).catch(() => {});
    }, 8000);
    return () => clearTimeout(t);
  }, [iAmHeir, claimUrl]);

  // Esc chiude chat, pannelli e menu (su computer)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setChatOpen(false);
      setPanel(false);
      setSheet(null);
      setViewMenu(false);
      setMoreOpen(false);
      setDevicesOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), Math.max(6000, notice.length * 70));
    return () => clearTimeout(t);
  }, [notice]);

  // Finita una condivisione, i suoi disegni spariscono
  const screenSid = room && connected ? screenOf([room.localParticipant, ...room.remoteParticipants.values()])?.pub?.trackSid : undefined;
  const lastScreen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (lastScreen.current && lastScreen.current !== screenSid) {
      strokes.current = [];
      setBoardVersion((v) => v + 1);
    }
    if (!screenSid) setDrawing(false);
    lastScreen.current = screenSid;
  }, [screenSid]);

  const sendBoard = useCallback(
    (m: BoardMsg) => {
      room?.localParticipant.publishData(encoder.encode(JSON.stringify(m)), { reliable: true, topic: BOARD_TOPIC }).catch(() => {});
    },
    [room]
  );

  // Apre la finestrella: su Chrome/Edge con video e comandi (Document Picture-in-Picture),
  // altrove (Safari) solo il video principale nella finestrella del sistema
  const openPip = useCallback(
    async (auto: boolean) => {
      if (pipWinRef.current) return;
      const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow: (o: { width: number; height: number }) => Promise<Window> } })
        .documentPictureInPicture;
      try {
        if (dpip) {
          const win = await dpip.requestWindow({ width: 360, height: 480 });
          // Stessa grafica della videochiamata: copia i fogli di stile (con indirizzo completo, per i font)
          document.querySelectorAll('link[rel="stylesheet"], style').forEach((n) => {
            if (n instanceof HTMLLinkElement) {
              const l = win.document.createElement("link");
              l.rel = "stylesheet";
              l.href = n.href;
              win.document.head.appendChild(l);
            } else win.document.head.appendChild(win.document.importNode(n, true));
          });
          win.document.documentElement.className = document.documentElement.className;
          win.document.title = title || "Videochiamata";
          win.document.body.className = "pip-body";
          pipAuto.current = auto;
          win.addEventListener("pagehide", () => setPipWin(null));
          setPipWin(win);
          return;
        }
        const v =
          document.querySelector<HTMLVideoElement>(".call-room [data-pip] video") ??
          document.querySelector<HTMLVideoElement>(".call-room .call-tile:not(.local) video") ??
          document.querySelector<HTMLVideoElement>(".call-room video");
        if (!v) return;
        if (document.pictureInPictureEnabled && v.requestPictureInPicture) await v.requestPictureInPicture();
        else (v as unknown as { webkitSetPresentationMode?: (m: string) => void }).webkitSetPresentationMode?.("picture-in-picture");
      } catch {
        // il browser non l'ha permesso: la videochiamata continua nella scheda
      }
    },
    [title]
  );

  // Cambiando scheda Chrome/Edge aprono da soli la finestrella (per le videochiamate con fotocamera o microfono attivi)
  useEffect(() => {
    if (!connected || !autoPip) return;
    const ms = navigator.mediaSession as unknown as { setActionHandler: (a: string, h: (() => void) | null) => void } | undefined;
    try {
      ms?.setActionHandler("enterpictureinpicture", () => {
        pipAsked.current = true;
        openPip(true);
      });
    } catch {
      // browser senza apertura automatica: resta il pulsante "Mini"
    }
    return () => {
      try {
        ms?.setActionHandler("enterpictureinpicture", null);
      } catch {
        // niente da togliere
      }
    };
  }, [connected, openPip, autoPip]);

  // Tornando alla scheda la finestrella aperta da sola si chiude; uscendo dalla chiamata si chiude sempre
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && pipAuto.current) pipWinRef.current?.close();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      pipWinRef.current?.close();
    };
  }, []);

  // Finestrella automatica attiva ma Chrome non l'ha aperta: al ritorno sulla scheda spiega perché (una volta)
  const pipHintRef = useRef<() => string>(() => "");
  useEffect(() => {
    if (!connected || !autoPip || !("documentPictureInPicture" in window)) return;
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        pipAsked.current = false;
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      if (away < 2000 || pipAsked.current || pipHintShown.current) return;
      pipHintShown.current = true;
      setNotice(pipHintRef.current());
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [connected, autoPip]);

  useLayoutEffect(() => {
    pipHintRef.current = () => {
      const lp = room?.localParticipant;
      const usingMedia = !!lp && (!!lp.getTrackPublication(Track.Source.Microphone)?.track || lp.isCameraEnabled);
      if (listening) return "🗗 In solo ascolto la finestrella non si apre da sola (Chrome lo fa solo per chi usa microfono o fotocamera): premi il pulsante della finestrella prima di cambiare scheda.";
      if (!usingMedia) return "🗗 La finestrella si apre da sola solo con microfono o fotocamera collegati: premi il pulsante della finestrella prima di cambiare scheda.";
      return "🗗 La finestrella non si è aperta da sola? Si apre cambiando scheda (non riducendo la finestra a icona). Se ancora non va: icona a sinistra dell'indirizzo → Impostazioni sito → \"Picture in picture automatico\" → Consenti.";
    };
  });

  const share = useCallback(async () => {
    if (!link) return;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      await nav
        .share({ title: title || "Videochiamata", text: `Entra nella videochiamata${title ? ` "${title}"` : ""} con ${ENTER_WITH}`, url: link })
        .catch(() => {});
      return;
    }
    await navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [link, title]);

  if (!room) return createPortal(<div className="call-room" />, document.body);

  const lp = room.localParticipant;
  // Nel pannello Persone ci sono tutti, anche chi è solo in ascolto
  const participants = everyone;
  const { cols, rowH } = gridFor(Math.max(1, visible.length), w, h - (pages > 1 ? PAGER_H : 0), 8);
  const mainGrid = rowSpans(visible.length, cols);
  // Riquadri piccoli a lato o sotto: stessa regola (nella fila sotto il telefono, pochi riquadri si allargano)
  const sideGrid = rowSpans(visible.length, sideCols);
  const micOn = lp.isMicrophoneEnabled;
  const camOn = lp.isCameraEnabled;
  const sharing = lp.isScreenShareEnabled;
  // Schermo condiviso (dall'organizzatore): va in grande, le persone in riquadri piccoli a lato
  const screen = screenNow;
  // Schermo: gli organizzatori sempre, gli altri se l'organizzatore l'ha permesso a tutti (permesso dato dal server)
  const sources = lp.permissions?.canPublishSources ?? [];
  const mayShare = !!host || (!listening && (sources.length === 0 || sources.includes(3 /* SCREEN_SHARE */)));
  const canShareScreen = mayShare && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
  const reconnecting = room.state === ConnectionState.Reconnecting || room.state === ConnectionState.SignalReconnecting;

  const toggleMic = async () => {
    setMediaError("");
    wantMic.current = !micOn;
    selfMuting.current = true;
    await lp.setMicrophoneEnabled(!micOn).catch(() => setMediaError("Non riesco ad accendere il microfono: controlla i permessi del browser."));
    selfMuting.current = false;
    setTick((t) => t + 1);
  };
  const toggleCam = async () => {
    setMediaError("");
    wantCam.current = !camOn;
    await lp.setCameraEnabled(!camOn).catch(() => setMediaError("Non riesco ad accendere la fotocamera: controlla i permessi del browser."));
    setTick((t) => t + 1);
  };
  const changeDevice = async (kind: DeviceKind, id: string) => {
    setDevChoice((d) => ({ ...d, [kind]: id }));
    saveDevice(kind, id);
    setMediaError("");
    const ok = await room.switchActiveDevice(kind, id).catch(() => false);
    if (!ok && kind !== "audiooutput") setMediaError("Non riesco a usare il dispositivo scelto: provane un altro.");
    setTick((t) => t + 1);
  };
  const flip = async () => {
    const t = lp.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
    if (!t) return;
    const next = facing === "user" ? "environment" : "user";
    await t.restartTrack({ facingMode: next, resolution: RESOLUTION }).then(() => setFacing(next)).catch(() => {});
  };
  const toggleScreen = async () => {
    setMediaError("");
    try {
      if (sharing) await lp.setScreenShareEnabled(false);
      else {
        await lp.setScreenShareEnabled(
          true,
          {
            // Audio della scheda, dell'app o del computer insieme al video, senza i filtri pensati per la voce
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            systemAudio: "include",
            selfBrowserSurface: "exclude",
            surfaceSwitching: "include",
            resolution: ScreenSharePresets.h1080fps30.resolution,
          },
          { screenShareEncoding: ScreenSharePresets.h1080fps30.encoding }
        );
        // Il browser condivide l'audio solo se nella sua finestra è spuntato "Condividi audio"
        if (!lp.getTrackPublication(Track.Source.ScreenShareAudio)) {
          setMediaError(
            "Stai condividendo senza audio: per l'audio scegli una scheda o lo schermo intero e spunta \"Condividi audio\" nella finestra del browser."
          );
        }
      }
    } catch (e) {
      // Annullato dalla finestra di scelta del browser: nessun errore da mostrare
      if (!(e instanceof Error && e.name === "NotAllowedError")) setMediaError("Non riesco a condividere lo schermo.");
    }
    setTick((t) => t + 1);
  };
  const leave = () => room.disconnect();

  const sendChat = (text: string) => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    lp.publishData(encoder.encode(JSON.stringify({ id, text })), { reliable: true, topic: CHAT_TOPIC }).catch(() => {});
    setMessages((ms) => [...ms, { id: `me-${id}`, name: lp.name || lp.identity, text, ts: Date.now(), mine: true }]);
  };
  const toggleChat = () => {
    setChatOpen(!chatOpen);
    setUnread(0);
  };

  const boardAction = (m: BoardMsg) => {
    applyBoard(strokes.current, m);
    sendBoard(m);
    setBoardVersion((v) => v + 1);
  };
  const undo = () => {
    const mine = strokes.current.filter((x) => x.id.startsWith(`${lp.identity}#`));
    const lastMine = mine[mine.length - 1];
    if (lastMine) boardAction({ t: "u", id: lastMine.id });
  };

  const endForAll = async () => {
    if (!host || !confirm("Terminare la videochiamata per tutti?")) return;
    await host.end();
  };

  const remoteAudio = [...room.remoteParticipants.values()].flatMap((p) =>
    [Track.Source.Microphone, Track.Source.ScreenShareAudio]
      .map((s) => p.getTrackPublication(s)?.track)
      .filter((t): t is RemoteTrack => !!t)
  );

  const pending = host?.pending ?? [];
  const firstPending = pending[0];

  // Menu dell'organizzatore su ogni riquadro: fissa in grande, spegni microfono, togli dalla chiamata
  const tileMenu = (p: Participant) => () => setSheet(p.identity);
  // Cambio di vista: dell'organizzatore per tutti, degli altri solo per sé
  const setView = (next: Layout) => {
    if (host) shareLayout(next);
    else {
      setMyLayout(next);
      setPage(0);
    }
  };
  const sheetP = sheet ? (all.find((p) => p.identity === sheet) ?? null) : null;
  const sheetActions = ((): TileMenu | null => {
    if (!sheetP) return null;
    const p = sheetP;
    const micSid = p.getTrackPublication(Track.Source.Microphone)?.trackSid;
    const other = !p.isLocal && !isFullHost(p);
    return {
      pinned: view.pin === p.identity,
      onPin: () => setView({ ...view, pin: view.pin === p.identity ? null : p.identity }),
      onCohost: host && other ? () => host.act(isCohost(p) ? "remove_cohost" : "make_cohost", p.identity) : undefined,
      isCohost: isCohost(p),
      onMute: host && other && p.isMicrophoneEnabled && micSid ? () => host.act("mute", p.identity, micSid) : undefined,
      onRemove: host && other ? () => confirm(`Togliere ${p.name || p.identity} dalla videochiamata?`) && host.act("remove", p.identity) : undefined,
    };
  })();
  const sheetDo = (fn?: () => void) => () => {
    setSheet(null);
    fn?.();
  };

  // Finestrella: Chrome/Edge (con comandi) o video nella finestrella del sistema (Safari)
  const canPip =
    typeof window !== "undefined" &&
    ("documentPictureInPicture" in window ||
      document.pictureInPictureEnabled ||
      "webkitSetPresentationMode" in HTMLVideoElement.prototype);
  // Nella finestrella: chi è in grande (o chi ha parlato per ultimo) e fino a 3 riquadri piccoli
  const pipFocus = mainP ?? all.find((p) => p.identity === lastSpeaker && !p.isLocal) ?? all.find((p) => !p.isLocal) ?? lp;
  const pipOthers = all
    .filter((p) => p !== pipFocus)
    .sort((a, b) => Number(b.isSpeaking) - Number(a.isSpeaking))
    .slice(0, 3);

  // Schermo stretto: se i comandi secondari sono più di uno vanno nel menu "Altro"
  const compact = w < 600;
  // (i dispositivi ci sono sempre)
  const secondary = [!listening && canFlip && camOn, canShareScreen, !!host && !!screen, true, canPip, true].filter(Boolean).length;
  const useMore = compact && secondary >= 2;
  const moreDo = (fn: () => void) => () => {
    setMoreOpen(false);
    fn();
  };

  const pager = pages > 1 && (
    <div className="call-pager">
      <button onClick={() => setPage(curPage - 1)} disabled={curPage === 0} aria-label="Pagina precedente">
        ‹
      </button>
      <span>
        {curPage + 1} / {pages}
      </span>
      <button onClick={() => setPage(curPage + 1)} disabled={curPage >= pages - 1} aria-label="Pagina successiva">
        ›
      </button>
    </div>
  );

  // Disegnata direttamente nella pagina (fuori dalle schede): su iPhone una finestra "fissa" dentro un'area
  // che scorre resterebbe chiusa lì dentro, con i comandi tagliati
  return createPortal(
    <div className={`call-room ${chatOpen ? "chat-open" : ""}`}>
      {!connected && <div className="call-banner">Mi collego alla videochiamata...</div>}
      {reconnecting && <div className="call-banner">Connessione instabile, riprovo...</div>}
      {mediaError && (
        <div className="call-banner call-banner-error" onClick={() => setMediaError("")}>
          {mediaError}
        </div>
      )}
      {notice && (
        <div className="call-banner" onClick={() => setNotice("")}>
          {notice}
        </div>
      )}
      {connected && !room.canPlaybackAudio && (
        <button className="call-banner call-banner-action" onClick={() => room.startAudio().catch(() => {})}>
          🔊 Tocca qui per sentire gli altri
        </button>
      )}

      {/* Qualcuno bussa: l'organizzatore lo ammette o lo rifiuta senza aprire il pannello */}
      {host && firstPending && !panel && (
        <div className="call-knock">
          <div className="call-knock-text">
            <strong>{firstPending.name}</strong> chiede di entrare
            {pending.length > 1 && <span className="muted"> (+{pending.length - 1})</span>}
          </div>
          <div className="row">
            <button className="btn btn-ghost btn-small" onClick={() => host.act("reject", firstPending.identity)}>
              Rifiuta
            </button>
            <button className="btn btn-gold btn-small" onClick={() => host.act("accept", firstPending.identity)}>
              Ammetti
            </button>
          </div>
        </div>
      )}

      {connected && listenMode && (
        <div className="call-listen">
          🎧 Solo ascolto{audience > 0 ? ` · ${audience} ${audience === 1 ? "persona" : "persone"} in ascolto` : ""}
        </div>
      )}

      <div ref={body} className="call-body">
        {connected && listenMode && !all.length ? (
          <div className="call-empty">
            <span aria-hidden>🎧</span>
            <p>Aspettiamo l&apos;organizzatore: appena entra lo vedi e lo senti qui.</p>
          </div>
        ) : hasMain ? (
          <div className={`call-stage ${landscape ? "side" : "below"}`}>
            <div className="call-stage-main" data-pip="1">
              {screen?.pub?.track ? (
                <ScreenBoard
                  track={screen.pub.track}
                  label={screen.p.isLocal ? "Stai condividendo lo schermo" : `Schermo di ${screen.p.name || screen.p.identity}`}
                  strokes={strokes}
                  version={boardVersion}
                  draw={host && drawing ? { tool, color, prefix: lp.identity } : null}
                  send={sendBoard}
                />
              ) : (
                mainP && <Tile key={mainP.identity} p={mainP} big pinned={mainP === pinnedP} mirror={mainP.isLocal && facing === "user"} menu={tileMenu(mainP)} />
              )}
              {host && drawing && (
                <div className="call-tools">
                  {(
                    [
                      ["pen", "✏️", "Penna"],
                      ["hl", "🖍️", "Evidenziatore"],
                      ["er", "🧽", "Gomma"],
                    ] as const
                  ).map(([t, icon, label]) => (
                    <button key={t} className={`call-tool ${tool === t ? "active" : ""}`} onClick={() => setTool(t)} aria-label={label} title={label}>
                      {icon}
                    </button>
                  ))}
                  <span className="call-tools-sep" />
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      className={`call-color ${color === c && tool !== "er" ? "active" : ""}`}
                      style={{ background: c }}
                      onClick={() => {
                        setColor(c);
                        if (tool === "er") setTool("pen");
                      }}
                      aria-label={`Colore ${c}`}
                    />
                  ))}
                  <span className="call-tools-sep" />
                  <button className="call-tool" onClick={undo} aria-label="Annulla l'ultimo tratto" title="Annulla">
                    ↩️
                  </button>
                  <button className="call-tool" onClick={() => boardAction({ t: "c" })} aria-label="Cancella tutto" title="Cancella tutto">
                    🗑️
                  </button>
                  <button className="call-tool" onClick={() => setDrawing(false)} aria-label="Chiudi gli strumenti" title="Fine">
                    ✓
                  </button>
                </div>
              )}
            </div>
            {others.length > 0 && (
              <div
                className="call-side-wrap"
                style={landscape ? { width: h < 450 ? 264 : sideCols === 2 ? 316 : w < 1000 ? 206 : 236 } : undefined}
              >
                <div
                  className="call-side"
                  style={{ gridTemplateColumns: `repeat(${sideGrid.columns}, minmax(0, 1fr))`, gridAutoRows: `${sideTileH}px` }}
                >
                  {visible.map((p, i) => (
                    <Tile key={p.identity} p={p} span={sideGrid.spans[i]} mirror={p.isLocal && facing === "user"} menu={tileMenu(p)} />
                  ))}
                </div>
                {pager}
              </div>
            )}
          </div>
        ) : (
          <div className="call-grid-wrap">
            <div className="call-grid" style={{ gridTemplateColumns: `repeat(${mainGrid.columns}, minmax(0, 1fr))`, gridAutoRows: `${rowH}px` }}>
              {visible.map((p, i) => (
                <Tile key={p.identity} p={p} span={mainGrid.spans[i]} mirror={p.isLocal && facing === "user"} menu={tileMenu(p)} />
              ))}
            </div>
            {pager}
          </div>
        )}
      </div>
      {remoteAudio.map((t) => (
        <RemoteAudio key={t.sid} track={t} />
      ))}

      <div className="call-bar">
        {/* Menu "Vista" fuori dalla fila dei pulsanti, così non viene tagliato quando la fila scorre */}
        {viewMenu && (
          <div className="call-view-menu" onClick={() => setViewMenu(false)}>
            <p className="muted">{host ? "Disposizione per tutti" : "La tua vista"}</p>
            <button className={view.mode === "grid" && !view.pin ? "active" : ""} onClick={() => setView({ mode: "grid", pin: null })}>
              ▦ Griglia
            </button>
            <button className={view.mode === "speaker" && !view.pin ? "active" : ""} onClick={() => setView({ mode: "speaker", pin: null })}>
              🗣️ Chi parla in grande
            </button>
            {view.pin && (
              <button onClick={() => setView({ ...view, pin: null })}>📌 Togli fissato ({pinnedP?.name || "persona uscita"})</button>
            )}
            {!host && myLayout && <button onClick={() => setMyLayout(null)}>↩️ Segui la vista dell&apos;organizzatore</button>}
            <p className="muted">Per fissare una persona{host ? "" : " solo per te"}: ⋯ sul suo riquadro.</p>
          </div>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={VIDEO_CONFIG.logo} alt={VIDEO_CONFIG.brand} className="call-logo" onError={(e) => (e.currentTarget.style.display = "none")} />
        <div className="call-controls">
          {!listening && (
            <>
              <button className={`call-btn ${micOn ? "" : "off"}`} onClick={toggleMic} disabled={!connected} aria-label={micOn ? "Spegni microfono" : "Accendi microfono"} title={micOn ? "Spegni microfono" : "Accendi microfono"}>
                <Icon name={micOn ? "mic" : "mic-off"} />
              </button>
              <button className={`call-btn ${camOn ? "" : "off"}`} onClick={toggleCam} disabled={!connected} aria-label={camOn ? "Spegni fotocamera" : "Accendi fotocamera"} title={camOn ? "Spegni fotocamera" : "Accendi fotocamera"}>
                <Icon name={camOn ? "cam" : "cam-off"} />
              </button>
            </>
          )}
          {!useMore && !listening && canFlip && camOn && (
            <button className="call-btn" onClick={flip} aria-label="Cambia fotocamera" title="Cambia fotocamera">
              <Icon name="flip" />
            </button>
          )}
          {!useMore && canShareScreen && (
            <button className={`call-btn ${sharing ? "active" : ""}`} onClick={toggleScreen} disabled={!connected} aria-label={sharing ? "Smetti di condividere lo schermo" : "Condividi lo schermo"} title={sharing ? "Smetti di condividere lo schermo" : "Condividi lo schermo"}>
              <Icon name="share" />
            </button>
          )}
          {!useMore && host && screen && (
            <button className={`call-btn ${drawing ? "active" : ""}`} onClick={() => setDrawing(!drawing)} aria-label={drawing ? "Smetti di disegnare" : "Disegna sullo schermo"} title={drawing ? "Smetti di disegnare" : "Disegna sullo schermo"}>
              <Icon name="pen" />
            </button>
          )}
          {!useMore && (
            <button className={`call-btn ${devicesOpen ? "active" : ""}`} onClick={() => setDevicesOpen(true)} aria-label="Opzioni" title="Opzioni">
              <Icon name="settings" />
            </button>
          )}
          {!useMore && canPip && (
            <button className={`call-btn ${pipWin ? "active" : ""}`} onClick={() => (pipWin ? pipWin.close() : openPip(false))} disabled={!connected} aria-label="Finestrella" title="Finestrella">
              <Icon name="pip" />
            </button>
          )}
          <button className={`call-btn ${chatOpen ? "active" : ""}`} onClick={toggleChat} disabled={!connected} aria-label={chatOpen ? "Chiudi la chat" : "Apri la chat"} title={chatOpen ? "Chiudi la chat" : "Apri la chat"}>
            <Icon name="chat" />
            {unread > 0 && <b className="call-badge">{unread}</b>}
          </button>
          {!useMore && (
            <button className={`call-btn ${viewMenu ? "active" : ""}`} onClick={() => setViewMenu(!viewMenu)} aria-label="Disposizione" title="Disposizione">
              <Icon name="layout" />
            </button>
          )}
          {host && (
            <button className="call-btn" onClick={() => setPanel(true)} aria-label="Persone" title="Persone">
              <Icon name="people" />
              {pending.length > 0 && <b className="call-badge">{pending.length}</b>}
            </button>
          )}
          {useMore && (
            <button className={`call-btn ${moreOpen ? "active" : ""}`} onClick={() => setMoreOpen(true)} aria-label="Altri comandi" title="Altri comandi">
              <Icon name="more" />
            </button>
          )}
          <button className="call-btn leave" onClick={leave} aria-label="Esci dalla videochiamata" title="Esci dalla videochiamata">
            <Icon name="leave" />
          </button>
        </div>
        <div className="call-bar-side">{title && <span className="call-title">{title}</span>}</div>
      </div>

      {devicesOpen && (
        <div className="modal-backdrop call-panel-backdrop" onClick={() => setDevicesOpen(false)}>
          <div className="card modal call-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="topbar">
              <h2 className="title">Opzioni</h2>
              <button className="call-close" onClick={() => setDevicesOpen(false)} aria-label="Chiudi">
                ✕
              </button>
            </div>
            <DeviceSettings
              kinds={listening ? ["audiooutput"] : undefined}
              devices={deviceList}
              value={{
                videoinput: room.getActiveDevice("videoinput") ?? devChoice.videoinput,
                audioinput: room.getActiveDevice("audioinput") ?? devChoice.audioinput,
                audiooutput: room.getActiveDevice("audiooutput") ?? devChoice.audiooutput,
              }}
              onChange={changeDevice}
            />
            {"documentPictureInPicture" in window && (
              <label className="call-switch-row">
                <input
                  type="checkbox"
                  checked={autoPip}
                  onChange={(e) => {
                    setAutoPip(e.target.checked);
                    try {
                      localStorage.setItem("video-auto-pip", e.target.checked ? "1" : "0");
                    } catch {
                      // memoria del browser non disponibile: vale per questa chiamata
                    }
                  }}
                />
                <span>
                  <strong>🗗 Finestrella automatica</strong>
                  <small>
                    Cambiando scheda la videochiamata resta in una finestrella sempre in primo piano. Chrome la apre da sola
                    solo se microfono o fotocamera sono collegati; la prima volta può chiedere il permesso.
                  </small>
                </span>
              </label>
            )}
            {!("documentPictureInPicture" in window) && canPip && (
              <p className="muted call-sheet-label">
                🗗 Su questo browser (Safari, iPhone, iPad) la finestrella non si apre da sola: premi il pulsante della finestrella prima di cambiare scheda o app.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Finestrella Picture-in-Picture: stessa videochiamata, in piccolo, sopra le altre finestre */}
      {pipWin &&
        createPortal(
          <div className="pip">
            <div className="pip-main">
              {screen?.pub?.track ? (
                <ScreenBoard
                  track={screen.pub.track}
                  label={screen.p.isLocal ? "Il tuo schermo" : `Schermo di ${screen.p.name || screen.p.identity}`}
                  strokes={strokes}
                  version={boardVersion}
                  draw={null}
                  send={sendBoard}
                />
              ) : (
                <Tile key={pipFocus.identity} p={pipFocus} big pinned={pipFocus === pinnedP} mirror={pipFocus.isLocal && facing === "user"} />
              )}
            </div>
            {pipOthers.length > 0 && (
              <div className="pip-strip">
                {pipOthers.map((p) => (
                  <Tile key={p.identity} p={p} mirror={p.isLocal && facing === "user"} />
                ))}
              </div>
            )}
            <div className="pip-controls">
              {!listening && (
                <>
                  <button className={`call-btn ${micOn ? "" : "off"}`} onClick={toggleMic} aria-label={micOn ? "Spegni microfono" : "Accendi microfono"} title={micOn ? "Spegni microfono" : "Accendi microfono"}>
                    <Icon name={micOn ? "mic" : "mic-off"} />
                  </button>
                  <button className={`call-btn ${camOn ? "" : "off"}`} onClick={toggleCam} aria-label={camOn ? "Spegni fotocamera" : "Accendi fotocamera"} title={camOn ? "Spegni fotocamera" : "Accendi fotocamera"}>
                    <Icon name={camOn ? "cam" : "cam-off"} />
                  </button>
                </>
              )}
              {unread > 0 && <span className="pip-unread">💬 {unread}</span>}
              {host && pending.length > 0 && <span className="pip-unread">🚪 {pending.length}</span>}
              <button className="call-btn leave" onClick={leave} aria-label="Esci dalla videochiamata" title="Esci dalla videochiamata">
                <Icon name="leave" />
              </button>
            </div>
          </div>,
          pipWin.document.body
        )}

      {chatOpen && (
        <CallChat
          messages={messages}
          onSend={sendChat}
          onClose={() => {
            setChatOpen(false);
            setUnread(0);
          }}
        />
      )}

      {useMore && moreOpen && (
        <div className="modal-backdrop call-panel-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="card modal call-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="topbar">
              <h2 className="title">Altro</h2>
              <button className="call-close" onClick={() => setMoreOpen(false)} aria-label="Chiudi">
                ✕
              </button>
            </div>
            {!listening && canFlip && camOn && (
              <button className="btn btn-ghost" onClick={moreDo(flip)}>
                🔄 Gira la fotocamera
              </button>
            )}
            <button className="btn btn-ghost" onClick={moreDo(() => setDevicesOpen(true))}>
              ⚙️ {listening ? "Opzioni: altoparlante e finestrella" : "Opzioni: dispositivi e finestrella"}
            </button>
            {canPip && (
              <button className="btn btn-ghost" onClick={moreDo(() => (pipWin ? pipWin.close() : openPip(false)))}>
                🗗 {pipWin ? "Chiudi la finestrella" : "Finestrella sempre in primo piano"}
              </button>
            )}
            {canShareScreen && (
              <button className="btn btn-ghost" onClick={moreDo(toggleScreen)}>
                🖥️ {sharing ? "Smetti di condividere lo schermo" : "Condividi lo schermo"}
              </button>
            )}
            {host && screen && (
              <button className="btn btn-ghost" onClick={moreDo(() => setDrawing(!drawing))}>
                ✏️ {drawing ? "Smetti di disegnare" : "Disegna sullo schermo"}
              </button>
            )}
            <p className="muted call-sheet-label">{host ? "Disposizione per tutti" : "La tua vista"}</p>
            <button className={`btn ${view.mode === "grid" && !view.pin ? "btn-gold" : "btn-ghost"}`} onClick={moreDo(() => setView({ mode: "grid", pin: null }))}>
              ▦ Griglia
            </button>
            <button
              className={`btn ${view.mode === "speaker" && !view.pin ? "btn-gold" : "btn-ghost"}`}
              onClick={moreDo(() => setView({ mode: "speaker", pin: null }))}
            >
              🗣️ Chi parla in grande
            </button>
            {view.pin && (
              <button className="btn btn-ghost" onClick={moreDo(() => setView({ ...view, pin: null }))}>
                📌 Togli fissato ({pinnedP?.name || "persona uscita"})
              </button>
            )}
            {!host && myLayout && (
              <button className="btn btn-ghost" onClick={moreDo(() => setMyLayout(null))}>
                ↩️ Segui la vista dell&apos;organizzatore
              </button>
            )}
            <p className="muted call-sheet-label">Per fissare una persona{host ? "" : " solo per te"}: ⋯ sul suo riquadro.</p>
          </div>
        </div>
      )}

      {sheetP && sheetActions && (
        <div className="modal-backdrop call-panel-backdrop" onClick={() => setSheet(null)}>
          <div className="card modal call-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="topbar">
              <h2 className="title">{sheetP.name || sheetP.identity}</h2>
              <button className="call-close" onClick={() => setSheet(null)} aria-label="Chiudi">
                ✕
              </button>
            </div>
            <button className="btn btn-gold" onClick={sheetDo(sheetActions.onPin)}>
              {sheetActions.pinned ? "📌 Togli fissato" : host ? "📌 Fissa in grande per tutti" : "📌 Fissa in grande (solo per te)"}
            </button>
            {sheetActions.onCohost && (
              <button className="btn btn-ghost" onClick={sheetDo(sheetActions.onCohost)}>
                {sheetActions.isCohost ? "☆ Togli co-organizzatore" : "☆ Rendi co-organizzatore"}
              </button>
            )}
            {sheetActions.onMute && (
              <button className="btn btn-ghost" onClick={sheetDo(sheetActions.onMute)}>
                🔇 Spegni microfono
              </button>
            )}
            {sheetActions.onRemove && (
              <button className="btn btn-danger" onClick={sheetDo(sheetActions.onRemove)}>
                🚪 Togli dalla chiamata
              </button>
            )}
          </div>
        </div>
      )}

      {host && panel && (
        <div className="modal-backdrop call-panel-backdrop" onClick={() => setPanel(false)}>
          <div className="card modal call-panel" onClick={(e) => e.stopPropagation()}>
            <div className="topbar">
              <h2 className="title">Persone</h2>
              <button className="call-close" onClick={() => setPanel(false)} aria-label="Chiudi">
                ✕
              </button>
            </div>

            <AccessToggle host={host} />

            <section className="section">
              <div className="row call-panel-head">
                <h3>In attesa ({pending.length})</h3>
                {pending.length > 1 && (
                  <button className="btn btn-gold btn-small" onClick={() => host.act("accept_all")}>
                    Ammetti tutti
                  </button>
                )}
              </div>
              {pending.length === 0 && <p className="muted" style={{ margin: 0 }}>Nessuno in sala d&apos;attesa.</p>}
              {pending.map((r) => (
                <div key={r.identity} className="list-row">
                  <span className="call-person">{r.name}</span>
                  <div className="row">
                    <button className="btn btn-ghost btn-small" onClick={() => host.act("reject", r.identity)}>
                      Rifiuta
                    </button>
                    <button className="btn btn-gold btn-small" onClick={() => host.act("accept", r.identity)}>
                      Ammetti
                    </button>
                  </div>
                </div>
              ))}
            </section>

            <section className="section">
              <div className="row call-panel-head">
                <h3>Nella chiamata ({participants.length})</h3>
                {participants.some((p) => !p.isLocal && !isHost(p) && p.isMicrophoneEnabled) && (
                  <button className="btn btn-ghost btn-small" onClick={() => host.act("mute_all")}>
                    🔇 Silenzia tutti
                  </button>
                )}
              </div>
              {participants.map((p) => {
                const mic = p.getTrackPublication(Track.Source.Microphone);
                return (
                  <div key={p.identity} className="list-row">
                    <span className="call-person">
                      {listenMode && !onStage(p) ? "🎧" : p.isMicrophoneEnabled ? "🎙️" : "🔇"} {p.name || p.identity}
                      {p.isLocal ? " (tu)" : isCohost(p) ? " · co-organizzatore" : isHost(p) ? " · organizzatore" : ""}
                    </span>
                    {!p.isLocal && !isFullHost(p) && (
                      <div className="row">
                        <button
                          className="btn btn-ghost btn-small"
                          onClick={() => host.act(isCohost(p) ? "remove_cohost" : "make_cohost", p.identity)}
                          title={isCohost(p) ? "Togli co-organizzatore" : "Rendi co-organizzatore"}
                        >
                          {isCohost(p) ? "Togli co-org." : "Co-org."}
                        </button>
                        {p.isMicrophoneEnabled && mic?.trackSid && (
                          <button className="btn btn-ghost btn-small" onClick={() => host.act("mute", p.identity, mic.trackSid)}>
                            Silenzia
                          </button>
                        )}
                        <button
                          className="btn btn-danger btn-small"
                          onClick={() => confirm(`Togliere ${p.name || p.identity} dalla videochiamata?`) && host.act("remove", p.identity)}
                        >
                          Rimuovi
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>

            {host.error && <p className="error">{host.error}</p>}
            {link && (
              <button className="btn btn-ghost" onClick={share}>
                {copied ? "Link copiato!" : "Condividi il link"}
              </button>
            )}
            <button className="btn btn-danger" onClick={endForAll} disabled={host.busy}>
              Termina per tutti
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import {
  applyWb,
  drawStrokes,
  exportBoard,
  noteMsg,
  NOTE_COLORS,
  NOTE_MAX,
  NOTE_MAX_X,
  NOTE_MAX_Y,
  NOTE_SIZE,
  PEN_COLORS,
  SIZES,
  WB_RATIO,
  WB_SCALE,
  type WbMode,
  type WbMsg,
  type WbNote,
  type WbState,
  type WbTool,
} from "@/lib/whiteboard";

const COLOR_NAMES: Record<string, string> = {
  "#111111": "nero",
  "#e5383b": "rosso",
  "#0077b6": "blu",
  "#2fbf71": "verde",
  "#f77f00": "arancione",
  "#8e44ad": "viola",
  "#fff27a": "giallo",
  "#ffb3c7": "rosa",
  "#b8f2a6": "verde",
  "#a9dcff": "azzurro",
  "#ffc98a": "arancione",
};
const SIZE_NAMES = ["fine", "medio", "grosso", "molto grosso"];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Lavagna a tutta area: foglio bianco 16:9 con tratti e post-it. Chi può scrivere (gli organizzatori,
// o tutti se l'organizzatore l'ha permesso) ha la barra degli strumenti; gli altri vedono tutto in tempo reale.
export default function Whiteboard({
  board,
  version,
  me,
  canWrite,
  manage,
  mini = false,
  send,
  onLocal,
  onMode,
  onClose,
}: {
  board: MutableRefObject<WbState>;
  version: number;
  // identità di chi usa la lavagna (prefisso dei tratti e dei post-it)
  me: string;
  canWrite: boolean;
  // organizzatori: chi può scrivere, cancella tutto, chiudi
  manage: boolean;
  // finestrella: solo il foglio, senza comandi
  mini?: boolean;
  send: (m: WbMsg) => void;
  // modifica fatta qui da mostrare anche nel resto della videochiamata (es. nella finestrella)
  onLocal: () => void;
  onMode: (mode: WbMode) => void;
  onClose: () => void;
}) {
  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState({ w: 0, h: 0 });
  const [tool, setTool] = useState<WbTool>("pen");
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [size, setSize] = useState(1);
  const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);
  // ultimo strumento da disegno, per tornarci dopo aver attaccato un post-it
  const lastDraw = useRef<WbTool>("pen");
  const [, setLocal] = useState(0);
  const rerender = () => setLocal((n) => n + 1);
  const [focusNote, setFocusNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = useRef<{ id: string; buffer: number[]; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const counter = useRef(0);
  const noteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const drag = useRef<{ id: string; sx: number; sy: number; x: number; y: number; last: number } | null>(null);

  const newId = () => `${me}#${Date.now().toString(36)}${counter.current++}`;

  const redraw = useCallback(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    drawStrokes(ctx, board.current.strokes, c.width, c.height);
  }, [board]);

  // Il foglio (16:9) occupa tutto lo spazio possibile
  useEffect(() => {
    const a = area.current;
    if (!a) return;
    const fit = () => {
      const W = a.clientWidth;
      const H = a.clientHeight;
      const w = Math.max(1, Math.floor(Math.min(W, H * WB_RATIO)));
      setPage({ w, h: Math.max(1, Math.floor(w / WB_RATIO)) });
    };
    const ro = new ResizeObserver(fit);
    ro.observe(a);
    fit();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !page.w) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(page.w * dpr);
    c.height = Math.round(page.h * dpr);
    redraw();
  }, [page, redraw]);

  // Tratti arrivati dagli altri, annulla, cancella tutto
  useEffect(() => {
    redraw();
  }, [version, redraw]);

  // Testi dei post-it ancora da mandare: partono subito se la lavagna si chiude
  const sendRef = useRef(send);
  useLayoutEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    const timers = noteTimers.current;
    return () => {
      timers.forEach((t, id) => {
        clearTimeout(t);
        const n = board.current.notes.find((x) => x.id === id);
        if (n) sendRef.current(noteMsg(n));
      });
      timers.clear();
    };
  }, [board]);

  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * WB_SCALE);
    const y = Math.round(((e.clientY - r.top) / r.height) * WB_SCALE);
    return [clamp(x, 0, WB_SCALE), clamp(y, 0, WB_SCALE)];
  };

  const act = (m: WbMsg) => {
    applyWb(board.current, m);
    send(m);
    redraw();
    onLocal();
  };

  // ---------- tratti ----------
  const flush = () => {
    const cur = current.current;
    if (!cur) return;
    if (cur.timer) clearTimeout(cur.timer);
    cur.timer = null;
    if (cur.buffer.length) send({ t: "p", id: cur.id, p: cur.buffer });
    cur.buffer = [];
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!canWrite || e.button > 0) return;
    e.preventDefault();
    const [x, y] = point(e);
    if (tool === "note") {
      // Post-it centrato dove si tocca
      const half = (NOTE_SIZE * WB_SCALE) / 2;
      const id = newId();
      act({
        t: "n",
        id,
        x: clamp(Math.round(x - half), 0, NOTE_MAX_X),
        y: clamp(Math.round(y - half * WB_RATIO), 0, NOTE_MAX_Y),
        c: noteColor,
        text: "",
      });
      board.current.mine.push(id);
      setFocusNote(id);
      setTool(lastDraw.current);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const id = newId();
    const m: WbMsg = { t: "s", id, k: tool, c: color, w: SIZES[size], p: [x, y] };
    applyWb(board.current, m);
    board.current.mine.push(id);
    send(m);
    current.current = { id, buffer: [], timer: null };
    redraw();
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cur = current.current;
    if (!cur) return;
    const p = point(e);
    applyWb(board.current, { t: "p", id: cur.id, p });
    cur.buffer.push(...p);
    // I punti partono a gruppi, per non intasare il canale
    if (!cur.timer) cur.timer = setTimeout(flush, 40);
    redraw();
  };

  const up = () => {
    if (!current.current) return;
    flush();
    current.current = null;
    onLocal();
  };

  // ---------- post-it ----------
  const updateNote = (n: WbNote, now: boolean) => {
    applyWb(board.current, noteMsg(n));
    rerender();
    const timers = noteTimers.current;
    clearTimeout(timers.get(n.id));
    timers.delete(n.id);
    if (now) {
      send(noteMsg(n));
      onLocal();
      return;
    }
    // Il testo parte dopo una breve pausa (non a ogni lettera)
    timers.set(
      n.id,
      setTimeout(() => {
        timers.delete(n.id);
        const latest = board.current.notes.find((x) => x.id === n.id);
        if (latest) send(noteMsg(latest));
        onLocal();
      }, 300)
    );
  };

  const dragStart = (e: React.PointerEvent<HTMLDivElement>, n: WbNote) => {
    if (!canWrite || e.button > 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, x: n.x, y: n.y, last: 0 };
  };
  const dragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const n = d && board.current.notes.find((x) => x.id === d.id);
    if (!d || !n || !page.w) return;
    const x = clamp(Math.round(d.x + ((e.clientX - d.sx) / page.w) * WB_SCALE), 0, NOTE_MAX_X);
    const y = clamp(Math.round(d.y + ((e.clientY - d.sy) / page.h) * WB_SCALE), 0, NOTE_MAX_Y);
    const moved = { ...n, x, y };
    applyWb(board.current, noteMsg(moved));
    rerender();
    // Durante lo spostamento la posizione parte al massimo ogni 50 ms
    const t = Date.now();
    if (t - d.last > 50) {
      d.last = t;
      send(noteMsg(moved));
    }
  };
  const dragEnd = () => {
    const d = drag.current;
    drag.current = null;
    const n = d && board.current.notes.find((x) => x.id === d.id);
    if (n) updateNote(n, true);
  };

  const removeNote = (id: string) => {
    clearTimeout(noteTimers.current.get(id));
    noteTimers.current.delete(id);
    act({ t: "nd", id });
  };

  // ---------- comandi ----------
  const undo = () => {
    const b = board.current;
    while (b.mine.length) {
      const id = b.mine.pop()!;
      if (b.strokes.some((s) => s.id === id)) return act({ t: "u", id });
      if (b.notes.some((n) => n.id === id)) return removeNote(id);
    }
  };

  const clearAll = () => {
    if (!confirm("Cancellare tutta la lavagna (tratti e post-it) per tutti?")) return;
    act({ t: "c" });
  };

  const save = async () => {
    setSaving(true);
    const blob = await exportBoard(board.current).catch(() => null);
    setSaving(false);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    a.href = url;
    a.download = `lavagna-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const pickTool = (t: WbTool) => {
    if (t !== "note") lastDraw.current = t;
    setTool(t);
  };

  const { notes, mode } = board.current;
  const side = NOTE_SIZE * page.w;
  const showTools = canWrite && !mini;

  return (
    <div className={`call-wb ${mini ? "mini" : ""}`}>
      {showTools && (
        <div className="call-wb-tools" role="toolbar" aria-label="Strumenti della lavagna">
          {(
            [
              ["pen", "✏️", "Pennarello"],
              ["hl", "🖍️", "Evidenziatore"],
              ["er", "🧽", "Gomma"],
              ["note", "🗒️", "Post-it: tocca il foglio per attaccarlo"],
            ] as const
          ).map(([t, icon, label]) => (
            <button key={t} className={`call-tool ${tool === t ? "active" : ""}`} onClick={() => pickTool(t)} aria-label={label} title={label}>
              {icon}
            </button>
          ))}
          <span className="call-tools-sep" />
          {tool === "note"
            ? NOTE_COLORS.map((c) => (
                <button
                  key={c}
                  className={`call-color square ${noteColor === c ? "active" : ""}`}
                  style={{ background: c }}
                  onClick={() => setNoteColor(c)}
                  aria-label={`Post-it ${COLOR_NAMES[c] ?? c}`}
                  title={`Post-it ${COLOR_NAMES[c] ?? c}`}
                />
              ))
            : PEN_COLORS.map((c) => (
                <button
                  key={c}
                  className={`call-color ${color === c && tool !== "er" ? "active" : ""}`}
                  style={{ background: c }}
                  onClick={() => {
                    setColor(c);
                    if (tool === "er") pickTool("pen");
                  }}
                  aria-label={`Colore ${COLOR_NAMES[c] ?? c}`}
                  title={`Colore ${COLOR_NAMES[c] ?? c}`}
                />
              ))}
          {tool !== "note" && (
            <>
              <span className="call-tools-sep" />
              {SIZES.map((s, i) => (
                <button
                  key={s}
                  className={`call-tool call-size ${size === i ? "active" : ""}`}
                  onClick={() => setSize(i)}
                  aria-label={`Spessore ${SIZE_NAMES[i]}`}
                  title={`Spessore ${SIZE_NAMES[i]}`}
                >
                  <span style={{ width: 4 + i * 4, height: 4 + i * 4, background: tool === "er" ? undefined : color }} />
                </button>
              ))}
            </>
          )}
          <span className="call-tools-sep" />
          <button className="call-tool" onClick={undo} aria-label="Annulla l'ultima cosa che hai fatto" title="Annulla">
            ↩️
          </button>
          <button className="call-tool" onClick={save} disabled={saving} aria-label="Salva la lavagna come immagine" title="Salva come immagine">
            💾
          </button>
          {manage && (
            <>
              <button className="call-tool" onClick={clearAll} aria-label="Cancella tutta la lavagna" title="Cancella tutto">
                🗑️
              </button>
              <span className="call-tools-sep" />
              <button
                className="call-tool call-wb-mode"
                onClick={() => onMode(mode === "all" ? "hosts" : "all")}
                aria-label={mode === "all" ? "Scrivono tutti: tocca per lasciarla solo agli organizzatori" : "Scrivono solo gli organizzatori: tocca per aprirla a tutti"}
                title={mode === "all" ? "Scrivono tutti: tocca per lasciarla solo agli organizzatori" : "Scrivono solo gli organizzatori: tocca per aprirla a tutti"}
              >
                {mode === "all" ? "👥 Tutti" : "★ Solo org."}
              </button>
              <button className="call-tool" onClick={onClose} aria-label="Chiudi la lavagna per tutti" title="Chiudi la lavagna">
                ✕
              </button>
            </>
          )}
        </div>
      )}
      <div ref={area} className="call-wb-area">
        <div className="call-wb-page" style={{ width: page.w, height: page.h }}>
          <canvas
            ref={canvas}
            className={`call-wb-ink ${canWrite && !mini ? `drawing tool-${tool}` : ""}`}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
          />
          {/* Ordine fisso nella pagina (spostare un elemento nella pagina gli toglie il cursore mentre si scrive):
              chi sta sopra lo decide z-index */}
          {[...notes].sort((a, b) => (a.id < b.id ? -1 : 1)).map((n) => (
            <div
              key={n.id}
              className="call-wb-note"
              style={{
                zIndex: notes.indexOf(n) + 1,
                left: `${(n.x / WB_SCALE) * 100}%`,
                top: `${(n.y / WB_SCALE) * 100}%`,
                width: side,
                height: side,
                background: n.color,
                fontSize: Math.max(7, side * 0.11),
              }}
            >
              {canWrite && !mini && (
                <div className="call-wb-note-bar" onPointerDown={(e) => dragStart(e, n)} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd} title="Trascina per spostare">
                  <button onClick={() => removeNote(n.id)} aria-label="Togli il post-it" title="Togli il post-it">
                    ✕
                  </button>
                </div>
              )}
              {canWrite && !mini ? (
                <textarea
                  value={n.text}
                  maxLength={NOTE_MAX}
                  placeholder="Scrivi qui..."
                  autoFocus={focusNote === n.id}
                  onFocus={() => focusNote === n.id && setFocusNote(null)}
                  onChange={(e) => updateNote({ ...n, text: e.target.value.slice(0, NOTE_MAX) }, false)}
                  onBlur={() => {
                    // il testo rimasto in attesa parte subito
                    if (noteTimers.current.has(n.id)) {
                      const latest = board.current.notes.find((x) => x.id === n.id);
                      if (latest) updateNote(latest, true);
                    }
                  }}
                  aria-label="Testo del post-it"
                />
              ) : (
                <div className="call-wb-note-text">{n.text}</div>
              )}
            </div>
          ))}
        </div>
      </div>
      {!mini && (
        <div className="call-wb-foot">
          <span className="call-wb-label">
            🧑‍🏫 Lavagna · {mode === "all" ? "scrivono tutti" : "scrivono solo gli organizzatori"}
          </span>
          {!showTools && (
            <button className="btn btn-ghost btn-small" onClick={save} disabled={saving} title="Salva la lavagna come immagine">
              💾 Salva
            </button>
          )}
        </div>
      )}
    </div>
  );
}

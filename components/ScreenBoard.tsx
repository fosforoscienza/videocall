"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { Track } from "livekit-client";
import { applyBoard, drawBoard, SCALE, type BoardMsg, type Stroke, type Tool } from "@/lib/board";

// Schermo condiviso a tutta area, con sopra i disegni. Chi può disegnare (l'organizzatore, con "Disegna"
// attivo) traccia con il dito o il mouse; gli altri vedono gli stessi tratti in tempo reale.
export default function ScreenBoard({
  track,
  label,
  strokes,
  version,
  draw,
  send,
}: {
  track: Track;
  label: string;
  strokes: MutableRefObject<Stroke[]>;
  version: number;
  draw: { tool: Tool; color: string; prefix: string } | null;
  send: (m: BoardMsg) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef<{ id: string; buffer: number[]; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const counter = useRef(0);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  const redraw = useCallback(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    drawBoard(ctx, strokes.current, c.width, c.height);
  }, [strokes]);

  // La tela copre esattamente l'immagine condivisa (senza le bande nere ai lati)
  const layout = useCallback(() => {
    const b = box.current;
    const v = video.current;
    const c = canvas.current;
    if (!b || !v || !c) return;
    const W = b.clientWidth;
    const H = b.clientHeight;
    const vw = v.videoWidth || 16;
    const vh = v.videoHeight || 9;
    const scale = Math.min(W / vw, H / vh);
    const cw = vw * scale;
    const ch = vh * scale;
    c.style.left = `${(W - cw) / 2}px`;
    c.style.top = `${(H - ch) / 2}px`;
    c.style.width = `${cw}px`;
    c.style.height = `${ch}px`;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(cw * dpr);
    c.height = Math.round(ch * dpr);
    redraw();
  }, [redraw]);

  useEffect(() => {
    const b = box.current;
    const v = video.current;
    if (!b || !v) return;
    const ro = new ResizeObserver(layout);
    ro.observe(b);
    v.addEventListener("resize", layout);
    v.addEventListener("loadedmetadata", layout);
    layout();
    return () => {
      ro.disconnect();
      v.removeEventListener("resize", layout);
      v.removeEventListener("loadedmetadata", layout);
    };
  }, [layout]);

  // Tratti arrivati dagli altri o annulla/cancella dalla barra degli strumenti
  useEffect(() => {
    redraw();
  }, [version, redraw]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * SCALE);
    const y = Math.round(((e.clientY - r.top) / r.height) * SCALE);
    return [Math.max(0, Math.min(SCALE, x)), Math.max(0, Math.min(SCALE, y))];
  };

  const flush = () => {
    const cur = current.current;
    if (!cur) return;
    if (cur.timer) clearTimeout(cur.timer);
    cur.timer = null;
    if (cur.buffer.length) send({ t: "p", id: cur.id, p: cur.buffer });
    cur.buffer = [];
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draw) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const id = `${draw.prefix}#${Date.now().toString(36)}${counter.current++}`;
    const m: BoardMsg = { t: "s", id, tool: draw.tool, c: draw.color, p: point(e) };
    applyBoard(strokes.current, m);
    send(m);
    current.current = { id, buffer: [], timer: null };
    redraw();
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cur = current.current;
    if (!cur) return;
    const p = point(e);
    applyBoard(strokes.current, { t: "p", id: cur.id, p });
    cur.buffer.push(...p);
    // I punti partono a gruppi, per non intasare il canale
    if (!cur.timer) cur.timer = setTimeout(flush, 40);
    redraw();
  };

  const up = () => {
    flush();
    current.current = null;
  };

  return (
    <div ref={box} className="call-screen">
      <video ref={video} autoPlay playsInline muted />
      <canvas
        ref={canvas}
        className={`call-board ${draw ? `drawing tool-${draw.tool}` : ""}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      <div className="call-name">
        <span className="call-name-text">🖥️ {label}</span>
      </div>
    </div>
  );
}

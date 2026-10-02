"use client";

// Due piccoli suoni generati con Web Audio (nessun file): qualcuno bussa, nuovo messaggio in chat.
// I browser suonano solo dopo un tocco sulla pagina: il primo tocco sblocca l'audio.

let ctx: AudioContext | null = null;

function getCtx() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

if (typeof document !== "undefined") {
  const unlock = () => {
    const c = getCtx();
    if (c && c.state !== "running") c.resume().catch(() => {});
  };
  document.addEventListener("pointerdown", unlock, true);
  document.addEventListener("keydown", unlock, true);
}

function bell(c: AudioContext, freq: number, at: number, volume = 0.25, length = 0.9) {
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(volume, at + 0.008);
  out.gain.exponentialRampToValueAtTime(0.0001, at + length);
  out.connect(c.destination);
  for (const [ratio, amp] of [
    [1, 1],
    [2, 0.5],
    [2.76, 0.35],
  ]) {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.frequency.setValueAtTime(freq * ratio, at);
    g.gain.value = amp;
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }
}

// "gain" = qualcuno chiede di entrare, "food" = nuovo messaggio in chat
export function playSound(kind: "gain" | "food") {
  const c = getCtx();
  if (!c || c.state !== "running") return;
  const t = c.currentTime + 0.02;
  if (kind === "gain") {
    bell(c, 1318.5, t);
    bell(c, 1568, t + 0.1);
    bell(c, 2093, t + 0.2, 0.3, 1.4);
  } else {
    bell(c, 1046.5, t, 0.22, 0.8);
    bell(c, 1318.5, t + 0.12, 0.22, 0.8);
  }
}

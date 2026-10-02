// Disegni dell'organizzatore sopra lo schermo condiviso (penna, evidenziatore, gomma).
// I tratti viaggiano sul canale dati della videochiamata: ogni partecipante li ridisegna sopra il video.
// Le coordinate sono in decimillesimi (0…10000) dell'immagine condivisa, così combaciano su ogni schermo.

export type Tool = "pen" | "hl" | "er";

export type Stroke = { id: string; tool: Tool; color: string; points: number[] };

export type BoardMsg =
  | { t: "s"; id: string; tool: Tool; c: string; p: number[] } // nuovo tratto
  | { t: "p"; id: string; p: number[] } // punti aggiunti a un tratto
  | { t: "u"; id: string } // annulla un tratto
  | { t: "c" }; // cancella tutto

export const BOARD_TOPIC = "board";
export const SCALE = 10000;
// Tratti lunghi divisi in più messaggi (il canale dati ha un limite di dimensione)
const CHUNK = 1200;

export const COLORS = ["#e5383b", "#ffd23f", "#2fbf71", "#3a86ff", "#ffffff", "#111111"];

export function applyBoard(strokes: Stroke[], m: BoardMsg) {
  if (m.t === "c") strokes.length = 0;
  else if (m.t === "s") strokes.push({ id: m.id, tool: m.tool, color: m.c, points: [...m.p] });
  else if (m.t === "p") strokes.find((s) => s.id === m.id)?.points.push(...m.p);
  else if (m.t === "u") {
    const i = strokes.findIndex((s) => s.id === m.id);
    if (i !== -1) strokes.splice(i, 1);
  }
}

// Messaggi per ricostruire tutti i disegni (per chi entra mentre lo schermo è già condiviso)
export function syncMessages(strokes: Stroke[]): BoardMsg[] {
  const out: BoardMsg[] = [{ t: "c" }];
  for (const s of strokes) {
    out.push({ t: "s", id: s.id, tool: s.tool, c: s.color, p: s.points.slice(0, CHUNK) });
    for (let i = CHUNK; i < s.points.length; i += CHUNK) out.push({ t: "p", id: s.id, p: s.points.slice(i, i + CHUNK) });
  }
  return out;
}

export function lineWidth(tool: Tool, width: number) {
  if (tool === "hl") return Math.max(10, width * 0.018);
  if (tool === "er") return Math.max(16, width * 0.03);
  return Math.max(2, width * 0.0035);
}

export function drawBoard(ctx: CanvasRenderingContext2D, strokes: Stroke[], w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  for (const s of strokes) {
    const pts = s.points;
    if (pts.length < 2) continue;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = lineWidth(s.tool, w);
    if (s.tool === "er") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "#000";
    } else {
      ctx.strokeStyle = s.color;
      if (s.tool === "hl") ctx.globalAlpha = 0.35;
    }
    ctx.beginPath();
    ctx.moveTo((pts[0] / SCALE) * w, (pts[1] / SCALE) * h);
    // Un solo punto: un pallino
    if (pts.length === 2) ctx.lineTo((pts[0] / SCALE) * w + 0.1, (pts[1] / SCALE) * h);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo((pts[i] / SCALE) * w, (pts[i + 1] / SCALE) * h);
    ctx.stroke();
    ctx.restore();
  }
}

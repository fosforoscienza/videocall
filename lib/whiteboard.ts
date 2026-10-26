// Lavagna virtuale: un foglio bianco condiviso, aperto dall'organizzatore, su cui si scrive con pennarelli
// (colori e spessori diversi), evidenziatore e gomma e si attaccano post-it colorati.
// L'organizzatore sceglie chi può scriverci: tutti i partecipanti o solo organizzatori e co-organizzatori.
// Tutto viaggia sul canale dati della videochiamata; chi entra dopo riceve la lavagna da un organizzatore.
// Coordinate in decimillesimi (0…10000) della larghezza e dell'altezza del foglio, così combaciano su ogni schermo.

export type WbTool = "pen" | "hl" | "er" | "note";
export type WbMode = "all" | "hosts";

export type WbStroke = { id: string; tool: "pen" | "hl" | "er"; color: string; size: number; points: number[] };
export type WbNote = { id: string; x: number; y: number; color: string; text: string };

export type WbState = {
  open: boolean;
  mode: WbMode;
  strokes: WbStroke[];
  // in ordine di sovrapposizione: l'ultimo sta sopra
  notes: WbNote[];
  // tratti e post-it creati da me, per "Annulla"
  mine: string[];
};

export type WbMsg =
  | { t: "o"; open: boolean; mode: WbMode } // lavagna aperta o chiusa, chi può scrivere
  | { t: "s"; id: string; k: WbStroke["tool"]; c: string; w: number; p: number[] } // nuovo tratto
  | { t: "p"; id: string; p: number[] } // punti aggiunti a un tratto
  | { t: "u"; id: string } // tratto tolto (annulla)
  | { t: "n"; id: string; x: number; y: number; c: string; text: string } // post-it nuovo o modificato
  | { t: "nd"; id: string } // post-it tolto
  | { t: "c" }; // cancella tutto

export const WB_TOPIC = "whiteboard";
export const WB_SCALE = 10000;
// Foglio in 16:9, come uno schermo condiviso
export const WB_RATIO = 16 / 9;
// Tratti lunghi divisi in più messaggi (il canale dati ha un limite di dimensione)
const CHUNK = 1200;
export const NOTE_MAX = 280;
// Lato del post-it, in frazione della larghezza del foglio
export const NOTE_SIZE = 0.15;
// Posizione massima dell'angolo in alto a sinistra, perché il post-it resti tutto sul foglio
export const NOTE_MAX_X = Math.round(WB_SCALE * (1 - NOTE_SIZE));
export const NOTE_MAX_Y = Math.round(WB_SCALE * (1 - NOTE_SIZE * WB_RATIO));

export const PEN_COLORS = ["#111111", "#e5383b", "#0077b6", "#2fbf71", "#f77f00", "#8e44ad"];
export const NOTE_COLORS = ["#fff27a", "#ffb3c7", "#b8f2a6", "#a9dcff", "#ffc98a"];
// Spessori in millesimi della larghezza del foglio: fine, medio, grosso, molto grosso
export const SIZES = [2, 4, 8, 16];

export const emptyBoard = (): WbState => ({ open: false, mode: "hosts", strokes: [], notes: [], mine: [] });

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const isColor = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);
const isId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 120;
function points(p: unknown) {
  if (!Array.isArray(p)) return null;
  const out: number[] = [];
  for (const n of p.slice(0, CHUNK * 2)) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    out.push(clamp(Math.round(n), 0, WB_SCALE));
  }
  return out.length % 2 ? out.slice(0, -1) : out;
}

// Messaggio arrivato da un altro partecipante: controllato campo per campo (null = non valido)
export function parseWb(raw: unknown): WbMsg | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  switch (m.t) {
    case "o":
      return { t: "o", open: m.open === true, mode: m.mode === "all" ? "all" : "hosts" };
    case "s": {
      const p = points(m.p);
      if (!isId(m.id) || !p || !isColor(m.c) || (m.k !== "pen" && m.k !== "hl" && m.k !== "er")) return null;
      return { t: "s", id: m.id, k: m.k, c: m.c, w: clamp(Number(m.w) || SIZES[1], 1, 40), p };
    }
    case "p": {
      const p = points(m.p);
      return isId(m.id) && p ? { t: "p", id: m.id, p } : null;
    }
    case "u":
    case "nd":
      return isId(m.id) ? { t: m.t, id: m.id } : null;
    case "n":
      if (!isId(m.id) || !isColor(m.c) || typeof m.text !== "string") return null;
      return {
        t: "n",
        id: m.id,
        x: clamp(Math.round(Number(m.x) || 0), 0, NOTE_MAX_X),
        y: clamp(Math.round(Number(m.y) || 0), 0, NOTE_MAX_Y),
        c: m.c,
        text: m.text.slice(0, NOTE_MAX),
      };
    case "c":
      return { t: "c" };
    default:
      return null;
  }
}

// Cosa può mandare chi non è organizzatore (quando la lavagna è aperta a tutti): solo i suoi tratti
// e i post-it (anche quelli degli altri, si lavora insieme). Aprire, chiudere e cancellare tutto spetta agli organizzatori.
export function allowedFromGuest(m: WbMsg, identity: string) {
  const own = "id" in m && m.id.startsWith(`${identity}#`);
  if (m.t === "s" || m.t === "p" || m.t === "u") return own;
  return m.t === "n" || m.t === "nd";
}

export function applyWb(b: WbState, m: WbMsg) {
  switch (m.t) {
    case "o":
      b.open = m.open;
      b.mode = m.mode;
      break;
    case "c":
      b.strokes = [];
      b.notes = [];
      b.mine = [];
      break;
    case "s":
      if (!b.strokes.some((s) => s.id === m.id)) b.strokes.push({ id: m.id, tool: m.k, color: m.c, size: m.w, points: [...m.p] });
      break;
    case "p":
      b.strokes.find((s) => s.id === m.id)?.points.push(...m.p);
      break;
    case "u":
      b.strokes = b.strokes.filter((s) => s.id !== m.id);
      break;
    case "n": {
      // il post-it toccato per ultimo va sopra gli altri
      b.notes = [...b.notes.filter((n) => n.id !== m.id), { id: m.id, x: m.x, y: m.y, color: m.c, text: m.text }];
      break;
    }
    case "nd":
      b.notes = b.notes.filter((n) => n.id !== m.id);
      break;
  }
}

export const noteMsg = (n: WbNote): WbMsg => ({ t: "n", id: n.id, x: n.x, y: n.y, c: n.color, text: n.text });

// Messaggi per ricostruire tutta la lavagna (per chi entra dopo, o per riallineare tutti alla riapertura)
export function wbSync(b: WbState): WbMsg[] {
  const out: WbMsg[] = [{ t: "o", open: b.open, mode: b.mode }, { t: "c" }];
  for (const s of b.strokes) {
    out.push({ t: "s", id: s.id, k: s.tool, c: s.color, w: s.size, p: s.points.slice(0, CHUNK) });
    for (let i = CHUNK; i < s.points.length; i += CHUNK) out.push({ t: "p", id: s.id, p: s.points.slice(i, i + CHUNK) });
  }
  for (const n of b.notes) out.push(noteMsg(n));
  return out;
}

export function strokeWidth(s: Pick<WbStroke, "tool" | "size">, width: number) {
  const base = (s.size / 1000) * width;
  if (s.tool === "hl") return Math.max(6, base * 3);
  if (s.tool === "er") return Math.max(10, base * 4);
  return Math.max(1, base);
}

// Disegna i tratti su una tela trasparente (la gomma buca i tratti, il foglio bianco resta sotto)
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: WbStroke[], w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  for (const s of strokes) {
    const pts = s.points;
    if (pts.length < 2) continue;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = strokeWidth(s, w);
    if (s.tool === "er") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "#000";
    } else {
      ctx.strokeStyle = s.color;
      if (s.tool === "hl") ctx.globalAlpha = 0.35;
    }
    ctx.beginPath();
    ctx.moveTo((pts[0] / WB_SCALE) * w, (pts[1] / WB_SCALE) * h);
    // Un solo punto: un pallino
    if (pts.length === 2) ctx.lineTo((pts[0] / WB_SCALE) * w + 0.1, (pts[1] / WB_SCALE) * h);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo((pts[i] / WB_SCALE) * w, (pts[i + 1] / WB_SCALE) * h);
    ctx.stroke();
    ctx.restore();
  }
}

// Immagine PNG della lavagna (foglio, tratti e post-it), per salvarla
export async function exportBoard(b: WbState, width = 1920): Promise<Blob | null> {
  const height = Math.round(width / WB_RATIO);
  const ink = document.createElement("canvas");
  ink.width = width;
  ink.height = height;
  const ictx = ink.getContext("2d");
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx || !ictx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  drawStrokes(ictx, b.strokes, width, height);
  ctx.drawImage(ink, 0, 0);
  const side = NOTE_SIZE * width;
  const pad = side * 0.08;
  const font = side * 0.11;
  ctx.font = `${font}px ${getComputedStyle(document.body).fontFamily || "sans-serif"}`;
  ctx.textBaseline = "top";
  for (const n of b.notes) {
    const x = (n.x / WB_SCALE) * width;
    const y = (n.y / WB_SCALE) * height;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = side * 0.06;
    ctx.shadowOffsetY = side * 0.02;
    ctx.fillStyle = n.color;
    ctx.fillRect(x, y, side, side);
    ctx.restore();
    ctx.fillStyle = "#1d1d1d";
    let line = 0;
    for (const row of wrap(ctx, n.text, side - pad * 2)) {
      const ty = y + pad + line * font * 1.25;
      if (ty + font > y + side - pad) break;
      ctx.fillText(row, x + pad, ty);
      line++;
    }
  }
  return new Promise((resolve) => out.toBlob(resolve, "image/png"));
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const rows: string[] = [];
  for (const para of text.split("\n")) {
    let row = "";
    for (const word of para.split(/(\s+)/)) {
      const next = row + word;
      if (ctx.measureText(next).width <= max || !row.trim()) row = next;
      else {
        rows.push(row.trimEnd());
        row = word.trimStart();
      }
    }
    rows.push(row);
  }
  return rows;
}

import "server-only";
import { randomUUID } from "crypto";

// ============================================================================================
//  MODALITÀ DEMO — database finto, tenuto in memoria, per provare l'app senza Supabase.
//
//  Si attiva da sola quando mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.
//  Imita solo la parte del client Supabase usata da lib/video.ts e lib/video-auth.ts.
//  I dati si perdono a ogni riavvio del server (e su Vercel ogni tanto, quando la funzione riparte):
//  va bene per lavorare sulla grafica, non per le videochiamate vere.
// ============================================================================================

export const isDemo = () => !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY;

// Credenziali di prova (valgono solo in modalità demo)
export const DEMO_ORGANIZER = { name: "demo", password: "demo" };

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Result = { data: unknown; error: { code: string; message: string } | null };

const now = () => new Date().toISOString();

// Chiave primaria e valori predefiniti di ogni tabella (come in supabase/schema.sql)
const PRIMARY: Record<string, string[]> = {
  app_settings: ["key"],
  video_calls: ["id"],
  video_call_requests: ["call_id", "identity"],
};

const DEFAULTS: Record<string, () => Row> = {
  app_settings: () => ({ updated_at: now() }),
  video_calls: () => ({ id: randomUUID(), created_at: now(), ended_at: null, title: null, starts_at: null, started_at: null }),
  video_call_requests: () => ({ status: "pending", requested_at: now(), updated_at: now() }),
};

// In globalThis così sopravvive ai ricaricamenti di "npm run dev"
const store = globalThis as unknown as { __videoDemoDb?: Tables };

function tables(): Tables {
  if (!store.__videoDemoDb) {
    store.__videoDemoDb = {
      app_settings: [],
      video_calls: [],
      video_call_requests: [],
    };
  }
  return store.__videoDemoDb;
}

// "%" e "_" come in SQL, "\" per usarli alla lettera; senza distinguere maiuscole e minuscole
function likeToRegExp(pattern: string) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%") re += ".*";
    else if (c === "_") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "i");
}

class DemoQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row = {};
  private columns: string | null = null;
  private filters: ((r: Row) => boolean)[] = [];
  private sort: { column: string; ascending: boolean } | null = null;
  private mode: "many" | "single" | "maybe" = "many";

  constructor(private table: string) {}

  select(columns = "*") {
    this.columns = columns;
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  upsert(row: Row) {
    this.op = "upsert";
    this.payload = row;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  is(column: string, value: null) {
    this.filters.push((r) => (r[column] ?? null) === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  ilike(column: string, pattern: string) {
    const re = likeToRegExp(pattern);
    this.filters.push((r) => re.test(String(r[column] ?? "")));
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }) {
    this.sort = { column, ascending: opts?.ascending !== false };
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onfulfilled, onrejected);
  }

  private run(): Result {
    const rows = (tables()[this.table] ??= []);
    const match = (r: Row) => this.filters.every((f) => f(r));
    const pk = PRIMARY[this.table] ?? ["id"];
    let out: Row[] = [];

    if (this.op === "select") {
      out = rows.filter(match);
    } else if (this.op === "insert") {
      const row = { ...(DEFAULTS[this.table]?.() ?? {}), ...this.payload };
      if (this.table === "video_calls" && rows.some((r) => r.code === row.code)) {
        return { data: null, error: { code: "23505", message: "codice già usato" } };
      }
      rows.push(row);
      out = [row];
    } else if (this.op === "upsert") {
      const existing = rows.find((r) => pk.every((k) => r[k] === this.payload[k]));
      if (existing) Object.assign(existing, this.payload);
      else rows.push({ ...(DEFAULTS[this.table]?.() ?? {}), ...this.payload });
    } else if (this.op === "update") {
      out = rows.filter(match);
      for (const r of out) Object.assign(r, this.payload);
    } else {
      tables()[this.table] = rows.filter((r) => !match(r));
    }

    if (this.sort) {
      const { column, ascending } = this.sort;
      out = [...out].sort((a, b) => String(a[column] ?? "").localeCompare(String(b[column] ?? "")) * (ascending ? 1 : -1));
    }
    const cols = this.columns && this.columns !== "*" ? this.columns.split(",").map((c) => c.trim()) : null;
    const data = out.map((r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c] ?? null])) : { ...r }));

    if (this.mode === "single") {
      return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { code: "PGRST116", message: "nessuna riga" } };
    }
    if (this.mode === "maybe") return { data: data[0] ?? null, error: null };
    return { data: this.columns === null && this.op !== "select" ? null : data, error: null };
  }
}

export function demoClient() {
  return { from: (table: string) => new DemoQuery(table) };
}

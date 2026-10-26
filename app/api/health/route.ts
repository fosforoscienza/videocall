import { accessSync, constants, mkdirSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { dataFile, isDemo, usesSupabase } from "@/lib/local-db";
import { env } from "@/lib/env";
import { checkLiveKit, openCalls } from "@/lib/video";

export const dynamic = "force-dynamic";

// La cartella del database locale deve esistere ed essere scrivibile (le letture da sole non lo dicono)
function dataDirError() {
  const file = dataFile();
  if (!file) return null;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    accessSync(path.dirname(file), constants.W_OK);
    return null;
  } catch (e) {
    return `DATA_DIR non scrivibile (${path.dirname(file)}): ${(e as Error).message}`;
  }
}

// Controllo del server (es. https://call.tuosito.it/api/health dopo un Redeploy su Coolify):
// dice cosa manca o non funziona senza mostrare i valori delle variabili.
export async function GET() {
  const demo = isDemo();
  const sessionSecret = env("SESSION_SECRET") ?? "";
  const checks = {
    database: demo
      ? "modalità demo: imposta DATA_DIR (database in un file) oppure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY"
      : (dataDirError() ?? (await openCalls()).error ?? "ok"),
    livekit: (await checkLiveKit()) ?? "ok",
    session_secret: demo || sessionSecret.length >= 16 ? "ok" : "SESSION_SECRET mancante o troppo corto (almeno 16 caratteri)",
    organizers: demo || env("VIDEO_ORGANIZERS") ? "ok" : "VIDEO_ORGANIZERS mancante (es. mario:password1;anna:password2)",
  };
  const db = usesSupabase() ? "supabase" : demo ? "demo" : "file";
  const ok = !demo && Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ ok, db, checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

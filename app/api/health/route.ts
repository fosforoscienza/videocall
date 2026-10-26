import { NextResponse } from "next/server";
import { isDemo } from "@/lib/demo-db";
import { env } from "@/lib/env";
import { checkLiveKit, openCalls } from "@/lib/video";

export const dynamic = "force-dynamic";

// Controllo del server (es. https://call.tuosito.it/api/health dopo un Redeploy su Coolify):
// dice cosa manca o non funziona senza mostrare i valori delle variabili.
export async function GET() {
  const demo = isDemo();
  const sessionSecret = env("SESSION_SECRET") ?? "";
  const checks = {
    database: demo ? "modalità demo: mancano SUPABASE_URL e/o SUPABASE_SERVICE_ROLE_KEY" : ((await openCalls()).error ?? "ok"),
    livekit: (await checkLiveKit()) ?? "ok",
    session_secret: demo || sessionSecret.length >= 16 ? "ok" : "SESSION_SECRET mancante o troppo corto (almeno 16 caratteri)",
    organizers: demo || env("VIDEO_ORGANIZERS") ? "ok" : "VIDEO_ORGANIZERS mancante (es. mario:password1;anna:password2)",
  };
  const ok = !demo && Object.values(checks).every((v) => v === "ok");
  return NextResponse.json({ ok, demo, checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

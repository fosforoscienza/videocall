import "server-only";
import { createClient } from "@supabase/supabase-js";
import { demoClient, isDemo } from "./demo-db";

const clean = (v: string) => v.trim().replace(/^["']|["']$/g, "").trim();

// Senza le variabili Supabase l'app gira in modalità demo, con un database finto in memoria (lib/demo-db.ts)
export function supabaseAdmin() {
  if (isDemo()) return demoClient() as unknown as ReturnType<typeof createClient>;
  // Toglie gli errori di incollatura più comuni: spazi, virgolette, "/rest/v1" in fondo all'indirizzo
  const url = clean(process.env.NEXT_PUBLIC_SUPABASE_URL!).replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY!);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

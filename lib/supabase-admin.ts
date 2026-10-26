import "server-only";
import { createClient } from "@supabase/supabase-js";
import { localClient, usesSupabase } from "./local-db";
import { env, supabaseUrl } from "./env";

// Senza le variabili Supabase l'app usa il database locale (lib/local-db.ts): un file in DATA_DIR,
// oppure, senza DATA_DIR, la modalità demo in memoria
export function supabaseAdmin() {
  if (!usesSupabase()) return localClient() as unknown as ReturnType<typeof createClient>;
  return createClient(supabaseUrl()!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
}

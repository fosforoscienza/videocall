import "server-only";
import { createClient } from "@supabase/supabase-js";
import { demoClient, isDemo } from "./demo-db";
import { env, supabaseUrl } from "./env";

// Senza le variabili Supabase l'app gira in modalità demo, con un database finto in memoria (lib/demo-db.ts)
export function supabaseAdmin() {
  if (isDemo()) return demoClient() as unknown as ReturnType<typeof createClient>;
  return createClient(supabaseUrl()!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
}

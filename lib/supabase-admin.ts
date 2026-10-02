import "server-only";
import { createClient } from "@supabase/supabase-js";
import { demoClient, isDemo } from "./demo-db";

// Senza le variabili Supabase l'app gira in modalità demo, con un database finto in memoria (lib/demo-db.ts)
export function supabaseAdmin() {
  if (isDemo()) return demoClient() as unknown as ReturnType<typeof createClient>;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

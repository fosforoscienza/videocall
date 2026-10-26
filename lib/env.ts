import "server-only";

// Dove si correggono le variabili d'ambiente (compare nei messaggi di errore per l'organizzatore)
export const ENV_PLACE = "su Coolify (app → Environment Variables, poi Redeploy)";

// Variabile d'ambiente letta mentre il server gira, non durante la build: con un nome calcolato Next.js
// non la sostituisce col valore del momento della build (lo farebbe con process.env.NEXT_PUBLIC_...).
// Toglie spazi, virgolette e "NOME=" incollati per errore insieme al valore.
export function env(name: string) {
  const v = process.env[name]?.trim().replace(new RegExp(`^${name}\\s*=\\s*`), "").replace(/^["']|["']$/g, "").trim();
  return v || undefined;
}

// Indirizzo del progetto Supabase: va bene SUPABASE_URL o NEXT_PUBLIC_SUPABASE_URL (serve solo al server)
export function supabaseUrl() {
  const v = env("SUPABASE_URL") ?? env("NEXT_PUBLIC_SUPABASE_URL");
  // Toglie "/rest/v1" e le barre in fondo incollati per errore
  return v?.replace(/\/+$/, "").replace(/\/rest\/v1$/, "") || undefined;
}

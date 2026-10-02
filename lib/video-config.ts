// Impostazioni del pacchetto videochiamate: nome del sito, logo e testi dell'accesso.
// Valgono sia sul server sia nel browser (niente segreti qui: quelli vanno nelle variabili d'ambiente).

export const VIDEO_CONFIG = {
  // Nome mostrato nelle pagine e nell'anteprima del link (WhatsApp, Telegram...)
  brand: "Il mio sito",
  // Logo nella barra dei comandi (file in public/). Se manca, la barra resta senza logo.
  logo: "/logo.png",
  // Pagina di gestione degli organizzatori (avvio, link, sala d'attesa). Nel pacchetto è la home "/".
  consolePath: "/",

  // Come entrano i partecipanti dal link:
  // - "members": nome utente + codice, controllati nella tabella video_members (vedi supabase/schema.sql)
  // - "name":    basta scrivere il proprio nome (chiunque abbia il link può chiedere di entrare)
  // Per usare gli utenti di un altro sito cambia lib/video-auth.ts (vedi README).
  guestLogin: "members" as "members" | "name",

  // Testi dell'accesso con "members"
  credentials: "nome.cognome e codice socio",
  userPlaceholder: "tuonome.tuocognome",
  codePlaceholder: "codice socio",
};

// "Entra con nome.cognome e codice socio" / "Entra con il tuo nome"
export const ENTER_WITH = VIDEO_CONFIG.guestLogin === "name" ? "il tuo nome" : VIDEO_CONFIG.credentials;

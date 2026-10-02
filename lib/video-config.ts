// Impostazioni del pacchetto videochiamate: nome del sito, logo e indirizzi.
// Valgono sia sul server sia nel browser (niente segreti qui: quelli vanno nelle variabili d'ambiente).

export const VIDEO_CONFIG = {
  // Nome mostrato nelle pagine e nell'anteprima del link (WhatsApp, Telegram...)
  brand: "fosforo: la festa della scienza",
  // Logo chiaro, per i fondi scuri: footer e barra dei comandi della videochiamata (file in public/)
  logo: "/logo-white.png",
  // Logo scuro, per l'header bianco delle pagine
  logoInk: "/logo-ink.png",
  // Indirizzo del sito principale (logo dell'header e link nel footer)
  siteUrl: "https://www.fosforoscienza.it/",
  // Riga in fondo alle pagine
  owner: "Associazione Culturale NEXT ETS",
  // Pagina di gestione degli organizzatori (avvio, link, sala d'attesa). Nel pacchetto è la home "/".
  consolePath: "/",
};

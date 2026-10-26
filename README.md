# Videochiamate — pacchetto riutilizzabile

Sezione di videoconferenza presa da *The LAST Dance* e resa indipendente: funziona da sola come piccola app
oppure si copia dentro un altro sito fatto con Next.js.

## Cosa fa

- Solo gli **organizzatori** (credenziali in `VIDEO_ORGANIZERS`) avviano (o **programmano**) una videochiamata
  e condividono il link. Non c'è nessun elenco di utenti da gestire.
- Per ogni riunione l'organizzatore sceglie l'accesso: **libero** (basta il nome), **con password** (nome +
  password della riunione) oppure **sala d'attesa** (l'organizzatore ammette o rifiuta; password facoltativa).
- **Stanze**: l'organizzatore divide la chiamata in gruppi e sposta i partecipanti; la chiamata termina da sola
  quando esce l'ultima persona.
- **Riunione** (tutti parlano) oppure **webinar** (i partecipanti guardano, ascoltano e scrivono in chat).
- Fotocamera e microfono accesi in automatico; scelta di fotocamera, microfono e altoparlante.
- **Condivisione schermo** con audio e **lavagna** sopra lo schermo (penna, evidenziatore, gomma).
- **Lavagna virtuale** condivisa: pennarelli di vari colori e spessori, evidenziatore, gomma e **post-it colorati**
  da scrivere e spostare; l'organizzatore la apre per tutti e sceglie se possono scriverci **tutti** o **solo gli organizzatori**.
  Si salva come immagine.
- **Chat** laterale, **co-organizzatori** (se l'organizzatore esce il ruolo passa da solo), silenzia uno o tutti.
- Griglia senza spazi vuoti, persona **fissata in grande**, vista "**chi parla in grande**", più pagine con tante persone.
- **Finestrella** (Picture-in-Picture) quando si cambia scheda: Chrome/Edge da computer la aprono da soli se la pagina
  usa microfono o fotocamera; altrove (Safari, iPhone, iPad, webinar) con il pulsante della finestrella.
- Ottimizzata per telefono e iPad.

Audio e video passano da **LiveKit**, installato sullo stesso server (oppure LiveKit Cloud); chiamate, sala d'attesa
e impostazioni stanno in un **file sul server** (oppure su Supabase). Non serve nessun servizio esterno.

## Cosa serve

| Servizio | A cosa serve | Costo |
| --- | --- | --- |
| [Coolify](https://coolify.io) su un server (es. Debian) | pubblicare l'app e salvare i dati | gratis (paghi solo il server) |
| [LiveKit](https://livekit.io) sullo stesso server ([`deploy/livekit`](deploy/livekit)) | audio e video | gratis (open source) |
| ([Supabase](https://supabase.com) o [LiveKit Cloud](https://cloud.livekit.io)) | facoltativi, al posto del server | piano gratuito |

Node.js 20 o più recente per provarla sul computer.

---

## Il database

Le tabelle sono tre e piccole (impostazioni, chiamate, sala d'attesa): non serve un server di database.
[`lib/local-db.ts`](lib/local-db.ts) le tiene in memoria e, con `DATA_DIR`, le salva nel file `DATA_DIR/videocall.json`
a ogni modifica. Su Coolify `DATA_DIR=/data` con un volume (*Persistent Storage*) montato in `/data`: i dati restano
dopo riavvii e Redeploy. Se invece ci sono `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` l'app usa Supabase
(tabelle in [`supabase/schema.sql`](supabase/schema.sql)).

## Modalità demo (senza database)

Per provare l'app o lavorare sulla grafica: senza `DATA_DIR` e senza Supabase l'app tiene tutto in memoria.

- Organizzatore: **demo** / **demo** (se `VIDEO_ORGANIZERS` è vuota). `SESSION_SECRET` non serve.
- I partecipanti entrano dal link scrivendo un nome qualsiasi (e la password, se l'hai scelta per la riunione).
- Si possono avviare e programmare chiamate, usare la sala d'attesa e le impostazioni anche senza LiveKit;
  per entrare nella stanza con audio e video servono comunque `LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET`.
- I dati si azzerano quando il server riparte. Appena imposti `DATA_DIR` (o Supabase) la modalità demo si spegne da sola.

## Strada A — app separata (consigliata, va bene con qualsiasi sito)

Funziona con qualsiasi sito (WordPress, Wix, HTML, Next.js...): le videochiamate stanno su un indirizzo a parte,
per esempio `video.tuosito.it`, e dal sito si mette un link o un pulsante.

1. **Codice su GitHub**: crea un repository nuovo e caricaci il contenuto di questa cartella.
2. **LiveKit sul server**: copia [`deploy/livekit`](deploy/livekit) in `/opt/livekit`, crea `livekit.yaml` da
   `livekit.example.yaml` (chiave, segreto e IP pubblico del server), cambia l'indirizzo nella regola di Traefik in
   `docker-compose.yml` e avvia con `sudo docker compose up -d`. Apri nel firewall 7882/udp e 7881/tcp
   (comandi in cima a `docker-compose.yml`). Traefik di Coolify gira a LiveKit `/rtc` e `/twirp` dell'indirizzo dell'app.
3. **Coolify**: *+ New → Application → Public/Private Repository*, scegli il repository e il ramo `main`.
   - *Build Pack*: **Dockerfile** (c'è già nel repository), *Ports Exposes*: **3000**.
   - *Domains*: l'indirizzo dell'app, es. `https://video.tuosito.it` (Coolify fa da solo il certificato HTTPS;
     il DNS del sottodominio deve puntare all'IP del server).
   - *Environment Variables*: inserisci le variabili di [`.env.example`](.env.example). Non serve spuntare
     *Build Variable*: l'app le legge mentre gira.
     - `DATA_DIR=/data`, e in *Persistent Storage* un volume montato in `/data`
     - `LIVEKIT_URL` (es. `wss://video.tuosito.it`), `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (quelli di `livekit.yaml`)
     - `SESSION_SECRET`: una frase lunga e casuale (almeno 16 caratteri)
     - `VIDEO_ORGANIZERS`: gli organizzatori, come `mario:password1;anna:password2`
4. *Deploy* (dopo ogni cambio di variabili: *Redeploy*). Poi apri `https://video.tuosito.it/api/health`:
   se tutto è a posto risponde `"ok": true`, altrimenti dice quale variabile manca o è sbagliata
   (senza mostrarne il valore).
5. Apri l'indirizzo dell'app, entra come organizzatore, avvia la videochiamata (scegli libero, password o sala d'attesa) e condividi il link.

Per provarla sul computer: copia `.env.example` in `.env.local`, compila i valori, poi `npm install` e `npm run dev`
e apri http://localhost:3000.

### Metterla dentro una pagina del sito (iframe)

Si può, ma conviene un link o un pulsante che apre l'app in una nuova scheda: dentro un iframe di un altro dominio
molti browser (Safari soprattutto) bloccano il cookie di accesso. Se usi l'iframe, mettilo su un sottodominio dello
stesso sito e dai i permessi:

```html
<iframe src="https://video.tuosito.it/call/..." style="width:100%;height:100vh;border:0"
  allow="camera; microphone; display-capture; autoplay; fullscreen; picture-in-picture"></iframe>
```

---

## Strada B — dentro un sito Next.js esistente

Serve un sito Next.js con App Router (Next 15 o 16) e React 19.

1. Installa le dipendenze:
   `npm install livekit-client livekit-server-sdk @supabase/supabase-js jose server-only`
2. Copia nel sito:
   - `lib/` (tutti i file; se hai già `lib/supabase-admin.ts` o `lib/sounds.ts` tieni il tuo e controlla i nomi delle funzioni)
   - `components/` (tutti i file tranne `Footer.tsx` se ne hai già uno)
   - `app/call/` e `app/api/admin/call/`, `app/api/call/`
   - la pagina di gestione: sposta `app/page.tsx` dove vuoi (es. `app/videochiamate/page.tsx`) e scrivi quel
     percorso in `consolePath` dentro `lib/video-config.ts`
   - `app/api/login` e `app/api/logout` solo se non ne hai già di tuoi (in quel caso rinominali, es. `app/api/video-login`,
     e cambia gli indirizzi in `OrganizerLogin.tsx`, `OrganizerConsole.tsx` e `CallJoin.tsx`)
3. **Stile**: le regole delle videochiamate sono in `app/globals.css`, dalla riga `/* ---------- videochiamate ---------- */`
   in giù (tutte con il prefisso `call-` o `pip-`). Copiale nel CSS del sito insieme alle variabili `:root` in cima.
   Le classi comuni più in alto (`.btn`, `.card`, `.input`, `.title`...) potrebbero avere lo stesso nome di classi del sito:
   copiale solo se non le hai, altrimenti adatta i colori.
   Il font è Figtree (vedi `app/layout.tsx`); con un altro font basta cambiare `--font-main`.
4. Esegui `supabase/schema.sql` sul database del sito (crea solo tabelle nuove; se hai già `app_settings` con le
   stesse colonne `key`, `value`, `updated_at` la riusa).
5. Aggiungi le variabili d'ambiente di `.env.example`.
6. Collega gli utenti del sito (paragrafo seguente).

Le pagine vanno a tutto schermo: la videochiamata si apre sopra la pagina (non serve togliere menu o footer del sito).

---

## Usare gli utenti del tuo sito

Tutto ciò che riguarda gli utenti è in **un solo file**: [`lib/video-auth.ts`](lib/video-auth.ts).
Le videochiamate chiedono solo `currentUser()`, che deve restituire chi sta usando la pagina:

```ts
{ id: "m:42", name: "Mario Rossi", organizer: false }
```

- `id`: unico e sempre uguale per la stessa persona (usa l'id del tuo database con un prefisso)
- `name`: il nome che vedono gli altri
- `organizer`: `true` per chi può avviare e gestire le videochiamate

Esempio con un sito che usa Supabase Auth (adatta alla tua sessione):

```ts
export async function currentUser(): Promise<VideoUser | null> {
  const user = await getUtenteDalMioSito(); // la tua funzione: legge il cookie di sessione del sito
  if (!user) return null;
  return { id: `u:${user.id}`, name: user.nome, organizer: user.ruolo === "admin" };
}
```

Se gli utenti sono già entrati nel sito, alla pagina del link della videochiamata vedono subito
"Entri come Mario Rossi". Chi non è riconosciuto scrive il suo nome (`guestUser()`); `login()` serve solo agli
organizzatori della pagina di gestione.

---

## Personalizzare

In [`lib/video-config.ts`](lib/video-config.ts):

- `brand`: nome del sito (pagine e anteprima del link su WhatsApp)
- `logo`: logo chiaro per i fondi scuri (footer e barra dei comandi), `logoInk`: logo scuro per l'header bianco (file in `public/`)
- `siteUrl`, `owner`: sito principale e titolare (header e footer)

Colori: variabili in cima a `app/globals.css` (`--f-cyan`, `--f-button`, `--f-ink`...): tema chiaro per le pagine,
tema scuro (blu notte) per la stanza della videochiamata. Font: Figtree, in `app/fonts/`.

## File

```
app/
  page.tsx                    gestione per gli organizzatori (accesso + avvio, link, sala d'attesa, programmate)
  call/[code]/page.tsx        pagina del link: accesso, sala d'attesa, videochiamata
  api/admin/call/...          API dell'organizzatore (avvio, azioni, impostazioni, programmate, gettone)
  api/call/[code]/...         API dei partecipanti (ingresso, passaggio del ruolo di organizzatore)
  api/login, api/logout       accesso degli organizzatori
components/
  VideoRoom.tsx               la videochiamata (riquadri, comandi, chat, schermo, finestrella)
  CallJoin.tsx                ingresso dal link
  VideoCallAdmin.tsx          pannello dell'organizzatore
  Whiteboard.tsx              lavagna virtuale (tratti e post-it)
  ...                         chat, disegni sullo schermo, dispositivi, interruttori
lib/
  video-auth.ts               ← utenti e accesso (da adattare al tuo sito)
  video-config.ts             ← nome, logo, testi
  video.ts                    logica lato server (LiveKit + database)
  useHostCall.ts              stato della chiamata per l'organizzatore
  whiteboard.ts               lavagna virtuale: messaggi, permessi, disegno, immagine da salvare
  local-db.ts                 database in un file (DATA_DIR) o in memoria (demo)
deploy/livekit/               LiveKit sul server (docker compose + configurazione)
supabase/schema.sql           tabelle (solo se usi Supabase)
```

## Da sapere

- Una sola videochiamata in corso alla volta (più quelle programmate).
- Un solo server per l'app: il database in un file non va bene con più copie dell'app in parallelo.
- Le chiavi segrete (`LIVEKIT_API_SECRET`, `SESSION_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) non vanno mai nel codice né
  in variabili che iniziano con `NEXT_PUBLIC_`.
- Se l'organizzatore vede un errore su LiveKit o sul database, il messaggio dice quale variabile correggere su Coolify;
  `/api/health` mostra tutti i controlli insieme.

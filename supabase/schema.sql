-- Videochiamate: tabelle da creare su Supabase (SQL Editor → incolla tutto → Run).
-- Si può rieseguire senza problemi: crea solo ciò che manca.
-- Tutte le tabelle sono lette e scritte solo dal server (chiave service_role): nessuna policy => il browser non le vede.

create extension if not exists pgcrypto;

-- Impostazioni: accesso (libero, password, sala d'attesa), condivisione schermo, solo ascolto, co-organizzatori
-- e stanze di ogni chiamata. Non ci sono utenti: gli organizzatori sono in VIDEO_ORGANIZERS su Vercel,
-- i partecipanti scrivono solo il nome entrando dal link.
create table if not exists public.app_settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;

-- Videochiamate. starts_at = data e ora programmate (vuoto = subito);
-- started_at = quando l'organizzatore l'ha avviata (vuoto = programmata, non ancora iniziata)
create table if not exists public.video_calls (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  created_by  text not null,
  created_at  timestamptz not null default now(),
  ended_at    timestamptz,
  title       text,
  starts_at   timestamptz,
  started_at  timestamptz
);
alter table public.video_calls enable row level security;

-- Richieste di ingresso (sala d'attesa): l'organizzatore le accetta o le rifiuta.
-- identity = id dato da lib/video-auth.ts ("g:<casuale>" per i partecipanti, "o:<nome>" per gli organizzatori)
create table if not exists public.video_call_requests (
  call_id       uuid not null references public.video_calls (id) on delete cascade,
  identity      text not null,
  name          text not null,
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'removed')),
  requested_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (call_id, identity)
);
alter table public.video_call_requests enable row level security;

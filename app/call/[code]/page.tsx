import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import CallJoin from "@/components/CallJoin";
import { ENTER_WITH, VIDEO_CONFIG } from "@/lib/video-config";
import { callByCode, currentParticipant, isOpenAccess } from "@/lib/video";
import { callSlug, codeFromSlug, formatWhen, isLive } from "@/lib/video-types";

export const dynamic = "force-dynamic";

// La stessa chiamata serve all'anteprima del link e alla pagina: letta una volta sola per richiesta
const getCall = cache((code: string) => callByCode(code).catch(() => null));

// Anteprima del link (WhatsApp, Telegram...): nome della chiamata e, se programmata, data e ora
export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const call = await getCall(codeFromSlug((await params).code));
  const title = call?.title ? `${call.title} — Videochiamata` : `Videochiamata — ${VIDEO_CONFIG.brand}`;
  const description = !call
    ? "Videochiamata terminata"
    : isLive(call)
      ? `Videochiamata in corso · Entra con ${ENTER_WITH}`
      : `${call.starts_at ? `📅 ${formatWhen(call.starts_at)}` : "Videochiamata programmata"} · Entra con ${ENTER_WITH}`;
  // Nessuna immagine: WhatsApp usa l'icona del sito, piccola accanto al testo
  return {
    title,
    description,
    openGraph: { title, description, siteName: VIDEO_CONFIG.brand, type: "website", locale: "it_IT" },
    twitter: { card: "summary", title, description },
  };
}

// Pagina aperta dal link che condivide l'organizzatore.
// I partecipanti vedono solo la videochiamata: il link alla gestione è solo per gli organizzatori.
export default async function CallPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: slug } = await params;
  const code = codeFromSlug(slug);
  const [call, me, open] = await Promise.all([
    getCall(code),
    currentParticipant(),
    isOpenAccess().catch(() => false),
  ]);
  // Link con un nome vecchio (chiamata rinominata) o senza nome: porta a quello attuale
  if (call && decodeURIComponent(slug) !== callSlug(call)) redirect(`/call/${callSlug(call)}`);
  return (
    <div className="call-page">
      <CallJoin openAccess={open} title={call?.title ?? ""} live={!call || isLive(call)} startsAt={call?.starts_at ?? null} code={code} exists={call !== null} listenOnly={!!call?.listen_only && !me?.host} me={me ? { name: me.name } : null} showAppLink={!!me?.host} />
    </div>
  );
}

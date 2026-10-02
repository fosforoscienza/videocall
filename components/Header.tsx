import { VIDEO_CONFIG } from "@/lib/video-config";

// Barra bianca in alto, come l'header del sito: logo che porta al sito principale e nome della sezione
export default function Header() {
  return (
    <header className="header">
      <a className="header-brand" href={VIDEO_CONFIG.siteUrl} aria-label={`${VIDEO_CONFIG.brand}: vai al sito`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="header-logo" src={VIDEO_CONFIG.logoInk} alt={VIDEO_CONFIG.brand} width={1117} height={234} />
      </a>
      <span className="header-label">Videochiamate</span>
    </header>
  );
}

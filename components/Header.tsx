import { VIDEO_CONFIG } from "@/lib/video-config";

// Barra in alto, come l'header del sito: logo che porta al sito principale e nome della sezione
export default function Header() {
  return (
    <header className="header">
      <a className="header-brand" href={VIDEO_CONFIG.siteUrl} aria-label={`${VIDEO_CONFIG.brand}: vai al sito`}>
        {/* Logo chiaro sul fondo blu; quello scuro serve solo con il tema chiaro (classe "theme-light") */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="header-logo on-dark" src={VIDEO_CONFIG.logo} alt={VIDEO_CONFIG.brand} width={1117} height={234} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="header-logo on-light" src={VIDEO_CONFIG.logoInk} alt="" width={1117} height={234} />
      </a>
      <span className="header-label">Videochiamate</span>
    </header>
  );
}

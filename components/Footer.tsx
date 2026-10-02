"use client";

import { useEffect, useRef, useState } from "react";
import { VIDEO_CONFIG } from "@/lib/video-config";

// Fascia blu notte in fondo alla pagina, come il footer del sito: logo chiaro (o il nome, se manca) e titolare
export default function Footer() {
  const [broken, setBroken] = useState(false);
  const img = useRef<HTMLImageElement>(null);

  // L'errore di caricamento può avvenire prima dell'idratazione
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setBroken(true);
  }, []);

  return (
    <footer className="footer">
      {broken ? (
        <span className="footer-text">{VIDEO_CONFIG.brand}</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={img} src={VIDEO_CONFIG.logo} alt={VIDEO_CONFIG.brand} className="footer-logo" onError={() => setBroken(true)} />
      )}
      <span className="footer-small">
        © {new Date().getFullYear()} <a href={VIDEO_CONFIG.siteUrl}>{VIDEO_CONFIG.owner}</a>
      </span>
    </footer>
  );
}

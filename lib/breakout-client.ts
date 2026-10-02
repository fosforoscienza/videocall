"use client";

import type { BreakoutRoom } from "./video-types";

// Spostamento tra plenaria e stanze: nuovo gettone per la stanza scelta (null = plenaria)
export type RoomTicket = { url: string; token: string; room: BreakoutRoom | null; host: boolean; listenOnly: boolean };

export async function fetchRoomTicket(code: string, roomId: string | null): Promise<RoomTicket | { error: string }> {
  try {
    const res = await fetch(`/api/call/${code}/room?room=${encodeURIComponent(roomId ?? "main")}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) return { error: data.error || "Non riesco a cambiare stanza, riprova" };
    return data as RoomTicket;
  } catch {
    return { error: "Connessione assente, riprova" };
  }
}

// Ultima assegnazione vista da questo partecipante, per chiamata: si viene spostati da soli solo quando
// l'organizzatore cambia l'assegnazione, non dopo essere tornati in plenaria di propria scelta.
// Resta valida per tutta la visita della pagina (la stanza si ricollega a ogni spostamento).
export const seenAssignment = new Map<string, string | null>();

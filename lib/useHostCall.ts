"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playSound } from "./sounds";
import type { CallInfo, CallRequest, HostAction } from "./video-types";

type PlanData = { id?: string; title?: string; startsAt?: string; listenOnly?: boolean };

export type HostCall = {
  loaded: boolean;
  configured: boolean;
  openAccess: boolean;
  shareAll: boolean;
  // Chiamata in corso in solo ascolto (i partecipanti non parlano)
  listenOnly: boolean;
  call: CallInfo | null;
  scheduled: CallInfo[];
  canSchedule: boolean;
  requests: CallRequest[];
  pending: CallRequest[];
  error: string;
  busy: boolean;
  start: (title?: string, listenOnly?: boolean) => Promise<void>;
  rename: (title: string) => Promise<void>;
  end: () => Promise<void>;
  // room: stanza in cui si trova chi agisce (per silenziare lì), vuoto = plenaria
  act: (action: HostAction, identity?: string, trackSid?: string, room?: string | null) => Promise<void>;
  setOpenAccess: (on: boolean) => Promise<void>;
  setShareAll: (on: boolean) => Promise<void>;
  setListenOnly: (on: boolean) => Promise<void>;
  // Videochiamate programmate
  plan: (action: "create" | "update" | "cancel" | "start", data: PlanData) => Promise<boolean>;
};

// Stato della videochiamata per l'organizzatore: si aggiorna da solo (spesso mentre c'è una chiamata,
// così chi bussa in sala d'attesa compare subito) e suona quando arriva una nuova richiesta.
export function useHostCall(enabled = true): HostCall {
  const [loaded, setLoaded] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [openAccess, setOpen] = useState(false);
  const [shareAll, setShare] = useState(false);
  const [call, setCall] = useState<CallInfo | null>(null);
  const [scheduled, setScheduled] = useState<CallInfo[]>([]);
  const [canSchedule, setCanSchedule] = useState(true);
  const [requests, setRequests] = useState<CallRequest[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const seen = useRef<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/call", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error) setError(data.error);
        return;
      }
      setConfigured(data.configured);
      setOpen(data.openAccess === true);
      setShare(data.shareAll === true);
      setCall(data.call);
      setScheduled(data.scheduled ?? []);
      setCanSchedule(data.canSchedule !== false);
      const list = data.requests as CallRequest[];
      setRequests(list);
      // Suono solo per le richieste nuove, non per quelle già in attesa all'apertura
      const keys = list.filter((r) => r.status === "pending").map((r) => `${r.identity}@${r.requested_at}`);
      if (seen.current && keys.some((k) => !seen.current!.has(k))) playSound("gain");
      seen.current = new Set(keys);
      setLoaded(true);
    } catch {
      // rete assente: riprova al prossimo giro
    }
  }, []);

  const active = call !== null;
  useEffect(() => {
    if (!enabled) return;
    refresh();
    const interval = setInterval(() => document.visibilityState === "visible" && refresh(), active ? 3000 : 15000);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, active, refresh]);

  const send = useCallback(
    async (url: string, init: RequestInit) => {
      setBusy(true);
      setError("");
      try {
        const res = await fetch(url, init);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) setError(data.error || "Errore, riprova");
        else if (data.warning) setError(data.warning);
        await refresh();
        setBusy(false);
        return res.ok;
      } catch {
        setError("Connessione assente, riprova");
        await refresh();
        setBusy(false);
        return false;
      }
    },
    [refresh]
  );

  const start = useCallback(
    async (title = "", listenOnly = false) => {
      await send("/api/admin/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, listenOnly }),
      });
    },
    [send]
  );
  const rename = useCallback(
    async (title: string) => {
      await send("/api/admin/call", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    },
    [send]
  );
  const end = useCallback(async () => {
    await send("/api/admin/call", { method: "DELETE" });
  }, [send]);
  const plan = useCallback(
    (action: "create" | "update" | "cancel" | "start", data: PlanData) =>
      send("/api/admin/call/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...data }),
      }),
    [send]
  );

  const act = useCallback(
    async (action: HostAction, identity?: string, trackSid?: string, room?: string | null) => {
      // Aggiorna subito la lista, senza aspettare il server
      if (action === "accept_all") setRequests((rs) => rs.map((r) => (r.status === "pending" ? { ...r, status: "accepted" } : r)));
      else if (action === "accept" || action === "reject" || action === "remove") {
        const status = action === "accept" ? "accepted" : action === "reject" ? "rejected" : "removed";
        setRequests((rs) => rs.map((r) => (r.identity === identity ? { ...r, status } : r)));
      }
      await send("/api/admin/call/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, identity, trackSid, room: room ?? undefined }),
      });
    },
    [send]
  );

  const setOpenAccess = useCallback(
    async (on: boolean) => {
      setOpen(on);
      await send("/api/admin/call/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openAccess: on }),
      });
    },
    [send]
  );

  const setShareAll = useCallback(
    async (on: boolean) => {
      setShare(on);
      await send("/api/admin/call/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareAll: on }),
      });
    },
    [send]
  );

  const setListenOnly = useCallback(
    async (on: boolean) => {
      setCall((c) => (c ? { ...c, listen_only: on } : c));
      await send("/api/admin/call/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listenOnly: on }),
      });
    },
    [send]
  );

  return {
    loaded,
    configured,
    openAccess,
    setOpenAccess,
    shareAll,
    setShareAll,
    listenOnly: call?.listen_only === true,
    setListenOnly,
    call,
    scheduled,
    canSchedule,
    plan,
    requests,
    pending: requests.filter((r) => r.status === "pending"),
    error,
    busy,
    start,
    rename,
    end,
    act,
  };
}

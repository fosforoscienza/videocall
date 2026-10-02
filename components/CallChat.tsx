"use client";

import { useEffect, useRef, useState } from "react";

export type ChatMessage = { id: string; name: string; text: string; ts: number; mine: boolean };

export const CHAT_TOPIC = "chat";
export const CHAT_MAX = 1000;

const time = (ts: number) => new Date(ts).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

// Chat della videochiamata, in un pannello a bordo schermo. Si vedono i messaggi arrivati da quando si è entrati.
export default function CallChat({
  messages,
  onSend,
  onClose,
}: {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLElement>(null);

  // iPhone/iPad: con la tastiera aperta la chat occupa solo lo spazio visibile, così il campo resta in vista
  useEffect(() => {
    const vv = window.visualViewport;
    const el = box.current;
    if (!vv || !el) return;
    const fit = () => {
      el.style.top = `${vv.offsetTop}px`;
      el.style.height = `${vv.height}px`;
      el.style.bottom = "auto";
      const l = list.current;
      if (l) l.scrollTop = l.scrollHeight;
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, []);

  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t.slice(0, CHAT_MAX));
    setText("");
  };

  return (
    <aside ref={box} className="call-chat" aria-label="Chat">
      <div className="call-chat-head">
        <h2 className="title">Chat</h2>
        <button className="call-close" onClick={onClose} aria-label="Chiudi la chat">
          ✕
        </button>
      </div>
      <div ref={list} className="call-chat-list">
        {messages.length === 0 && <p className="muted call-chat-empty">Nessun messaggio. Scrivi qualcosa a tutti!</p>}
        {messages.map((m, i) => {
          const sameAsPrev = i > 0 && messages[i - 1].name === m.name && messages[i - 1].mine === m.mine;
          return (
            <div key={m.id} className={`call-msg ${m.mine ? "mine" : ""}`}>
              {!sameAsPrev && (
                <div className="call-msg-head">
                  <strong>{m.mine ? "Tu" : m.name}</strong> <span>{time(m.ts)}</span>
                </div>
              )}
              <div className="call-msg-text">{m.text}</div>
            </div>
          );
        })}
      </div>
      <form className="call-chat-form" onSubmit={submit}>
        <input
          className="input"
          placeholder="Scrivi un messaggio"
          aria-label="Messaggio"
          value={text}
          maxLength={CHAT_MAX}
          enterKeyHint="send"
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn btn-gold btn-small" disabled={!text.trim()} aria-label="Invia">
          ➤
        </button>
      </form>
    </aside>
  );
}

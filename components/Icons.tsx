// Icone dei comandi della videochiamata: tratto semplice, colore del testo (currentColor)

type Props = { name: IconName };

export type IconName =
  | "mic"
  | "mic-off"
  | "cam"
  | "cam-off"
  | "flip"
  | "share"
  | "pen"
  | "settings"
  | "pip"
  | "chat"
  | "layout"
  | "people"
  | "more"
  | "leave";

const PATHS: Record<IconName, React.ReactNode> = {
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  "mic-off": (
    <>
      <path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.6 2.5" />
      <path d="M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.7 3M12 18v3M3 3l18 18" />
    </>
  ),
  cam: (
    <>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="m15.5 10.5 6-3.5v10l-6-3.5" />
    </>
  ),
  "cam-off": (
    <>
      <path d="M10 6h3a2.5 2.5 0 0 1 2.5 2.5v3l6-4v10l-3-2M15.5 15.5A2.5 2.5 0 0 1 13 18H5a2.5 2.5 0 0 1-2.5-2.5v-7A2.5 2.5 0 0 1 5 6" />
      <path d="M3 3l18 18" />
    </>
  ),
  flip: (
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 3v5h5M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 21v-5h-5" />
    </>
  ),
  // condivisione: freccia che esce dal riquadro
  share: (
    <>
      <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" />
      <path d="M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2" />
    </>
  ),
  pen: (
    <>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      <path d="m14.5 5.5 3 3" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  pip: (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
      <rect x="12" y="11.5" width="7" height="5" rx="1" />
    </>
  ),
  chat: <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12Z" />,
  layout: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5a6.5 6.5 0 0 1 3 5.5" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  // cornetta abbassata
  leave: (
    <path d="M3.3 14.6a2 2 0 0 1-.5-2.2C4.6 9 8.2 7.5 12 7.5s7.4 1.5 9.2 4.9a2 2 0 0 1-.5 2.2l-1.6 1.5a1.5 1.5 0 0 1-1.9.1l-2.3-1.6a1.5 1.5 0 0 1-.6-1.3V11.6a12 12 0 0 0-4.6 0v1.7a1.5 1.5 0 0 1-.6 1.3l-2.3 1.6a1.5 1.5 0 0 1-1.9-.1Z" />
  ),
};

export default function Icon({ name }: Props) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

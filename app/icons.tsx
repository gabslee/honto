import type { CSSProperties, ReactElement } from "react";

// Inline SVG icons used instead of emoji (product rule: no emoji in the UI).
// Each icon is 1em, inherits currentColor and is hidden from assistive tech;
// the surrounding text carries the meaning.
const PATHS = {
  trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4"/><path d="M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4"/><path d="M8 20h8"/></>,
  mug: <><path d="M5 9h10v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M15 12h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2"/><path d="M5 9a2.5 2.5 0 0 1 3-3.5 3 3 0 0 1 5 0A2.5 2.5 0 0 1 15 9"/><path d="M9 13v4M12 13v4"/></>,
  heart: <path d="M12 20s-7.5-4.6-9.2-9.4A4.6 4.6 0 0 1 12 7.3a4.6 4.6 0 0 1 9.2 3.3C19.5 15.4 12 20 12 20z" fill="currentColor"/>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></>,
  cards: <><rect x="3.5" y="6.5" width="10" height="14" rx="2" transform="rotate(-10 8.5 13.5)"/><rect x="10.5" y="3.5" width="10" height="14" rx="2"/></>,
  chat: <path d="M4 5h16v11H10l-6 4z"/>,
  shot: <><path d="M6 4h12l-2 16H8z"/><path d="M7 9h10"/></>,
  toast: <><path d="M4 3h6l-.6 6.5a2.4 2.4 0 0 1-4.8 0z"/><path d="M14 3h6l-.6 6.5a2.4 2.4 0 0 1-4.8 0z"/><path d="M7 12v8M5 20h4M17 12v8M15 20h4"/></>,
  lie: <><circle cx="10" cy="12" r="7"/><path d="M17 12h5"/><path d="M7.5 10h.01M12.5 10h.01"/><path d="M8 15.5h4"/></>,
  question: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/></>,
  swap: <><path d="M3 12h18"/><path d="M7 8l-4 4 4 4"/><path d="M17 8l4 4-4 4"/></>,
  brain: <><path d="M11 4.5A3 3 0 0 0 6 6.5a3 3 0 0 0-2 5 3 3 0 0 0 1.5 4.6A3 3 0 0 0 11 18.5z"/><path d="M13 4.5a3 3 0 0 1 5 2 3 3 0 0 1 2 5 3 3 0 0 1-1.5 4.6 3 3 0 0 1-5.5 2.4z"/></>,
  target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></>,
  rock: <><rect x="5" y="8" width="14" height="12" rx="4"/><path d="M9 8v4M12 8v4M15 8v4"/><path d="M5 13h4"/></>,
  paper: <path d="M7 13V6.5a1.5 1.5 0 0 1 3 0V11V4.5a1.5 1.5 0 0 1 3 0V11V5.5a1.5 1.5 0 0 1 3 0V13l1.2-1.8a1.5 1.5 0 0 1 2.5 1.6L16.4 19A4 4 0 0 1 13 21h-2a4 4 0 0 1-4-4z"/>,
  scissors: <><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.2 8.2 20 20M8.2 15.8 20 4"/></>,
  swords: <><path d="M4 4l11 11M20 4 9 15"/><path d="M13 17l4-4M11 17l-4-4"/><path d="M16 16l4 4M8 16l-4 4"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14a5 5 0 0 1 4.5 5"/></>,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z"/>,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof PATHS;

const STYLE: CSSProperties = { display: "inline-block", width: "1em", height: "1em", verticalAlign: "-0.125em", flexShrink: 0 };

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={className ? `ui-icon ${className}` : "ui-icon"} data-icon={name} aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={STYLE}>{PATHS[name]}</svg>;
}

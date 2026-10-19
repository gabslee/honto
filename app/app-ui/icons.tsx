import type { ReactElement } from "react";

// Line icons for hontogame.com/app (design/produto/README.md "Ícones"): 24 grid, 1.75 stroke, round caps,
// currentColor, no fill. Brand marks (Google, Apple) are the only filled ones. Decorative by default.
const PATHS = {
  chevronLeft: <path d="M14.5 6 8.5 12l6 6"/>,
  chevronRight: <path d="M9.5 6l6 6-6 6"/>,
  plane: <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7 7.5 6 7.5-6"/></>,
  signOut: <><path d="M14 4.5H7.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14"/><path d="M11 12h9.5M17 8.5l3.5 3.5-3.5 3.5"/></>,
  photo: <><rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.75"/><path d="m4 17.5 5-4.5 3.5 3 3-2.5 4.5 4"/></>,
  phone: <><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5"/>,
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6"/>,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={size <= 16 ? 2 : 1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{PATHS[name]}</svg>;
}

/** Hanko 本: the logo, the Premium seal and the "days together" seal. */
export function Hanko({ size = 28, className }: { size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false"><rect width="28" height="28" rx="6.7" fill="var(--honto-color-accent)"/><rect x="2.2" y="2.2" width="23.6" height="23.6" rx="5.2" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1"/><text x="14" y="19.6" textAnchor="middle" fontSize="16" fontWeight="700" fill="#fff" fontFamily="'Noto Sans JP','Hiragino Sans','Yu Gothic',sans-serif">本</text></svg>;
}

export function GoogleMark({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M21.35 12.27c0-.72-.06-1.42-.18-2.09H12v3.96h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.7 2.91-4.2 2.91-7.26Z"/><path fill="#34A853" d="M12 21.7c2.63 0 4.84-.87 6.45-2.37l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.7-1.72-5.47-4.03H3.29v2.53A9.74 9.74 0 0 0 12 21.7Z"/><path fill="#FBBC05" d="M6.53 13.77A5.85 5.85 0 0 1 6.22 12c0-.62.11-1.22.31-1.77V7.7H3.29A9.74 9.74 0 0 0 2.25 12c0 1.57.38 3.05 1.04 4.3l3.24-2.53Z"/><path fill="#EA4335" d="M12 6.2c1.43 0 2.72.49 3.73 1.45l2.8-2.8C16.84 3.25 14.63 2.3 12 2.3a9.74 9.74 0 0 0-8.71 5.4l3.24 2.53C7.3 7.92 9.46 6.2 12 6.2Z"/></svg>;
}

export function AppleMark({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.05 12.54c-.02-2.15 1.76-3.18 1.84-3.23a3.96 3.96 0 0 0-3.12-1.69c-1.31-.14-2.58.78-3.25.78-.68 0-1.72-.76-2.83-.74a4.17 4.17 0 0 0-3.5 2.14c-1.51 2.62-.38 6.49 1.06 8.62.72 1.04 1.56 2.2 2.67 2.16 1.08-.04 1.49-.69 2.61-.69 1.11 0 1.49.69 2.62.67 1.15-.02 1.88-1.05 2.58-2.1.82-1.2 1.16-2.36 1.18-2.42a3.75 3.75 0 0 1-2.28-3.5ZM14.9 6.22a3.78 3.78 0 0 0 .86-2.73 3.84 3.84 0 0 0-2.48 1.28 3.59 3.59 0 0 0-.88 2.62 3.18 3.18 0 0 0 2.5-1.17Z"/></svg>;
}

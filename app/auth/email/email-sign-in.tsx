"use client";

import { useEffect, useRef, useState } from "react";

type Device = "ios" | "android" | "desktop";
type State = "idle" | "working" | "done" | "error";

const PACKAGE = "com.hontogame.app";
/** Custom scheme fallback for iOS, where a link to the same domain never re-opens the app from Safari. */
const IOS_SCHEME = "honto";

function appLink(device: Device, token: string) {
  const path = `auth/email?token=${encodeURIComponent(token)}`;
  if (device === "android") {
    const fallback = `${window.location.origin}/auth/email?web=1&token=${encodeURIComponent(token)}`;
    return `intent://${window.location.host}/${path}#Intent;scheme=https;package=${PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
  }
  return `${IOS_SCHEME}://${path}`;
}

/** Copy for each verify outcome (the API never returns UI text). */
function failure(status: number) {
  if (status === 429) return "Too many tries. Wait a few minutes and open the link again.";
  if (status === 400 || status === 401) return "This link has expired or was already used. Request a new one.";
  return "Something went wrong. Try again.";
}

export function EmailSignIn({ token, device }: { token: string; device: Device }) {
  const started = useRef(false);
  const [state, setState] = useState<State>(token ? "idle" : "error");
  const [error, setError] = useState(token ? "" : "This sign-in link is incomplete. Request a new one.");

  const signInHere = async () => {
    setState("working");
    try {
      const response = await fetch("/api/v1/auth/email/verify", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ token, platform: "web" }) });
      if (!response.ok) { setError(failure(response.status)); setState("error"); return; }
      setState("done");
      window.location.replace("/app");
    } catch {
      setError(failure(0));
      setState("error");
    }
  };

  useEffect(() => {
    if (device !== "desktop" || !token || started.current) return;
    started.current = true;
    void signInHere();
    // signInHere only reads props that never change on this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, token]);

  const phone = device !== "desktop" && state !== "error";
  return <main className="hm-email">
    <style>{STYLES}</style>
    <section className="hm-email-card" aria-live="polite">
      <Hanko/>
      {state === "error" ? <>
        <h1>Sign-in link</h1>
        <p className="hm-email-error" role="alert">{error}</p>
        <a className="hm-email-button" href="/app">Back to sign in</a>
      </> : phone ? <>
        <h1>Continue in the app</h1>
        <p>Open Honto on this phone to finish signing in. The link works once and expires in 15 minutes.</p>
        <a className="hm-email-button" href={token ? appLink(device, token) : "/app"}>Open Honto</a>
        <button type="button" className="hm-email-link" onClick={signInHere} disabled={state === "working"}>{state === "working" ? "Signing in" : "Sign in on this browser instead"}</button>
      </> : <>
        <h1>{state === "done" ? "You are signed in" : "Signing you in"}</h1>
        <p>{state === "done" ? "Taking you to Honto." : "One moment."}</p>
      </>}
    </section>
  </main>;
}

function Hanko() {
  return <svg className="hm-email-hanko" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
    <rect x="1" y="1" width="42" height="42" rx="10" fill="currentColor"/>
    <rect x="4.5" y="4.5" width="35" height="35" rx="7.5" fill="none" stroke="#FFFCF7" strokeOpacity="0.55" strokeWidth="1.5"/>
    <text x="22" y="29.5" textAnchor="middle" fontSize="20" fontWeight="700" fill="#FFFCF7" fontFamily="'Noto Sans JP', sans-serif">本</text>
  </svg>;
}

const STYLES = `
.hm-email{--paper:#F7F2E9;--card:#FFFCF7;--ink:#17243D;--ink-2:#55607A;--shu:#D2483A;--line:rgba(23,36,61,.1);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif}
@media (prefers-color-scheme:dark){.hm-email{--paper:#0F141E;--card:#1A2130;--ink:#F1ECE3;--ink-2:#B5BAC5;--shu:#E5604E;--line:rgba(255,255,255,.08)}}
.hm-email-card{width:100%;max-width:400px;display:flex;flex-direction:column;align-items:center;gap:16px;padding:40px 24px;border-radius:24px;background:var(--card);border:1px solid var(--line);text-align:center}
.hm-email-hanko{color:var(--shu);margin-bottom:8px}
.hm-email h1{margin:0;font-size:24px;line-height:30px;font-weight:650;letter-spacing:-.01em}
.hm-email p{margin:0;font-size:16px;line-height:23px;color:var(--ink-2)}
.hm-email .hm-email-error{color:var(--shu)}
.hm-email-button{display:flex;align-items:center;justify-content:center;width:100%;height:52px;margin-top:8px;border-radius:26px;background:var(--ink);color:var(--card);font-size:16px;font-weight:600;text-decoration:none}
.hm-email-link{border:0;background:none;padding:8px;color:var(--ink-2);font:inherit;font-size:15px;text-decoration:underline;cursor:pointer}
.hm-email-link:disabled{opacity:.6;cursor:default}
`;

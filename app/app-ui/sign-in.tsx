"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createHontoClient, HontoApiError } from "../../contracts/honto-client";
import { AppleMark, GoogleMark, Hanko, Icon } from "./icons";

const api = createHontoClient();

/** Copy for `/api/v1/auth/email/*` failures. The link itself lands on `/auth/email` (app/auth/email, W1b). */
export function emailErrorMessage(error: unknown, step: "start" | "verify") {
  if (error instanceof HontoApiError) {
    if (error.status === 429) {
      const wait = error.body?.retryAfterSeconds;
      return wait ? `Too many tries. Try again in ${wait} seconds.` : "Too many tries. Try again in a minute.";
    }
    if (error.status === 404 || error.status === 405 || error.status === 503) return "Email sign-in is not available right now. Use Apple or Google for now.";
    if (step === "start" && error.status === 400) return "Enter a valid email address.";
    if (step === "verify" && (error.status === 400 || error.status === 401)) return "That code is not right or has expired.";
  }
  // A non-JSON answer means `/api/v1/auth/email/*` failed upstream (or is not deployed on this preview).
  if (error instanceof SyntaxError) return "Email sign-in is not available right now. Use Apple or Google for now.";
  return "Something went wrong. Try again.";
}

/** Signed-out state of /app: Apple, Google (existing web flows) or an email magic link with a 6-digit code. */
export function SignInCard({ appleConfigured }: { appleConfigured: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const start = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      await api("startEmailSignIn", { body: { email: email.trim(), platform: "web", locale: "en" } });
      setSentTo(email.trim());
    } catch (cause) {
      setError(emailErrorMessage(cause, "start"));
    } finally { setBusy(false); }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!sentTo) return;
    setBusy(true); setError("");
    try {
      await api("verifyEmailSignIn", { body: { email: sentTo, code: code.replace(/\D/g, ""), platform: "web" } });
      router.refresh();
    } catch (cause) {
      setError(emailErrorMessage(cause, "verify"));
      setBusy(false);
    }
  };

  return <section className="ha-card ha-signin" aria-labelledby="ha-signin-title">
    <Hanko size={44}/>
    <h1 id="ha-signin-title">Your memories, on the web</h1>
    <p className="ha-muted">Sign in with the account you use in the Honto app.</p>
    {sentTo ? <form className="ha-form" onSubmit={verify}>
      <p className="ha-sent"><Icon name="mail" size={18}/><span>We sent a link to <strong>{sentTo}</strong>. Open it on this device, or enter the 6-digit code. It expires in 15 minutes.</span></p>
      <label className="ha-field"><span>Code</span><input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} placeholder="123456" required/></label>
      {error && <p className="ha-error" role="alert">{error}</p>}
      <button className="ha-button is-primary" disabled={busy}>{busy ? "Checking" : "Sign in"}</button>
      <button type="button" className="ha-link" onClick={() => { setSentTo(null); setCode(""); setError(""); }}>Use a different email</button>
    </form> : <>
      <div className="ha-providers">
        {appleConfigured && <a className="ha-button is-apple" href="/api/auth/apple/start?return_to=/app"><AppleMark/>Continue with Apple</a>}
        <a className="ha-button" href="/api/auth/google/start?return_to=/app"><GoogleMark/>Continue with Google</a>
      </div>
      <p className="ha-divider"><span>or</span></p>
      <form className="ha-form" onSubmit={start}>
        <label className="ha-field"><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" maxLength={254} required/></label>
        {error && <p className="ha-error" role="alert">{error}</p>}
        <button className="ha-button is-primary" disabled={busy}><Icon name="mail" size={18}/>{busy ? "Sending" : "Email me a sign-in link"}</button>
      </form>
    </>}
  </section>;
}

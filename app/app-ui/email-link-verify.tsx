"use client";

import { useEffect, useRef, useState } from "react";
import { createHontoClient } from "../../contracts/honto-client";
import { Icon } from "./icons";
import { emailErrorMessage } from "./sign-in";

/** Web landing of the magic link (`/auth/email?token=…`): exchanges the token for the `honto_session` cookie. */
export function EmailLinkVerify({ token }: { token: string }) {
  const started = useRef(false);
  const [error, setError] = useState(token ? "" : "This sign-in link is incomplete. Request a new one.");
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    createHontoClient()("verifyEmailSignIn", { body: { token, platform: "web" } })
      .then(() => window.location.replace("/app"))
      .catch((cause) => setError(emailErrorMessage(cause, "link")));
  }, [token]);
  return <section className="ha-card ha-state" aria-live="polite">
    <span className="ha-state-icon"><Icon name="mail" size={22}/></span>
    <h1>{error ? "Sign-in link" : "Signing you in"}</h1>
    {error ? <><p className="ha-error" role="alert">{error}</p><a className="ha-button is-primary" href="/app">Back to sign in</a></> : <p className="ha-muted">One moment.</p>}
  </section>;
}

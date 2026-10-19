"use client";

import { useState } from "react";
import { Icon } from "./icons";

/** Clears the web session via `/api/v1/auth/logout`, falling back to the existing `/api/auth/logout`. */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    const v1 = await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" }).catch(() => null);
    if (!v1?.ok) await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => null);
    window.location.assign("/app");
  };
  return <button type="button" className="ha-button is-quiet" onClick={() => void signOut()} disabled={busy}><Icon name="signOut" size={18}/>{busy ? "Signing out" : "Sign out"}</button>;
}

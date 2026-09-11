"use client";

import { FormEvent, useEffect, useState } from "react";

type Metrics = { users: number; rooms: number; activeRooms: number; players: number; aiUses: number };

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => { const response = await fetch("/api/admin", { cache: "no-store" }); const data = await response.json(); if (response.ok) { setMetrics(data.metrics); setEmail(data.user.email); } };
  useEffect(() => { void load(); }, []);
  const login = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { const response = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "login", token }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Login failed."); setEmail(data.user.email); setToken(""); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Login failed."); } finally { setBusy(false); } };
  if (!metrics) return <main style={{ maxWidth: 560, margin: "12vh auto", padding: 24 }}><h1>Honto admin</h1><p>Restricted dashboard.</p><form onSubmit={login}><label>Admin access token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} required style={{ display: "block", width: "100%", margin: "8px 0 16px", padding: 12 }} /></label>{error && <p role="alert">{error}</p>}<button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form></main>;
  return <main style={{ maxWidth: 900, margin: "8vh auto", padding: 24 }}><p>Signed in as {email}</p><h1>Honto admin</h1><section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 16 }}>{Object.entries(metrics).map(([key, value]) => <article key={key} style={{ border: "2px solid currentColor", borderRadius: 12, padding: 18 }}><small>{key}</small><strong style={{ display: "block", fontSize: 32 }}>{value}</strong></article>)}</section><button style={{ marginTop: 24 }} onClick={async () => { await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "logout" }) }); location.reload(); }}>Sign out</button></main>;
}

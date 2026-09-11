"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Metrics = { users: number; rooms: number; activeRooms: number; players: number; aiUses: number };
type Lists = Record<keyof Metrics, Array<Record<string, unknown>>>;
type Filter = keyof Metrics;
const labels: Record<Filter, string> = { users: "Users", rooms: "Rooms", activeRooms: "Active rooms", players: "Players", aiUses: "AI uses" };
function formatValue(value: unknown) { if (value === null || value === undefined) return "—"; if (typeof value === "boolean") return value ? "Yes" : "No"; if (typeof value === "string" && value.length > 22) return new Date(value).toLocaleString(); return String(value); }
function DataTable({ rows }: { rows: Array<Record<string, unknown>> }) { if (!rows.length) return <p className="admin-empty">No records yet.</p>; const columns = Object.keys(rows[0]); return <div className="admin-table-wrap"><table className="admin-table"><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.scopeKey ?? index)}>{columns.map((column) => <td key={column}>{formatValue(row[column])}</td>)}</tr>)}</tbody></table></div>; }

export default function AdminPage() {
  const [token, setToken] = useState(""); const [metrics, setMetrics] = useState<Metrics | null>(null); const [lists, setLists] = useState<Lists | null>(null); const [email, setEmail] = useState(""); const [filter, setFilter] = useState<Filter>("users"); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const load = async () => { const response = await fetch("/api/admin", { cache: "no-store" }); const data = await response.json(); if (response.ok) { setMetrics(data.metrics); setLists(data.lists); setEmail(data.user.email); } else setError(data.error ?? "Admin authentication required."); };
  useEffect(() => { void load(); }, []);
  const login = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(""); try { const response = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "login", token }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Login failed."); setEmail(data.user.email); setToken(""); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Login failed."); } finally { setBusy(false); } };
  const selectedRows = useMemo(() => lists?.[filter] ?? [], [lists, filter]);
  if (!metrics || !lists) return <main className="admin-page admin-login"><h1>Honto admin</h1><p>Restricted dashboard.</p><form onSubmit={login}><label>Admin access token<input type="password" value={token} onChange={(event) => setToken(event.target.value)} required /></label>{error && <p role="alert">{error}</p>}<button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button></form></main>;
  return <main className="admin-page"><header className="admin-header"><div><p>Signed in as {email}</p><h1>Honto admin</h1></div><a className="admin-back" href="/">← Back to Honto</a></header><section className="admin-metrics">{(Object.keys(metrics) as Filter[]).map((key) => <button type="button" key={key} className={`admin-metric ${filter === key ? "selected" : ""}`} onClick={() => setFilter(key)}><small>{labels[key]}</small><strong>{metrics[key]}</strong><span>View list →</span></button>)}</section><section className="admin-list"><div className="admin-list-heading"><h2>{labels[filter]}</h2><span>{selectedRows.length} shown</span></div><DataTable rows={selectedRows}/></section></main>;
}

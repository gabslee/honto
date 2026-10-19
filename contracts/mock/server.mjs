#!/usr/bin/env node
// Fixture-backed mock of /api/v1 for app and web development. No dependencies beyond `yaml`.
//   npm run contracts:mock                 -> http://localhost:4010
//   PORT=5000 node contracts/mock/server.mjs
// Choose a variant per request with header `x-honto-fixture: <status>[.<variant>]` or query `?__fixture=`,
// e.g. `x-honto-fixture: 200.free_no_photos` on GET /api/v1/today, or `409` on POST /api/v1/couple/join.
// Request bodies are validated against the spec (400 with the problems). Auth: any `Bearer hm_u_…` or
// `honto_session` cookie is accepted; missing credentials on protected routes -> 401.
import { createServer } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contractsDir, loadSpec, operations } from "../scripts/spec.mjs";
import { schemaRef, validate } from "../scripts/validate-schema.mjs";

const spec = loadSpec();
const ops = operations(spec).map((op) => ({ ...op, regex: new RegExp(`^${op.path.replace(/\{(\w+)\}/g, "(?<$1>[^/]+)")}$`) }));
const fixtureDir = join(contractsDir, "fixtures");
const fixtures = new Map(readdirSync(fixtureDir).filter((f) => f.endsWith(".json")).map((f) => [f.replace(/\.json$/, ""), JSON.parse(readFileSync(join(fixtureDir, f), "utf8"))]));

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const apiError = (code, error) => ({ error, code });

export function handle(method, url, headers, rawBody) {
  const { pathname, searchParams } = new URL(url, "http://mock");
  const op = ops.find((o) => o.method === method && o.regex.test(pathname));
  if (!op) return { status: 404, body: apiError("not_found", `No route ${method} ${pathname}`) };
  const needsAuth = op.security.length > 0;
  const authed = /^Bearer hm_u_/.test(headers.authorization ?? "") || /(^|;\s*)honto_session=/.test(headers.cookie ?? "") || (op.security.some((s) => s.revenueCatAuth || s.cronAuth) && Boolean(headers.authorization));
  if (needsAuth && !authed) return { status: 401, body: apiError("unauthorized", "Missing or invalid credentials.") };
  for (const p of op.queryParams) if (p.required && !searchParams.get(p.name)) return { status: 400, body: apiError("bad_request", `Missing query parameter ${p.name}.`) };
  if (op.body) {
    let body;
    try { body = rawBody ? JSON.parse(rawBody) : undefined; } catch { return { status: 400, body: apiError("bad_request", "Body is not valid JSON.") }; }
    if (body === undefined && op.bodyRequired) return { status: 400, body: apiError("bad_request", "Missing JSON body.") };
    const problems = body === undefined ? [] : validate(spec, schemaRef(op.body), body);
    if (problems.length) return { status: 400, body: { ...apiError("bad_request", "Request does not match the contract."), problems } };
  }
  const wanted = headers["x-honto-fixture"] ?? searchParams.get("__fixture");
  if (wanted) {
    const status = Number(wanted.split(".")[0]);
    if (fixtures.has(`${op.id}.${wanted}`)) return { status, body: fixtures.get(`${op.id}.${wanted}`), fixture: `${op.id}.${wanted}` };
    if (status && !(String(status) in op.responses)) return { status: 400, body: apiError("bad_request", `${op.id} has no ${status} response in the spec.`) };
    if (status && op.responses[String(status)] === null) return { status };
    return { status: 400, body: apiError("bad_request", `No fixture ${op.id}.${wanted}.json`) };
  }
  for (const status of op.successStatuses) {
    if (op.responses[status] === null) return { status: Number(status) };
    if (fixtures.has(`${op.id}.${status}`)) return { status: Number(status), body: fixtures.get(`${op.id}.${status}`), fixture: `${op.id}.${status}` };
  }
  return { status: 500, body: apiError("internal", `No default fixture for ${op.id}`) };
}

export function createMockServer({ log = false } = {}) {
  return createServer((req, res) => {
    if (req.method === "OPTIONS") return send(res, 204, undefined, { "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE", "Access-Control-Allow-Headers": "authorization,content-type,x-honto-fixture" });
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const result = handle(req.method, req.url, req.headers, raw);
      const headers = result.fixture ? { "x-honto-fixture-served": result.fixture } : {};
      if (result.status === 429) headers["Retry-After"] = String(result.body?.retryAfterSeconds ?? 60);
      if (log) console.log(`${req.method} ${req.url} -> ${result.status}${result.fixture ? ` (${result.fixture})` : ""}`);
      send(res, result.status, result.body, headers);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4010);
  createMockServer({ log: true }).listen(port, () => console.log(`Honto mock API on http://localhost:${port} (${ops.length} operations, ${fixtures.size} fixtures)`));
}

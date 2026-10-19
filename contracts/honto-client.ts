// Typed fetch client for /api/v1 (web `hontogame.com/app` and any TS consumer). Hand-written; the types and
// the route table come from the generated ./honto-api.
import { operations, type ApiError, type OperationId, type Operations, type SuccessBody } from "./honto-api";

type Part<K extends string, T> = [T] extends [never] ? { [P in K]?: never } : { [P in K]: T };

export type RequestOptions<Op extends OperationId> = Part<"pathParams", Operations[Op]["pathParams"]> &
  Part<"query", Operations[Op]["query"]> &
  Part<"body", Operations[Op]["body"]> & { headers?: Record<string, string>; signal?: AbortSignal };

export class HontoApiError extends Error {
  readonly status: number;
  readonly body: ApiError | null;
  constructor(status: number, body: ApiError | null) {
    super(body?.error ?? `HTTP ${status}`);
    this.name = "HontoApiError";
    this.status = status;
    this.body = body;
  }
  get code() { return this.body?.code ?? null; }
}

export type HontoClientConfig = {
  /** e.g. https://hontogame.com, http://localhost:4010 (mock) or "" for same-origin. */
  baseUrl?: string;
  /** `hm_u_…`; omit on the web, where the `honto_session` cookie is sent instead. */
  token?: string | (() => string | null | undefined);
  fetch?: typeof fetch;
};

export function buildPath<Op extends OperationId>(op: Op, pathParams?: Record<string, string>) {
  return operations[op].path.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = pathParams?.[name];
    if (value === undefined) throw new Error(`${op}: missing path parameter ${name}`);
    return encodeURIComponent(value);
  });
}

export function createHontoClient(config: HontoClientConfig = {}) {
  const doFetch = config.fetch ?? fetch;
  return async function call<Op extends OperationId>(op: Op, options: RequestOptions<Op> = {} as RequestOptions<Op>): Promise<SuccessBody<Op>> {
    const route = operations[op];
    const query = options.query ? `?${new URLSearchParams(options.query as Record<string, string>)}` : "";
    const url = `${config.baseUrl ?? ""}${buildPath(op, options.pathParams as Record<string, string> | undefined)}${query}`;
    const token = typeof config.token === "function" ? config.token() : config.token;
    const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await doFetch(url, {
      method: route.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: token ? "omit" : "include",
      signal: options.signal,
    });
    if (response.status === 204 || response.status === 304) return undefined as SuccessBody<Op>;
    const text = await response.text();
    const json: unknown = text ? JSON.parse(text) : null;
    if (!response.ok) throw new HontoApiError(response.status, (json as ApiError | null) ?? null);
    return json as SuccessBody<Op>;
  };
}

export type HontoClient = ReturnType<typeof createHontoClient>;

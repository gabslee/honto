// Shared helpers: load the OpenAPI spec and walk schemas/operations.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import YAML from "yaml";

export const contractsDir = join(dirname(fileURLToPath(import.meta.url)), "..");
export const specPath = join(contractsDir, "openapi.yaml");

export function loadSpec() {
  return YAML.parse(readFileSync(specPath, "utf8"));
}

/** Names that would clash with language built-ins (Error in TS and Dart). */
const RENAMES = { Error: "ApiError" };
export const typeName = (schemaName) => RENAMES[schemaName] ?? schemaName;
export const refName = (ref) => ref.replace("#/components/schemas/", "");

export function resolveRef(spec, ref) {
  const parts = ref.replace(/^#\//, "").split("/");
  let node = spec;
  for (const part of parts) node = node?.[part];
  if (node === undefined) throw new Error(`Unresolved $ref ${ref}`);
  return node;
}

/** Normalizes a property schema into { kind, nullable, ... }. */
export function describe(schema) {
  if (schema.$ref) return { kind: "ref", name: refName(schema.$ref), nullable: false };
  if (schema.anyOf) {
    const nonNull = schema.anyOf.filter((s) => s.type !== "null");
    if (nonNull.length !== 1 || schema.anyOf.length !== 2 || !nonNull[0].$ref) throw new Error(`Unsupported anyOf ${JSON.stringify(schema)}`);
    return { kind: "ref", name: refName(nonNull[0].$ref), nullable: true };
  }
  if (schema.oneOf || schema.allOf) throw new Error("oneOf/allOf are not supported by the generators; use named schemas.");
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const nullable = types.includes("null");
  const base = types.filter((t) => t !== "null");
  if (base.length !== 1) throw new Error(`Unsupported type ${JSON.stringify(schema)}`);
  const type = base[0];
  if (schema.enum && type !== undefined) throw new Error(`Inline enums are not allowed (make it a named schema): ${JSON.stringify(schema.enum)}`);
  if (type === "array") return { kind: "array", items: describe(schema.items), nullable };
  if (type === "object") {
    if (schema.properties) throw new Error("Inline objects with properties are not allowed; make it a named schema.");
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") return { kind: "map", values: describe(schema.additionalProperties), nullable };
    return { kind: "map", values: { kind: "unknown", nullable: true }, nullable };
  }
  if (type === "string") return { kind: schema.format === "date-time" ? "datetime" : "string", nullable };
  if (type === "integer") return { kind: "int", nullable };
  if (type === "number") return { kind: "double", nullable };
  if (type === "boolean") return { kind: "bool", nullable };
  throw new Error(`Unsupported schema ${JSON.stringify(schema)}`);
}

export function schemaKind(schema) {
  if (schema.enum) return "enum";
  if (schema.type === "object") return "object";
  return "alias";
}

export const HTTP_METHODS = ["get", "put", "post", "patch", "delete"];

/** Flattens operations with resolved request/response schema names. */
export function operations(spec) {
  const out = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((p) => (p.$ref ? resolveRef(spec, p.$ref) : p));
      const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
      const responses = {};
      for (const [status, resp0] of Object.entries(op.responses)) {
        const resp = resp0.$ref ? resolveRef(spec, resp0.$ref) : resp0;
        const schema = resp.content?.["application/json"]?.schema;
        responses[status] = schema ? refName(schema.$ref) : null;
      }
      const success = Object.keys(responses).filter((s) => s.startsWith("2"));
      out.push({
        id: op.operationId, method: method.toUpperCase(), path, tags: op.tags ?? [], summary: op.summary ?? "",
        security: op.security ?? spec.security,
        pathParams: params.filter((p) => p.in === "path"),
        queryParams: params.filter((p) => p.in === "query"),
        body: bodySchema ? refName(bodySchema.$ref) : null,
        bodyRequired: Boolean(op.requestBody?.required),
        responses, successStatuses: success,
        successSchema: success.map((s) => responses[s]).find(Boolean) ?? null,
      });
    }
  }
  return out;
}

/** Ops exposed to app clients (Dart / TS client); webhook + cron are server-to-server. */
export const isClientOp = (op) => !op.tags.includes("billing") && !op.tags.includes("cron");

/**
 * Maps a fixture file name (without .json) to the schema it must satisfy.
 *   <operationId>.<status>[.<variant>]   response body of that status (null schema = must not exist)
 *   <operationId>.request[.<variant>]    request body
 *   schema.<SchemaName>[.<variant>]      any named schema (push payloads, widget snapshot, ...)
 */
export function fixtureSchema(spec, ops, key) {
  const [head, second] = key.split(".");
  if (head === "schema") {
    if (!spec.components.schemas[second]) throw new Error(`Fixture ${key}: unknown schema ${second}`);
    return second;
  }
  const op = ops.find((o) => o.id === head);
  if (!op) throw new Error(`Fixture ${key}: unknown operationId ${head}`);
  if (second === "request") {
    if (!op.body) throw new Error(`Fixture ${key}: ${head} has no request body`);
    return op.body;
  }
  if (!(second in op.responses)) throw new Error(`Fixture ${key}: ${head} has no ${second} response`);
  if (!op.responses[second]) throw new Error(`Fixture ${key}: ${head} ${second} has no body`);
  return op.responses[second];
}

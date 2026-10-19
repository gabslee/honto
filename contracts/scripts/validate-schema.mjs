// Minimal validator for the JSON Schema subset used by contracts/openapi.yaml (no dependencies).
// strict = objects without `additionalProperties` are treated as closed (catches typos in fixtures/requests).
import { resolveRef } from "./spec.mjs";

const FORMATS = {
  "date-time": (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v) && !Number.isNaN(Date.parse(v)),
  date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)),
  uuid: (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  uri: (v) => { try { return Boolean(new URL(v).protocol); } catch { return false; } },
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
};
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);

export function validate(spec, schema, value, { strict = true } = {}, path = "$") {
  const errors = [];
  const fail = (msg) => errors.push(`${path}: ${msg}`);
  if (schema.$ref) return validate(spec, resolveRef(spec, schema.$ref), value, { strict }, path);
  if (schema.anyOf) {
    const results = schema.anyOf.map((s) => validate(spec, s, value, { strict }, path));
    if (!results.some((r) => r.length === 0)) errors.push(...results.flat());
    return errors;
  }
  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const ok = allowed.includes(actual) || (actual === "integer" && allowed.includes("number"));
    if (!ok) { fail(`expected ${allowed.join("|")}, got ${actual}`); return errors; }
  }
  if (value === null) return errors;
  if (schema.enum && !schema.enum.includes(value)) fail(`${JSON.stringify(value)} not in enum [${schema.enum.join(", ")}]`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && [...value].length < schema.minLength) fail(`shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength) fail(`longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) fail(`does not match ${schema.pattern}`);
    if (schema.format && FORMATS[schema.format] && !FORMATS[schema.format](value)) fail(`invalid ${schema.format}: ${value}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`< ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`> ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail(`more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => errors.push(...validate(spec, schema.items, item, { strict }, `${path}[${i}]`)));
  }
  if (typeOf(value) === "object") {
    for (const req of schema.required ?? []) if (!(req in value)) fail(`missing required "${req}"`);
    const props = schema.properties ?? {};
    for (const [key, v] of Object.entries(value)) {
      if (props[key]) errors.push(...validate(spec, props[key], v, { strict }, `${path}.${key}`));
      else if (typeof schema.additionalProperties === "object") errors.push(...validate(spec, schema.additionalProperties, v, { strict }, `${path}.${key}`));
      else if (schema.additionalProperties === false || (strict && schema.additionalProperties === undefined)) fail(`unexpected property "${key}"`);
    }
  }
  return errors;
}

export const schemaRef = (name) => ({ $ref: `#/components/schemas/${name}` });

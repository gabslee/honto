#!/usr/bin/env node
// Validates every contracts/fixtures/*.json against the schema implied by its file name.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { contractsDir, fixtureSchema, loadSpec, operations } from "./spec.mjs";
import { schemaRef, validate } from "./validate-schema.mjs";

export function validateFixtures() {
  const spec = loadSpec();
  const ops = operations(spec);
  const dir = join(contractsDir, "fixtures");
  const problems = [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  for (const f of files) {
    const key = f.replace(/\.json$/, "");
    try {
      const schema = fixtureSchema(spec, ops, key);
      const errors = validate(spec, schemaRef(schema), JSON.parse(readFileSync(join(dir, f), "utf8")));
      for (const e of errors) problems.push(`${f} (${schema}) ${e}`);
    } catch (error) { problems.push(`${f}: ${error.message}`); }
  }
  // Every client operation needs a default 2xx fixture (unless it has no body) so fakes can serve it.
  for (const op of ops) {
    for (const status of op.successStatuses) {
      if (!op.responses[status]) continue;
      if (files.some((f) => f.startsWith(`${op.id}.${status}`))) { break; }
      if (status === op.successStatuses.filter((s) => op.responses[s]).at(-1)) problems.push(`missing fixture ${op.id}.<2xx>.json`);
    }
    if (op.body && !files.some((f) => f.startsWith(`${op.id}.request`))) problems.push(`missing request fixture ${op.id}.request.json`);
  }
  return { files: files.length, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { files, problems } = validateFixtures();
  if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
  console.log(`contracts: ${files} fixtures valid`);
}

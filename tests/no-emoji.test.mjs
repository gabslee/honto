import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Product rule: no emoji anywhere in the product. Use the inline SVG icons in app/icons.tsx.
// Digits, #, * and (c)/(R)/TM carry the Emoji property but are ordinary text, so they are allowed.
const EMOJI = /(?![0-9#*\u00A9\u00AE\u2122])\p{Emoji}|\u{FE0F}|\u{200D}/u;
const ROOTS = ["app", "server", "data", "components"];
const TEXT = /\.(?:tsx?|jsx?|mjs|cjs|css|json|md|html|txt|svg)$/;

async function* files(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (TEXT.test(entry.name)) yield path;
  }
}

test("product source contains no emoji", async () => {
  const offenders = [];
  for (const root of ROOTS) {
    for await (const path of files(new URL(`../${root}`, import.meta.url).pathname)) {
      const lines = (await readFile(path, "utf8")).split("\n");
      lines.forEach((line, i) => {
        const match = line.match(EMOJI);
        if (match) offenders.push(`${path.split("/").slice(-3).join("/")}:${i + 1} U+${match[0].codePointAt(0).toString(16).toUpperCase()}`);
      });
    }
  }
  assert.deepEqual(offenders, []);
});

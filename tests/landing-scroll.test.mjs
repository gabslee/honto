import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(root, "app/globals.css"), "utf8");

test("landing scrolls: no viewport-height lock with hidden overflow on .landing", () => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.split(",").some((part) => part.trim() === ".landing"));
  assert.ok(rules.length > 0);
  for (const [, selector, body] of rules) {
    assert.doesNotMatch(body, /(^|;|\s)height:\s*100(s|d)?vh/, `fixed height on ${selector.trim()}`);
    assert.doesNotMatch(body, /(^|;|\s)overflow(-y)?:\s*hidden/, `overflow hidden on ${selector.trim()}`);
  }
});

test("scroll lock stays scoped to the room/game shell", () => {
  assert.match(css, /body:has\(\.app-shell\)\s*\{[^}]*overflow:hidden/);
  assert.match(css, /\.app-shell \{[^}]*height:100svh[^}]*overflow:hidden/);
  assert.doesNotMatch(css, /(^|[}\s])(html|body)\s*\{[^}]*overflow(-y)?:\s*hidden/);
});

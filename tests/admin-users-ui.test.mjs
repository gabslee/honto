import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/admin/page.tsx", import.meta.url), "utf8");

test("admin user editor keeps edits in draft state so the editor updates live", () => {
  assert.doesNotMatch(source, /\brow\.(role|plan|subscriptionStatus|subscriptionExpiresAt)\s*=(?!=)/, "edits must not mutate the saved row object");
  assert.match(source, /useState<Record<string, unknown> \| null>\(null\)/, "editor should hold a draft state");
  assert.match(source, /updateDraft\("plan"/);
  assert.match(source, />Cancel</, "editor should offer Cancel to discard the draft");
});

test("admin users page deletes an account only after the admin types its email in a confirm dialog", () => {
  assert.match(source, /role="dialog"/, "deletion asks in a dialog");
  assert.match(source, />Delete</, "each user row has a Delete button");
  assert.match(source, /action: "deleteUser", userId: row\.id, confirmEmail/, "posts deleteUser with the typed email");
  assert.match(source, /disabled=\{!matches \|\| busy\}/, "the confirm button stays disabled until the email matches");
});

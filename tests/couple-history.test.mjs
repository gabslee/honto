import test from "node:test";
import assert from "node:assert/strict";
import { validReunionDate, daysUntil, summarizeMoment } from "../app/couple-history.js";

test("reunion date validation and countdown in the viewer's local day", () => {
  assert.equal(validReunionDate("2026-12-24"), true);
  assert.equal(validReunionDate(null), true);
  assert.equal(validReunionDate("2026-02-30"), false);
  assert.equal(validReunionDate("24/12/2026"), false);
  assert.equal(daysUntil("2026-12-24", "2026-12-14"), 10);
  assert.equal(daysUntil("2026-12-24", "2026-12-24"), 0);
  assert.equal(daysUntil(null, "2026-12-24"), null);
});

test("game moments are summarized for the shared history", () => {
  assert.deepEqual(summarizeMoment({ type: "wouldrather", payload: { options: ["A", "B"] }, result: { wouldRatherIndex: 0 } }), { prompt: "A / B", answer: "A" });
  assert.equal(summarizeMoment({ type: "honto", payload: { statements: ["x", "y", "z"] }, secret: { truthIndex: 2 }, actorName: "Ana" }).answer, "z");
  assert.equal(summarizeMoment({ type: "rps" }), null);
});

// Couple history helpers (pure): reunion countdown and moment summaries.

export function validReunionDate(value) {
  if (value === null || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Whole days from `today` (YYYY-MM-DD, the viewer's local day) until the reunion date. */
export function daysUntil(reunionDate, today) {
  if (!reunionDate || !today) return null;
  const ms = new Date(`${reunionDate}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime();
  return Math.round(ms / 86400000);
}

/** A short, language-neutral summary of a completed game card for the couple history. */
export function summarizeMoment({ type, payload = {}, result = {}, secret = {}, actorName, targetName }) {
  if (type === "honto") return { prompt: `${actorName}: ${(payload.statements ?? []).join(" / ")}`, answer: payload.statements?.[secret.truthIndex ?? -1] ?? null };
  if (type === "question") return { prompt: payload.question ?? "", answer: result.choice === "answer" ? `${targetName} ✓` : `${targetName} ↷` };
  if (type === "wouldrather") return { prompt: (payload.options ?? []).join(" / "), answer: result.skipped ? null : payload.options?.[result.wouldRatherIndex ?? -1] ?? null };
  if (type === "preference") return { prompt: payload.question ?? (payload.options ?? []).join(" / "), answer: payload.options?.[secret.preferenceIndex ?? -1] ?? null };
  if (type === "estimate") return { prompt: payload.question ?? "", answer: result.correctNumber != null ? String(result.correctNumber) : null };
  return null;
}

export function makeRoomCode(words, random = Math.random) {
  const first = words[Math.floor(random() * words.length)];
  const second = words[Math.floor(random() * words.length)];
  const suffix = Math.floor(100 + random() * 900);
  return `${first}-${second}-${suffix}`;
}

export function normalizeRoomSettings(room, body, themeMap) {
  const roundCount = body.roundCount === undefined
    ? Number(room.round_count)
    : Number.isInteger(body.roundCount)
      ? Math.max(6, Math.min(60, Number(body.roundCount)))
      : Number(room.round_count);
  const selected = typeof body.themeCategory === "string"
    ? body.themeCategory.split(",").map((item) => themeMap[item.trim()]).filter(Boolean)
    : null;
  const themeCategory = selected ? [...new Set(selected)].join(",") || "safe" : room.theme_category;
  const customTheme = Object.prototype.hasOwnProperty.call(body, "customTheme")
    ? typeof body.customTheme === "string" ? body.customTheme.trim().slice(0, 80) || null : null
    : room.custom_theme;
  const locale = body.locale === "ja" || body.locale === "pt-BR" || body.locale === "en" ? body.locale : room.locale === "ja" || room.locale === "pt-BR" ? room.locale : "en";
  return { roundCount, themeCategory, customTheme, locale };
}

/**
 * Once an estimate question is changed, it is shared verbatim by both players.
 * Keeping the deck's original localized copy would make publicCard overwrite the
 * new question with the initial suggestion for viewers in that locale.
 */
export function replaceEstimateQuestion(payload, question) {
  const { localized: _localized, options: _options, ...current } = payload ?? {};
  return { ...current, question, wrongGuesses: [] };
}

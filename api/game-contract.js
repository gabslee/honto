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
  const locale = body.locale === "ja" ? "ja" : body.locale === "en" ? "en" : room.locale === "ja" ? "ja" : "en";
  return { roundCount, themeCategory, customTheme, locale };
}

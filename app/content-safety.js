// Server-side content rules for AI generated cards.
// Adult content is only allowed when the room's saved deck (server state) includes Spicy 18+.

export function deckAllowsAdultContent(themeCategory) {
  if (typeof themeCategory !== "string") return false;
  return themeCategory.split(",").map((key) => key.trim()).includes("spicy");
}

export const SAFE_FOR_WORK_INSTRUCTION = "This deck is NOT the Spicy 18+ deck. Keep everything strictly safe for work and suitable for a general audience: no sex, sexual acts, nudity, bedroom or hookup stories, sexual body parts, fetishes, sexual innuendo, or explicit romance. Light everyday romance such as dates, crushes, or missing each other is fine. If the player's truth is sexual or explicit, do not mirror that tone: write wholesome everyday lies instead.";
export const SPICY_INSTRUCTION = "This is the Spicy 18+ deck for consenting adults. Content may be intimate or sexual, but keep it non graphic and never involve minors, coercion, exploitation, incest, or violence.";

const SEXUAL_TERMS = [
  "sex", "sexy", "sexual", "sexually", "sexting", "sext", "nude", "nudes", "naked", "nudity", "orgasm", "orgasms", "porn", "porno", "pornography",
  "erotic", "kinky", "kink", "fetish", "foreplay", "threesome", "hookup", "hookups", "hooked up", "one night stand", "one-night stand",
  "aroused", "arousal", "horny", "lingerie", "condom", "condoms", "strip club", "stripper", "striptease", "make out", "made out", "making out",
  "slept with", "sleep with", "sleeping with", "had sex", "in bed with", "under the sheets", "between the sheets", "blowjob", "handjob",
  "genitals", "penis", "vagina", "boobs", "breasts", "nipple", "nipples", "dildo", "vibrator", "sex toy", "masturbate", "masturbated", "masturbation",
  "booty call", "friends with benefits", "skinny dipping", "skinny dipped", "seduce", "seduced", "seduction", "intercourse", "quickie",
  // Japanese and Portuguese essentials
  "セックス", "エッチ", "裸", "ヌード", "アダルト", "性的", "ベッドで", "sexo", "transar", "transamos", "pelado", "pelada", "nua", "nudes", "safado", "safada",
];

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const latinPattern = new RegExp(`\\b(?:${SEXUAL_TERMS.filter((t) => /^[ -~]+$/.test(t)).map((t) => escape(t).replace(/[ -]/g, "[\\s-]+")).join("|")})\\b`, "i");
const otherTerms = SEXUAL_TERMS.filter((t) => !/^[ -~]+$/.test(t));

export function containsSexualContent(text) {
  if (typeof text !== "string" || !text) return false;
  if (latinPattern.test(text)) return true;
  return otherTerms.some((term) => text.toLowerCase().includes(term.toLowerCase()));
}

export function anySexualContent(items) {
  return Array.isArray(items) && items.some((item) => containsSexualContent(item));
}

// Never forward an adult category unless the server-side deck allows it.
export function allowedCategories(requested, adultAllowed) {
  const list = Array.isArray(requested) ? requested : typeof requested === "string" ? requested.split(",") : [];
  const filtered = list.map((key) => String(key).trim()).filter(Boolean).filter((key) => adultAllowed || key !== "spicy");
  return filtered.length ? filtered : ["general"];
}

// Photo moments: validation and the Japanese-themed phrases a photo can carry (pure, testable).
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

export const JAPANESE_PHRASES = [
  { key: "aitai", ja: "会いたい", romaji: "aitai", en: "I miss you", pt: "Saudade de você" },
  { key: "daisuki", ja: "大好き", romaji: "daisuki", en: "I love you so much", pt: "Te amo muito" },
  { key: "oyasumi", ja: "おやすみ", romaji: "oyasumi", en: "Good night", pt: "Boa noite" },
  { key: "ohayou", ja: "おはよう", romaji: "ohayō", en: "Good morning", pt: "Bom dia" },
  { key: "zutto-issho", ja: "ずっと一緒", romaji: "zutto issho", en: "Together forever", pt: "Juntos para sempre" },
  { key: "tsuki-ga-kirei", ja: "月が綺麗ですね", romaji: "tsuki ga kirei desu ne", en: "The moon is beautiful tonight", pt: "A lua está linda hoje" },
  { key: "omoide", ja: "思い出", romaji: "omoide", en: "A memory for us", pt: "Uma lembrança nossa" },
  { key: "mou-sugu", ja: "もうすぐ会えるね", romaji: "mō sugu aeru ne", en: "We'll see each other soon", pt: "Logo a gente se vê" },
  { key: "ganbatte", ja: "頑張って", romaji: "ganbatte", en: "You've got this", pt: "Força, você consegue" },
  { key: "koko-ni-iru", ja: "ここにいるよ", romaji: "koko ni iru yo", en: "I'm right here", pt: "Estou aqui" },
];

/** Detect the real image type from magic bytes (the client-sent MIME type is not trusted). */
export function sniffImageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "image/png";
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (b.length >= 12 && ascii(4, 8) === "ftyp" && ["heic", "heix", "heim", "heis", "mif1", "msf1"].includes(ascii(8, 12))) return "image/heic";
  return null;
}

/** A known phrase key, or a custom phrase (≤ 80 chars, trimmed). */
export function resolvePhrase(phraseKey, phrase) {
  const known = JAPANESE_PHRASES.find((p) => p.key === phraseKey);
  if (known) return { key: known.key, text: known.ja };
  const text = typeof phrase === "string" ? phrase.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  if (!text) throw new Error("Choose a phrase for your photo.");
  return { key: null, text };
}

export function validatePhoto(bytes, size) {
  if (!size) throw new Error("Choose a photo.");
  if (size > MAX_PHOTO_BYTES) throw new Error("Photos must be 5 MB or smaller.");
  const type = sniffImageType(bytes);
  if (!type) throw new Error("Only JPEG, PNG, WebP or HEIC photos are allowed.");
  return { type, ext: PHOTO_TYPES[type] };
}

import { themeCategories } from "../../i18n";

type Body = { kind?: "theme" | "lies"; truth?: string; prompt?: string; category?: string | string[]; exclude?: string[]; fresh?: boolean; customTheme?: string; count?: number };

const fallbackTheme = (categories: string | string[] = "safe", exclude: string[] = []) => {
  const requested = Array.isArray(categories) ? categories : categories.split(",");
  const keys = requested.filter((key): key is keyof typeof themeCategories => key in themeCategories);
  const safeKeys: (keyof typeof themeCategories)[] = keys.length ? keys : ["mixed", "family", "innocent", "life"];
  const list = safeKeys.flatMap((key) => themeCategories[key]);
  const available = list.filter((item) => !exclude.includes(item));
  return available[Math.floor(Math.random() * Math.max(available.length, 1))] ?? list[0];
};

const fallbackLies = (truth: string) => [
  `I once told someone I was ${truth.toLowerCase().slice(0, 48)}.`,
  `I have a photo proving that ${truth.toLowerCase().slice(0, 42)}.`,
  `My oldest friend still thinks ${truth.toLowerCase().slice(0, 40)}.`,
  `I learned the hard way that ${truth.toLowerCase().slice(0, 38)}.`,
  `I secretly wish people knew that ${truth.toLowerCase().slice(0, 34)}.`,
];
const responseText = (data: { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }) => data.output_text ?? data.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "";
const normalizeTheme = (value: string) => value.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
const usableTheme = (value: string, exclude: string[] = []) => { const theme = normalizeTheme(value); const words = theme.split(" ").filter(Boolean); return words.length >= 5 && words.length <= 12 && !/[—–\-:;|]/.test(theme) && !/\b(edition|confession|confessions|category|categories|theme|party game|two lies|one truth|your relatives|family tradition)$\b/i.test(theme) && !/\b(spicy sausage|chemistry class).*(spicy sausage|chemistry class)\b/i.test(theme) && !exclude.some((item) => item.toLowerCase() === theme.toLowerCase()) ? theme : null; };
const categoryGuidance = (categories: string | string[]) => {
  const key = Array.isArray(categories) ? categories[0] : categories;
  if (key === "spicy") return "This is an adults only 18+ category for consenting adults. Topics may openly discuss sex, sexual experiences, desire, intimacy, and bedroom communication, but never minors, coercion, exploitation, incest, or violence. Keep each topic non graphic and suitable as a conversation prompt.";
  if (key === "flirty") return "Keep this flirty but not explicit: dating, attraction, crushes, romance, kissing, relationship choices, and playful adult tension. Do not turn it into food, school science, or unrelated shock humor.";
  if (key === "family") return "Keep every topic about a family relationship, home tradition, relative, or shared family memory.";
  if (key === "innocent") return "Keep every topic light, wholesome, and suitable for mixed ages, focused on school, hobbies, food, memories, and harmless mistakes.";
  return "Keep every topic grounded in one ordinary personal situation from this category, with no unrelated mashups.";
};

export async function POST(request: Request) {
  let body: Body = {};
  try { body = await request.json(); } catch { /* fallback */ }
  const categories = Array.isArray(body.category) ? body.category.filter((key): key is keyof typeof themeCategories => key in themeCategories) : (body.category ?? "safe");
  const count = Number.isInteger(body.count) ? Math.max(3, Math.min(20, body.count as number)) : 3;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith("REPLACE_")) {
    return Response.json(body.kind === "lies" ? { lies: fallbackLies(body.truth ?? "my secret"), source: "fallback" } : { prompt: fallbackTheme(categories, body.exclude), source: "fallback" });
  }
  try {
    const instruction = body.kind === "lies"
      ? `Write five believable but clearly fictional alternative statements for a party game. The player's true statement is: "${(body.truth ?? "").slice(0, 180)}". Theme: ${(body.prompt ?? "anything goes").slice(0, 80)}. Treat the truth as the primary context and the theme as a loose frame. Notice its tone, seriousness, specificity, point of view, people, places, time, and emotional detail, then make lies that could realistically come from the same person and fit the same conversational setting. Keep the lies close enough to the truth that a friend could believe them, but do not merely paraphrase, negate, or repeat the truth. Keep every lie approximately the same character length as the truth, within about 15 percent or 20 characters, whichever allows the more natural sentence. Do not make AI lies noticeably longer than the truth. Vary the kinds of details and sentence openings. Make each lie sound like something a real person would casually type, with contractions and everyday wording, not polished copy. Do not wrap statements in quotation marks. Never use an em dash, en dash, or hyphen of any kind. No corporate, robotic, or repeated template language. Keep them safe, playful, non-defamatory, and non-explicit. Return five short English statements as a JSON object with a lies array.`
      : `Create ${count} natural English topic phrases for a two-lies-one-truth game. Every phrase must describe one clear, relatable personal situation that a player can understand immediately and answer with a real story. Use only this subject area: ${(Array.isArray(categories) ? categories.join(", ") : categories)}. ${categoryGuidance(categories)} Custom subject: ${(body.customTheme ?? "").slice(0, 80) || "none"}. ${body.customTheme ? "Make every option specifically about the custom subject." : ""} ${body.fresh ? "Make these fresh and specific, not generic." : ""} Good examples: a time you got in trouble at school, a family tradition you still follow, a teacher you will never forget, a first job mistake, a trip that changed your mind. Bad examples: family tradition, your relatives, random combinations like spicy sausage in chemistry class, or a food and school mashup when the subject does not ask for both. Never combine unrelated objects, places, or categories. Do not write a title, question, instruction, or generic label. Use plain conversational lowercase wording with 5 to 12 words each. No punctuation, quotes, colon, semicolon, question mark, exclamation mark, em dash, en dash, or hyphen. Do not use words such as edition, confession, category, theme, or party game. Avoid: ${(body.exclude ?? []).join(", ") || "none"}. Return a JSON object with a themes array containing exactly ${count} options.`;
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: process.env.OPENAI_MODEL ?? "gpt-5.4-nano", store: false, input: instruction, text: { format: { type: "json_schema", name: body.kind === "lies" ? "lie_options" : "theme_options", strict: true, schema: body.kind === "lies" ? { type: "object", properties: { lies: { type: "array", items: { type: "string" }, minItems: 5, maxItems: 5 } }, required: ["lies"], additionalProperties: false } : { type: "object", properties: { themes: { type: "array", items: { type: "string" }, minItems: count, maxItems: count } }, required: ["themes"], additionalProperties: false } } }, max_output_tokens: body.kind === "lies" ? 260 : Math.max(180, count * 35) }) });
    if (!response.ok) { const detail = await response.text(); console.error("[suggest] OpenAI request failed", { status: response.status, model: process.env.OPENAI_MODEL ?? "gpt-5.4-nano", detail: detail.slice(0, 500) }); throw new Error(`OpenAI request failed (${response.status})`); }
    const data = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    const text = responseText(data);
    if (body.kind === "lies") {
      const parsed = JSON.parse(text || "{}");
      const lies = Array.isArray(parsed.lies) ? parsed.lies.filter((item: unknown): item is string => typeof item === "string").map((item: string) => item.trim().slice(0, 180)).filter(Boolean).slice(0, 5) : [];
      if (lies.length === 5) return Response.json({ lies, source: "ai" });
      throw new Error("Invalid lie options");
    }
    const parsed = JSON.parse(text || "{}");
    const prompts = Array.isArray(parsed.themes) ? parsed.themes.map((item: unknown) => typeof item === "string" ? usableTheme(item, body.exclude) : null).filter((item: string | null): item is string => Boolean(item)).map((item: string) => item.slice(0, 100)).slice(0, count) : [];
    if (!prompts.length) throw new Error("Invalid theme");
    return Response.json({ prompt: prompts[0], prompts, source: "ai" });
  } catch (error) {
    console.error("[suggest] Returning fallback", { kind: body.kind ?? "theme", hasKey: Boolean(apiKey), placeholder: Boolean(apiKey?.startsWith("REPLACE_")), model: process.env.OPENAI_MODEL ?? "gpt-5.4-nano", error: error instanceof Error ? error.message : String(error) });
    return Response.json(body.kind === "lies" ? { lies: fallbackLies(body.truth ?? "my secret"), source: "fallback" } : { prompt: fallbackTheme(categories, body.exclude), source: "fallback" });
  }
}

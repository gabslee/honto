import { themeCategories } from "../../i18n";

type Body = { kind?: "theme" | "lies"; truth?: string; prompt?: string; category?: string | string[]; exclude?: string[]; fresh?: boolean; customTheme?: string };

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
const usableTheme = (value: string, exclude: string[] = []) => { const theme = normalizeTheme(value); const words = theme.split(" ").filter(Boolean); return theme.length >= 4 && words.length <= 8 && !/[—–\-:;|]/.test(theme) && !/\b(edition|confession|confessions|category|categories|theme|party game|two lies|one truth)\b/i.test(theme) && !exclude.some((item) => item.toLowerCase() === theme.toLowerCase()) ? theme : null; };

export async function POST(request: Request) {
  let body: Body = {};
  try { body = await request.json(); } catch { /* fallback */ }
  const categories = Array.isArray(body.category) ? body.category.filter((key): key is keyof typeof themeCategories => key in themeCategories) : (body.category ?? "safe");
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith("REPLACE_")) {
    return Response.json(body.kind === "lies" ? { lies: fallbackLies(body.truth ?? "my secret"), source: "fallback" } : { prompt: fallbackTheme(categories, body.exclude), source: "fallback" });
  }
  try {
    const instruction = body.kind === "lies"
      ? `Write five believable but clearly fictional alternative statements for a party game. The player's true statement is: "${(body.truth ?? "").slice(0, 180)}". Theme: ${(body.prompt ?? "anything goes").slice(0, 80)}. Treat the truth as the primary context and the theme as a loose frame. Notice its tone, seriousness, specificity, point of view, people, places, time, and emotional detail, then make lies that could realistically come from the same person and fit the same conversational setting. Keep the lies close enough to the truth that a friend could believe them, but do not merely paraphrase, negate, or repeat the truth. Vary the kinds of details and sentence openings. Make each lie sound like something a real person would casually type, with contractions and everyday wording, not polished copy. Do not wrap statements in quotation marks. Never use an em dash, en dash, or hyphen of any kind. No corporate, robotic, or repeated template language. Keep them safe, playful, non-defamatory, and non-explicit. Return five short English statements as a JSON object with a lies array.`
      : `Create three short English topic phrases for a two-lies-one-truth game. The topic should invite one real personal story from the player. Selected subject areas: ${(Array.isArray(categories) ? categories.join(", ") : categories)}. Custom subject: ${(body.customTheme ?? "").slice(0, 80) || "none"}. ${body.customTheme ? "Make every option specifically about the custom subject." : ""} ${body.fresh ? "Make these feel fresh, specific, and unlike generic party game prompts." : ""} Good style: a family tradition, your first job, a weird snack, a time you got lost. Do not write a title, question, instruction, or generic label. Avoid formats like Cozy Confessions: Family Life Edition, Family Life, or Tell your story. Use plain conversational lowercase wording, 2 to 8 words each. No punctuation, quotes, colon, semicolon, question mark, exclamation mark, em dash, en dash, or hyphen. Do not use words such as edition, confession, category, theme, or party game. Avoid: ${(body.exclude ?? []).join(", ") || "none"}. Return a JSON object with a themes array containing exactly three options.`;
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: process.env.OPENAI_MODEL ?? "gpt-5.4-nano", store: false, input: instruction, text: { format: { type: "json_schema", name: body.kind === "lies" ? "lie_options" : "theme_options", strict: true, schema: body.kind === "lies" ? { type: "object", properties: { lies: { type: "array", items: { type: "string" }, minItems: 5, maxItems: 5 } }, required: ["lies"], additionalProperties: false } : { type: "object", properties: { themes: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 } }, required: ["themes"], additionalProperties: false } } }, max_output_tokens: body.kind === "lies" ? 260 : 100 }) });
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
    const prompt = Array.isArray(parsed.themes) ? parsed.themes.map((item: unknown) => typeof item === "string" ? usableTheme(item, body.exclude) : null).find((item: string | null): item is string => Boolean(item)) : null;
    if (!prompt) throw new Error("Invalid theme");
    return Response.json({ prompt: prompt.slice(0, 100), source: "ai" });
  } catch (error) {
    console.error("[suggest] Returning fallback", { kind: body.kind ?? "theme", hasKey: Boolean(apiKey), placeholder: Boolean(apiKey?.startsWith("REPLACE_")), model: process.env.OPENAI_MODEL ?? "gpt-5.4-nano", error: error instanceof Error ? error.message : String(error) });
    return Response.json(body.kind === "lies" ? { lies: fallbackLies(body.truth ?? "my secret"), source: "fallback" } : { prompt: fallbackTheme(categories, body.exclude), source: "fallback" });
  }
}

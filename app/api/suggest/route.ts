import { themeCategories } from "../../i18n";

type Body = { kind?: "theme" | "lies"; truth?: string; prompt?: string; category?: string | string[]; exclude?: string[] };

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
      ? `Write five believable but clearly fictional alternative statements for a party game. The player's true statement is: "${(body.truth ?? "").slice(0, 180)}". Theme: ${(body.prompt ?? "anything goes").slice(0, 80)}. Return five short English statements as a JSON array of strings. Keep them safe, playful, non-defamatory, and non-explicit.`
      : `Give one fresh, playful English theme for a two-lies-one-truth party game in the ${(Array.isArray(categories) ? categories.join(", ") : categories)} categories. Avoid: ${(body.exclude ?? []).join(", ") || "none"}. Return only a 2–8 word noun phrase.`;
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: process.env.OPENAI_MODEL ?? "gpt-5.4-nano", store: false, input: instruction, text: { format: body.kind === "lies" ? { type: "json_schema", name: "lie_options", strict: true, schema: { type: "object", properties: { lies: { type: "array", items: { type: "string" }, minItems: 5, maxItems: 5 } }, required: ["lies"], additionalProperties: false } } : { type: "text" } }, max_output_tokens: body.kind === "lies" ? 260 : 30 }) });
    if (!response.ok) throw new Error("OpenAI request failed");
    const data = await response.json() as { output_text?: string };
    if (body.kind === "lies") {
      const parsed = JSON.parse(data.output_text ?? "{}");
      const lies = Array.isArray(parsed.lies) ? parsed.lies.filter((item: unknown): item is string => typeof item === "string").map((item: string) => item.trim().slice(0, 180)).filter(Boolean).slice(0, 5) : [];
      if (lies.length === 5) return Response.json({ lies, source: "ai" });
      throw new Error("Invalid lie options");
    }
    const prompt = data.output_text?.trim().replace(/[.!?]+$/, "").slice(0, 100);
    if (!prompt) throw new Error("Invalid theme");
    return Response.json({ prompt, source: "ai" });
  } catch {
    return Response.json(body.kind === "lies" ? { lies: fallbackLies(body.truth ?? "my secret"), source: "fallback" } : { prompt: fallbackTheme(categories, body.exclude), source: "fallback" });
  }
}

import { themeCategories } from "../../i18n";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Body = { kind?: "theme" | "lies" | "question"; truth?: string; prompt?: string; category?: string | string[]; exclude?: string[]; fresh?: boolean; customTheme?: string; questionHint?: string; count?: number };

const fallbackTheme = (categories: string | string[] = "safe", exclude: string[] = []) => {
  const requested = Array.isArray(categories) ? categories : categories.split(",");
  const keys = requested.filter((key): key is keyof typeof themeCategories => key in themeCategories);
  const safeKeys: (keyof typeof themeCategories)[] = keys.length ? keys : ["general", "life"];
  const list = safeKeys.flatMap((key) => themeCategories[key]);
  const available = list.filter((item) => !exclude.includes(item));
  return available[Math.floor(Math.random() * Math.max(available.length, 1))] ?? list[0];
};

const fallbackLies = (_truth: string) => ["I once missed a flight because I followed the wrong stranger.", "I have a hidden talent for naming every song in the first three seconds.", "I accidentally joined the wrong video call and stayed for five minutes.", "I can fold a fitted sheet perfectly every time.", "I once won a competition without realizing I had entered."];
const fallbackQuestion = (categories: string | string[], customTheme?: string | null, hint?: string) => {
  if (customTheme?.trim()) return `What is a personal story about ${customTheme.trim().slice(0, 80)}?`;
  if (hint?.trim()) return `What is a personal story connected to ${hint.trim().replace(/[?.!]+$/g, "").slice(0, 100)}?`;
  const key = (Array.isArray(categories) ? categories : [categories]).find((item) => item !== "general") ?? "general";
  if (key === "spicy") return "What is an intimate experience you feel comfortable sharing?";
  if (key === "relationships") return "What is a dating or friendship story you still remember?";
  if (key === "life") return "What is a life experience that changed you?";
  return "What is a personal story your friends may not know?";
};
const fallbackQuestions = (categories: string | string[], customTheme?: string | null, hint?: string) => {
  const key = (Array.isArray(categories) ? categories : [categories]).find((item) => item !== "general") ?? "general";
  if (customTheme?.trim()) {
    const subject = customTheme.trim().slice(0, 60);
    return [`What is one memory connected to ${subject}?`, `What is something surprising about ${subject}?`, `What is your strongest opinion about ${subject}?`];
  }
  if (hint?.trim()) {
    const direction = hint.trim().replace(/[?.!]+$/g, "").slice(0, 70);
    return [`What is one personal story connected to ${direction}?`, `What is something unexpected you remember about ${direction}?`, `What is your honest opinion about ${direction}?`];
  }
  if (key === "spicy") return ["What is an intimate experience you feel comfortable sharing?", "What is a desire you have changed your mind about?", "What is a boundary you learned to communicate?"];
  if (key === "relationships") return ["What is a dating or friendship story you still remember?", "What quality makes someone instantly likable to you?", "What is a relationship green flag you value?"];
  if (key === "life") return ["What is a life experience that changed you?", "What is a decision you would make differently now?", "What is something you learned the hard way?"];
  return ["What is a personal story your friends may not know?", "What is a small decision that changed your day?", "What is a memory you rarely talk about?"];
};
const responseText = (data: { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> }) => data.output_text ?? data.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "";
const normalizeTheme = (value: string) => value.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
const usableTheme = (value: string, exclude: string[] = []) => { const theme = normalizeTheme(value); const words = theme.split(" ").filter(Boolean); return words.length >= 3 && words.length <= 8 && !/[—–\-:;|]/.test(theme) && !/\b(i|my|me|we|our|us)\b/i.test(theme) && !/\b(when|the time|a time)\s+(i|my|we|our)\b/i.test(theme) && !/\b(edition|confession|confessions|category|categories|theme|party game|two lies|one truth|your relatives|family tradition)$\b/i.test(theme) && !/\b(spicy sausage|chemistry class).*(spicy sausage|chemistry class)\b/i.test(theme) && !exclude.some((item) => item.toLowerCase() === theme.toLowerCase()) ? theme : null; };
const categoryGuidance = (categories: string | string[]) => {
  const key = Array.isArray(categories) ? categories[0] : categories;
  if (key === "spicy") return "This is an adults only 18+ category for consenting adults. Topics may openly discuss sex, sexual experiences, desire, intimacy, and bedroom communication, but never minors, coercion, exploitation, incest, or violence. Keep each topic non graphic and broad enough for many different answers.";
  if (key === "relationships") return "Keep this about friendship, dating, attraction, romance, communication, and relationship choices without becoming explicit. Keep each topic broad enough for many different answers.";
  return "Keep every topic grounded in one ordinary personal subject from this category, with no unrelated mashups. Keep each topic broad enough for many different answers.";
};

export async function POST(request: Request) {
  let body: Body = {};
  try { body = await request.json(); } catch { /* fallback */ }
  const categories = Array.isArray(body.category) ? body.category.filter((key): key is keyof typeof themeCategories => key in themeCategories) : (body.category ?? "safe");
  const count = Number.isInteger(body.count) ? Math.max(3, Math.min(20, body.count as number)) : 3;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith("REPLACE_")) {
    return Response.json(body.kind === "lies" ? { lies: fallbackLies(body.truth ?? "my secret"), source: "fallback" } : body.kind === "question" ? { questions: fallbackQuestions(categories, body.customTheme, body.questionHint), source: "fallback" } : { prompt: fallbackTheme(categories, body.exclude), source: "fallback" });
  }
  try {
    const instruction = body.kind === "lies"
      ? `You are helping me play Two Lies and One Truth, an adults-only game between consenting adults. Truth from the player: "${(body.truth ?? "").slice(0, 180)}". Write exactly five short, believable lies that could fool a close friend. Match the truth's tone, boldness, intimacy, and adult intensity: if the truth is sexual, provocative, or outrageous but involves consenting adults, keep the lies equally daring and do not sanitize them into bland everyday stories. If the truth is neutral, keep the lies neutral. Do not copy, paraphrase, negate, or closely mirror the truth. Do not reuse its people, places, dates, actions, objects, or outcome. Make every lie a completely different event, with natural casual wording. Never involve minors, coercion, exploitation, incest, or violence. No theme, no explanations, no quotation marks, no hyphens. Return a JSON object with a lies array containing exactly five items.`
      : body.kind === "question"
      ? `Write exactly ${count} natural English questions for a two-player Truth or Sips game. The player will answer out loud or choose to take sips, so make each question easy to understand and answer verbally. Selected category: ${(Array.isArray(categories) ? categories.join(", ") : categories) || "general personal stories"}. Custom subject: ${(body.customTheme ?? "").slice(0, 80) || "none"}. Extra direction from the player: ${(body.questionHint ?? "").slice(0, 160) || "none"}. ${body.customTheme ? "Use the custom subject as the main direction." : "Use the selected category as the main direction."} ${body.questionHint ? "Use the extra direction as a helpful nuance, but do not copy it word for word." : ""} If spicy is selected, this is an adults only 18+ game for consenting adults and the questions may be openly intimate or sexual, but never involve minors, coercion, exploitation, incest, or violence. If relationships is selected, keep them about friendship, dating, attraction, romance, communication, or relationship choices without becoming explicit. Do not combine unrelated categories. Make each question distinct and ask about one clear personal experience, preference, memory, or opinion. Keep them conversational, specific, playful, and answerable in one or two spoken sentences. Do not add a title, explanation, quotation marks, em dashes, en dashes, or hyphens. Return a JSON object with a questions array containing exactly ${count} questions.`
      : `Create ${count} short natural English topic cues for a two-lies-one-truth game. A topic cue is only a broad starting point that helps a player think of their own answer. It must not be a complete story, sample answer, or exact incident. Use only this subject area: ${(Array.isArray(categories) ? categories.join(", ") : categories)}. ${categoryGuidance(categories)} Custom subject: ${(body.customTheme ?? "").slice(0, 80) || "none"}. ${body.customTheme ? "Use the custom subject as a broad direction, not as a detailed event." : ""} ${body.fresh ? "Make these fresh, simple, and useful, not generic or random." : ""} Good examples: your favorite comfort food, a childhood school memory, a family holiday tradition, a traumatic childhood moment, a first date story, a hobby you gave up. Bad examples: when I flooded the bathroom sink and blamed someone, the time I got caught by my cousin, a full sentence beginning with when I or I, or random combinations like spicy sausage in chemistry class. Never use first person, exact names, or several unrelated details. Never combine unrelated objects, places, or categories. Do not write a title, question, instruction, or complete sentence. Use plain conversational lowercase wording with 3 to 8 words each. No punctuation, quotes, colon, semicolon, question mark, exclamation mark, em dash, en dash, or hyphen. Do not use words such as edition, confession, category, theme, or party game. Avoid: ${(body.exclude ?? []).join(", ") || "none"}. Return a JSON object with a themes array containing exactly ${count} options.`;
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: process.env.OPENAI_MODEL ?? "gpt-5.4-nano", store: false, input: instruction, text: { format: { type: "json_schema", name: body.kind === "lies" ? "lie_options" : body.kind === "question" ? "question_options" : "theme_options", strict: true, schema: body.kind === "lies" ? { type: "object", properties: { lies: { type: "array", items: { type: "string" }, minItems: 5, maxItems: 5 } }, required: ["lies"], additionalProperties: false } : body.kind === "question" ? { type: "object", properties: { questions: { type: "array", items: { type: "string" } } }, required: ["questions"], additionalProperties: false } : { type: "object", properties: { themes: { type: "array", items: { type: "string" }, minItems: count, maxItems: count } }, required: ["themes"], additionalProperties: false } } }, max_output_tokens: body.kind === "lies" ? 260 : body.kind === "question" ? 320 : Math.max(180, count * 35) }) });
    if (!response.ok) { const detail = await response.text(); console.error("[suggest] OpenAI request failed", { status: response.status, model: process.env.OPENAI_MODEL ?? "gpt-5.4-nano", detail: detail.slice(0, 500) }); throw new Error(`OpenAI request failed (${response.status})`); }
    const data = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    const text = responseText(data);
    if (body.kind === "lies") {
      const parsed = JSON.parse(text || "{}");
      const lies = Array.isArray(parsed.lies) ? parsed.lies.filter((item: unknown): item is string => typeof item === "string").map((item: string) => item.trim().slice(0, 180)).filter(Boolean).slice(0, 5) : [];
      if (lies.length === 5) return Response.json({ lies, source: "ai" });
      throw new Error("Invalid lie options");
    }
    if (body.kind === "question") {
      const parsed = JSON.parse(text || "{}");
      const questions = Array.isArray(parsed.questions) ? parsed.questions.filter((item: unknown): item is string => typeof item === "string").map((item: string) => item.trim().replace(/^['"“”]+|['"“”]+$/g, "").slice(0, 220)).filter((item: string) => item.length >= 8).slice(0, count) : [];
      if (questions.length === count) return Response.json({ questions, question: questions[0], source: "ai" });
      throw new Error("Invalid question options");
    }
    const parsed = JSON.parse(text || "{}");
    const prompts = Array.isArray(parsed.themes) ? parsed.themes.map((item: unknown) => typeof item === "string" ? usableTheme(item, body.exclude) : null).filter((item: string | null): item is string => Boolean(item)).map((item: string) => item.slice(0, 100)).slice(0, count) : [];
    if (!prompts.length) throw new Error("Invalid theme");
    return Response.json({ prompt: prompts[0], prompts, source: "ai" });
  } catch (error) {
    console.error("[suggest] Returning fallback", { kind: body.kind ?? "theme", hasKey: Boolean(apiKey), placeholder: Boolean(apiKey?.startsWith("REPLACE_")), model: process.env.OPENAI_MODEL ?? "gpt-5.4-nano", error: error instanceof Error ? error.message : String(error) });
    return Response.json(body.kind === "lies" ? { lies: fallbackLies(body.truth ?? "my secret"), source: "fallback" } : body.kind === "question" ? { questions: fallbackQuestions(categories, body.customTheme, body.questionHint), source: "fallback" } : { prompt: fallbackTheme(categories, body.exclude), source: "fallback" });
  }
}

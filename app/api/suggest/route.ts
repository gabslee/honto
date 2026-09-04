const FALLBACK_PROMPTS = [
  "your love life",
  "a trip that went wrong",
  "an embarrassing childhood moment",
  "something you once did in secret",
  "an unforgettable date",
  "a useless skill",
  "a party that got out of hand",
  "a completely irrational fear",
  "a message sent by mistake",
  "an impulsive decision",
  "a celebrity encounter",
  "a harmless family secret",
];

function fallback(exclude: string[] = []) {
  const available = FALLBACK_PROMPTS.filter((prompt) => !exclude.includes(prompt));
  return available[Math.floor(Math.random() * Math.max(available.length, 1))] ?? FALLBACK_PROMPTS[0];
}

export async function POST(request: Request) {
  let body: { exclude?: string[] } = {};
  try { body = await request.json(); } catch { /* use fallback */ }
  const exclude = Array.isArray(body.exclude) ? body.exclude.filter((item): item is string => typeof item === "string").slice(0, 20) : [];
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) return Response.json({ prompt: fallback(exclude), source: "fallback" });

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-5.4-nano",
        store: false,
        input: [
          {
            role: "system",
            content: "You create playful, safe, concise English prompts for a two-lies-one-truth party game. Keep them personal but not invasive, never sexual, hateful, illegal, or dangerous. Return only a short lowercase noun phrase, 2 to 8 words.",
          },
          { role: "user", content: `Give me one fresh theme. Avoid these previous themes: ${exclude.join(", ") || "none"}.` },
        ],
        text: { format: { type: "text" } },
        max_output_tokens: 30,
      }),
    });
    if (!response.ok) throw new Error(`OpenAI request failed with ${response.status}`);
    const data = await response.json() as { output_text?: string };
    const prompt = data.output_text?.trim().replace(/[.!?]+$/, "").slice(0, 100);
    if (!prompt || prompt.split(/\s+/).length > 12) throw new Error("Invalid prompt");
    return Response.json({ prompt, source: "ai" });
  } catch {
    return Response.json({ prompt: fallback(exclude), source: "fallback" });
  }
}

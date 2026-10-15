// No-drinking date-night mode: the sip wheel becomes a love wheel. Whoever would drink
// owes a romantic task/question worth the wheel's number of points instead. No alcohol.
export const DRINK_MODES = ["sips", "date"];
export function normalizeDrinkMode(value, fallback = "sips") {
  return DRINK_MODES.includes(value) ? value : DRINK_MODES.includes(fallback) ? fallback : "sips";
}

const card = (en, pt, ja) => ({ en, "pt-BR": pt, ja });
export const DATE_TASKS = [
  card("Tell your partner one thing you love about them that you have never said out loud.", "Diga ao seu amor algo que você ama nele e nunca disse em voz alta.", "相手の好きなところで、まだ口に出したことのないものを一つ伝えて。"),
  card("Describe your favorite memory of the two of you in three sentences.", "Descreva sua lembrança favorita de vocês dois em três frases.", "二人の一番好きな思い出を3文で話して。"),
  card("Send your partner a voice note they can replay on a hard day.", "Mande um áudio que seu amor possa ouvir num dia difícil.", "つらい日に聞き返せるボイスメッセージを相手に送って。"),
  card("Plan your next virtual date in under one minute.", "Planeje o próximo date virtual em menos de um minuto.", "次のオンラインデートを1分以内で計画して。"),
  card("Give your partner three sincere compliments in a row.", "Faça três elogios sinceros seguidos ao seu amor.", "相手を心から3回続けて褒めて。"),
  card("Answer honestly: when did you last feel really proud of your partner?", "Responda com sinceridade: quando foi a última vez que sentiu muito orgulho do seu amor?", "正直に答えて：最近、相手を本当に誇らしく思ったのはいつ？"),
  card("Show your partner something that reminded you of them this week.", "Mostre algo que lembrou você do seu amor esta semana.", "今週、相手を思い出したものを見せて。"),
  card("Sing or hum ten seconds of 'your' song.", "Cante ou cantarole dez segundos da 'música de vocês'.", "二人の曲を10秒歌うか、ハミングして。"),
  card("Write a two-line love note and read it out loud.", "Escreva um bilhete de amor de duas linhas e leia em voz alta.", "2行のラブレターを書いて、声に出して読んで。"),
  card("Tell your partner what you are most looking forward to when you meet again.", "Conte o que você mais espera do próximo reencontro.", "次に会うとき一番楽しみなことを伝えて。"),
  card("Blow your partner a kiss and give them your best virtual hug.", "Mande um beijo e seu melhor abraço virtual.", "投げキスと最高のオンラインハグを送って。"),
  card("Answer: what is one small habit of your partner you secretly adore?", "Responda: que pequeno hábito do seu amor você adora em segredo?", "答えて：こっそり大好きな相手の小さなクセは？"),
  card("Choose a movie you will both watch at the same time this week.", "Escolha um filme para vocês assistirem ao mesmo tempo esta semana.", "今週同時に観る映画を一本決めて。"),
  card("Share a photo from your camera roll that makes you smile and explain why.", "Mostre uma foto da galeria que te faz sorrir e explique por quê.", "見ると笑顔になる写真を一枚見せて、その理由を話して。"),
  card("Promise one small act of care for tomorrow and say it out loud.", "Prometa um pequeno gesto de carinho para amanhã e diga em voz alta.", "明日する小さな思いやりを一つ約束して、声に出して。"),
];

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) { value ^= text.charCodeAt(index); value = Math.imul(value, 16777619); }
  return value >>> 0;
}

/** Same task on both screens for the same card. */
export function dateTaskFor(seed, locale = "en") {
  const task = DATE_TASKS[hash(String(seed)) % DATE_TASKS.length];
  return task[locale] ?? task.en;
}

export function pointsLabel(count, locale = "en", dateMode = false) {
  if (dateMode) return locale === "ja" ? "ポイント" : locale === "pt-BR" ? (count === 1 ? "ponto ♥" : "pontos ♥") : (count === 1 ? "♥ point" : "♥ points");
  return locale === "ja" ? "シップ" : count === 1 ? "sip" : "sips";
}

export function dateResultTitle({ loserName, both, points, locale = "en" }) {
  const label = pointsLabel(points, locale, true);
  if (both) return locale === "ja" ? `二人でラブタスク（${points}${label}）！` : locale === "pt-BR" ? `Os dois fazem a tarefa do amor (${points} ${label})!` : `You both do the love task (${points} ${label})!`;
  return locale === "ja" ? `${loserName}のラブタスク（${points}${label}）。` : locale === "pt-BR" ? `${loserName} cumpre a tarefa do amor (${points} ${label}).` : `${loserName} owes a love task (${points} ${label}).`;
}

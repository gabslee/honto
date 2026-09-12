type Prompt = { id: string; en: string; ja: string };
type Theme = "general" | "life" | "relationships" | "spicy";

export const WHO_PROMPTS: Record<Theme, Prompt[]> = {
  general: [
    { id: "who-flight", en: "Who at the table is most likely to miss a flight?", ja: "飛行機に乗り遅れそうなのは誰？" },
    { id: "who-party", en: "Who would organize the best surprise party?", ja: "最高のサプライズパーティーを企画しそうなのは誰？" },
    { id: "who-lyrics", en: "Who is most likely to confidently sing the wrong lyrics?", ja: "歌詞を間違えても自信満々に歌いそうなのは誰？" },
    { id: "who-snacks", en: "Who would bring the best snacks on a road trip?", ja: "ドライブに最高のおやつを持ってきそうなのは誰？" },
    { id: "who-quiz", en: "Who would you pick for your pub quiz team?", ja: "クイズ大会で同じチームにしたいのは誰？" },
    { id: "who-alien", en: "Who would make friends with an alien first?", ja: "宇宙人と最初に友達になりそうなのは誰？" },
  ],
  life: [
    { id: "who-adventure", en: "Who is most likely to book a trip on a whim?", ja: "思いつきで旅行を予約しそうなのは誰？" },
    { id: "who-plant", en: "Who would give every houseplant a name?", ja: "観葉植物全部に名前を付けそうなのは誰？" },
    { id: "who-hobby", en: "Who is most likely to start a new hobby this week?", ja: "今週、新しい趣味を始めそうなのは誰？" },
    { id: "who-cooking", en: "Who would turn random leftovers into a great meal?", ja: "残り物からおいしい料理を作れそうなのは誰？" },
    { id: "who-map", en: "Who would get lost even while following a map?", ja: "地図を見ていても迷いそうなのは誰？" },
    { id: "who-story", en: "Who could turn an ordinary day into an amazing story?", ja: "普通の一日を面白い話にできそうなのは誰？" },
  ],
  relationships: [
    { id: "who-date", en: "Who would plan the most creative first date?", ja: "一番ユニークな初デートを計画しそうなのは誰？" },
    { id: "who-anniversary", en: "Who is most likely to remember every anniversary?", ja: "記念日を全部覚えていそうなのは誰？" },
    { id: "who-advice", en: "Who gives the best relationship advice?", ja: "恋愛相談で一番頼りになりそうなのは誰？" },
    { id: "who-playlist", en: "Who would make a playlist for someone they like?", ja: "好きな人にプレイリストを作りそうなのは誰？" },
    { id: "who-letter", en: "Who would write the most thoughtful handwritten note?", ja: "一番心のこもった手紙を書きそうなのは誰？" },
    { id: "who-romcom", en: "Who would be the main character in a romantic comedy?", ja: "ラブコメの主人公になりそうなのは誰？" },
  ],
  spicy: [
    { id: "who-flirt", en: "Who would win a flirting contest?", ja: "口説き文句の勝負で勝ちそうなのは誰？" },
    { id: "who-line", en: "Who could make the cheesiest pickup line work?", ja: "ベタな口説き文句でも成功させそうなのは誰？" },
    { id: "who-bold", en: "Who would make the first move on a crush?", ja: "好きな人に最初にアプローチしそうなのは誰？" },
    { id: "who-dance", en: "Who would steal the spotlight on a dance floor?", ja: "ダンスフロアで注目を集めそうなのは誰？" },
    { id: "who-wink", en: "Who could say the most with a single wink?", ja: "ウインク一つで気持ちを伝えられそうなのは誰？" },
    { id: "who-mystery", en: "Who would be the mysterious stranger in a romance film?", ja: "恋愛映画でミステリアスな人物を演じそうなのは誰？" },
  ],
};

export const SURPRISE_PROMPTS: Prompt[] = [
  { id: "surprise-black", en: "Are you wearing a black top?", ja: "黒いトップスを着ていますか？" },
  { id: "surprise-watch", en: "Are you wearing a watch?", ja: "腕時計をしていますか？" },
  { id: "surprise-sneakers", en: "Are you wearing sneakers?", ja: "スニーカーを履いていますか？" },
  { id: "surprise-coffee", en: "Did you have coffee today?", ja: "今日コーヒーを飲みましたか？" },
  { id: "surprise-stripes", en: "Are you wearing anything with stripes?", ja: "しま模様の服や小物を身に着けていますか？" },
  { id: "surprise-music", en: "Did you listen to music on the way here?", ja: "ここに来る途中で音楽を聴きましたか？" },
  { id: "surprise-ring", en: "Are you wearing a ring?", ja: "指輪をしていますか？" },
  { id: "surprise-photo", en: "Have you taken a photo today?", ja: "今日写真を撮りましたか？" },
  { id: "surprise-laces", en: "Do your shoes have laces?", ja: "今履いている靴にはひもがありますか？" },
  { id: "surprise-socks", en: "Are you wearing colorful socks?", ja: "カラフルな靴下を履いていますか？" },
  { id: "surprise-printed", en: "Are you wearing a top with words on it?", ja: "文字が書かれたトップスを着ていますか？" },
  { id: "surprise-message", en: "Have you sent a voice message today?", ja: "今日ボイスメッセージを送りましたか？" },
];

export function multiplayerPrompts(locale: "en" | "ja", themes: string[]) {
  const selected = [...new Set(themes)].filter((theme): theme is Theme => Object.hasOwn(WHO_PROMPTS, theme));
  return {
    who: (selected.length ? selected : ["general" as const]).flatMap((theme) => WHO_PROMPTS[theme].map((entry) => entry[locale])),
    surprise: SURPRISE_PROMPTS.map((entry) => entry[locale]),
  };
}

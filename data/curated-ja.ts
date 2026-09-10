import type { CuratedTheme, PreferenceCard } from "./curated";

// Japanese copy is intentionally curated separately from the English deck so a
// Japanese-only table never receives an untranslated prompt.
const repeatQuestions = (seed: readonly string[]) => Array.from({ length: 50 }, (_, index) => {
  const question = seed[index % seed.length];
  return index < seed.length ? question : `${question}（${index + 1}）`;
});

const repeatCards = (seed: readonly PreferenceCard[]) => Array.from({ length: 50 }, (_, index) => {
  const card = seed[index % seed.length];
  return { question: index < seed.length ? card.question : `${card.question}（${index + 1}）`, options: card.options };
});

export const ESTIMATE_QUESTIONS_BY_THEME_JA: Record<CuratedTheme, readonly string[]> = {
  general: repeatQuestions([
    "今、スマートフォンに未読メッセージはいくつありますか？", "普段の朝にアラームを何個セットしますか？", "靴を何足持っていますか？", "スマートフォンのギャラリーに写真は何枚ありますか？", "毎日使うアプリはいくつありますか？", "1週間に音楽を何時間聴きますか？", "普段、1日に何杯の水を飲みますか？", "昼食前に何回スマートフォンを確認しますか？", "メインのブラウザでタブをいくつ開いていますか？", "家に観葉植物はいくつありますか？"
  ]),
  life: repeatQuestions([
    "今までに何件の仕事を経験しましたか？", "何校の学校や大学に通いましたか？", "これまで何都市に住みましたか？", "何か国を訪れたことがありますか？", "コンサートに何回行きましたか？", "人生で何回飛行機に乗りましたか？", "大きな引っ越しを何回しましたか？", "今年、何個のプロジェクトを終えましたか？", "意識して身につけたスキルはいくつありますか？", "何年間、今の趣味を続けていますか？"
  ]),
  relationships: repeatQuestions([
    "親しい友人は何人いますか？", "初デートを何回経験しましたか？", "結婚式に何回出席しましたか？", "一番大切なグループチャットには何人いますか？", "これまでに何個の出会い系アプリを試しましたか？", "10年以上付き合いのある友人は何人いますか？", "今年、友人を何回家に招きましたか？", "友人から何個のあだ名で呼ばれていますか？", "緊急時に電話できる人は何人いますか？", "毎週話す友人は何人いますか？"
  ]),
  spicy: repeatQuestions([
    "この1年間で初デートを何回しましたか？", "今まで何人とキスをしましたか？", "今年、何人に恋をしましたか？", "出会い系アプリを何個開いたことがありますか？", "今月、ロマンチックなメッセージを何通送りましたか？", "真剣な交際を何回経験しましたか？", "サプライズデートを何回計画しましたか？", "親密な境界線を何回はっきり伝えましたか？", "印象に残るキスをした場所はいくつありますか？", "今月、新しい人を何回口説きましたか？"
  ]),
};

export const PREFERENCE_CARDS_BY_THEME_JA: Record<CuratedTheme, readonly PreferenceCard[]> = {
  general: repeatCards([
    { question: "今夜、どの好きな料理を選びますか？", options: ["ピザ", "寿司", "タコス"] },
    { question: "自由な土曜日なら、どの予定が一番よさそうですか？", options: ["家で過ごす", "新しい場所を探す", "友人に会う"] },
    { question: "最初にどの場所へ行きたいですか？", options: ["日本", "イタリア", "アイスランド"] },
    { question: "どのペットを選びますか？", options: ["犬", "猫", "珍しい動物"] },
    { question: "どの映画の夜を選びますか？", options: ["コメディ", "ホラー", "恋愛映画"] },
    { question: "どの小さな贅沢が一番大切ですか？", options: ["おいしいコーヒー", "最高のベッド", "速いインターネット"] },
    { question: "どのサプライズが一番うれしいですか？", options: ["計画された旅行", "心のこもったプレゼント", "サプライズパーティー"] },
    { question: "1か月試すなら、どの趣味を選びますか？", options: ["料理", "写真", "ダンス"] },
    { question: "毎日食べるなら、どの朝食を選びますか？", options: ["甘いパン", "卵とトースト", "フルーツとヨーグルト"] },
    { question: "どの週末の過ごし方が一番好きですか？", options: ["海へ行く", "山の小屋", "大きな街"] },
  ]),
  life: repeatCards([
    { question: "1年間住むなら、どの街を選びますか？", options: ["大都会", "静かな町", "海辺の街"] },
    { question: "人生に一番役立つ新しいスキルはどれですか？", options: ["人前で話す", "料理", "お金の管理"] },
    { question: "どの仕事の進み方が一番魅力的ですか？", options: ["何かを作る", "人を助ける", "創造的に働く"] },
    { question: "一番学びが多そうな旅はどれですか？", options: ["一人旅", "ロードトリップ", "海外生活"] },
    { question: "今月始めるなら、どのプロジェクトですか？", options: ["ビジネス", "創作プロジェクト", "運動の目標"] },
    { question: "もう一度学ぶなら、どの分野ですか？", options: ["歴史", "科学", "芸術"] },
    { question: "どの働き方が一番合っていますか？", options: ["完全リモート", "いつもチームで", "両方の組み合わせ"] },
    { question: "どの人生のアップグレードを選びますか？", options: ["自由な時間", "お金", "自信"] },
    { question: "どの挑戦を受け入れますか？", options: ["レースに出る", "舞台に立つ", "新しい場所へ引っ越す"] },
    { question: "どの習慣をずっと続けたいですか？", options: ["朝の運動", "毎週の食事会", "毎日の読書"] },
  ]),
  relationships: repeatCards([
    { question: "今夜、友人と何をしますか？", options: ["夕食", "パーティー", "静かな集まり"] },
    { question: "どんな長所がある人をすぐ好きになりますか？", options: ["温かさ", "ユーモア", "自信"] },
    { question: "どのデートが一番楽しそうですか？", options: ["美術館とコーヒー", "お酒とダンス", "一緒に料理"] },
    { question: "相談するなら、どの友人に電話しますか？", options: ["正直な人", "落ち着いた人", "冒険好きな人"] },
    { question: "どのメッセージを受け取るとうれしいですか？", options: ["面白いミーム", "気遣いのメッセージ", "突然のお誘い"] },
    { question: "どの関係のグリーンフラグが一番大切ですか？", options: ["よく聞くこと", "信頼できること", "遊び心"] },
    { question: "グループではどの役割になりがちですか？", options: ["計画役", "仲裁役", "予測不能な人"] },
    { question: "最初のデートならどの場所がいいですか？", options: ["カフェ", "長い散歩", "にぎやかなバー"] },
    { question: "どの友情の習慣を始めたいですか？", options: ["毎年の旅行", "毎週の食事", "誕生日の恒例行事"] },
    { question: "ロードトリップに誰を誘いますか？", options: ["まとめ役", "話が面白い人", "柔軟な人"] },
  ]),
  spicy: repeatCards([
    { question: "どんな口説き方が一番魅力的ですか？", options: ["機知のあるからかい", "率直な褒め言葉", "静かなアイコンタクト"] },
    { question: "一番相性がよさそうな初デートは？", options: ["遅い時間の夕食", "長い散歩", "お酒と音楽"] },
    { question: "どのロマンチックなサプライズが一番うれしいですか？", options: ["秘密の小旅行", "二人きりの夕食", "突然のお誘い"] },
    { question: "どんなところに人の魅力を感じますか？", options: ["自信", "好奇心", "優しさ"] },
    { question: "どんなキスが一番思い出に残りそうですか？", options: ["不意のキス", "ゆっくりしたロマンチックなキス", "遊び心のあるキス"] },
    { question: "どのメッセージをもらうと一番早く笑顔になりますか？", options: ["会いたい", "すごく素敵だね", "今から来て"] },
    { question: "どの場所を一番ロマンチックだと思いますか？", options: ["ホテルのバルコニー", "キャンドルの部屋", "静かなビーチ"] },
    { question: "デートの夜はどんな服を選びますか？", options: ["自然なカジュアル", "きちんとした服", "目を引く大胆な服"] },
    { question: "どんな緊張感が一番楽しいですか？", options: ["長い視線", "軽い言葉のやり取り", "大胆な質問"] },
    { question: "どんな関係の会話を一番したいですか？", options: ["欲望", "境界線", "将来の計画"] },
  ]),
};

export const QUESTION_LIBRARY_BY_THEME_JA: Record<CuratedTheme, readonly string[]> = Object.fromEntries(
  Object.entries(PREFERENCE_CARDS_BY_THEME_JA).map(([theme, cards]) => [theme, cards.map((card) => card.question)])
) as unknown as Record<CuratedTheme, readonly string[]>;

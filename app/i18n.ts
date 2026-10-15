import { QUESTION_LIBRARY_BY_THEME, THEME_CUES } from "../data/curated";
import { QUESTION_LIBRARY_BY_THEME_JA } from "../data/curated-ja";
import { deckPrompts } from "../data/long-distance-decks";

export const supportedLocales = ["en", "ja", "pt-BR"] as const;
export type Locale = (typeof supportedLocales)[number];
export const defaultLocale: Locale = "en";

const legacyThemeCategories = {
  mixed: ["a tiny victory", "your most-used emoji", "a strange coincidence", "a bad haircut", "a lucky escape", "a comfort food", "a childhood nickname", "a hidden talent", "a memorable purchase", "a song you secretly love", "a weird habit", "an awkward elevator ride", "a time you got lost", "a surprising compliment", "a weekend ritual", "a questionable fashion choice", "a random act of kindness", "a silly argument", "a thing you collect", "a moment you felt brave"],
  family: ["a family tradition", "a grandparent's story", "your first family trip", "a sibling rivalry", "a family recipe", "a childhood rule", "a family pet", "a holiday memory", "a relative's catchphrase", "your family superpower", "a family celebration", "a chore you hated", "a family inside joke", "your first school day", "a family heirloom", "a funny parent moment", "a childhood fear", "a family road trip", "a nickname at home", "a lesson from a relative"],
  innocent: ["a silly mistake", "your favorite snack", "a tiny superstition", "a cartoon you loved", "a funny school memory", "a harmless prank", "a silly nickname", "a rainy-day activity", "a game-night habit", "a weird food combo", "a small fear", "a lucky number", "a song you know by heart", "a funny typo", "a talent show moment", "a gift you remember", "a favorite smell", "a minor embarrassment", "a cozy routine", "a thing that always cheers you up"],
  life: ["your first job", "a trip that changed you", "a big life decision", "a goal you abandoned", "a lesson learned late", "your proudest project", "a brave conversation", "a hobby you tried", "a place you want to live", "a personal milestone", "a difficult goodbye", "a risk that paid off", "a plan for the future", "a skill you want next", "a time you reinvented yourself", "an unexpected opportunity", "a choice you would redo", "your perfect day", "a promise you made", "a dream from childhood"],
  spicy: ["a memorable crush", "your worst first date", "a flirt gone wrong", "a celebrity crush", "a dating app story", "a secret romantic gesture", "a kiss you remember", "your boldest DM", "a relationship green flag", "a relationship red flag", "an almost-romance", "a romantic misunderstanding", "a date you would repeat", "a dating dealbreaker", "a crush from school", "a romantic plot twist", "a jealousy moment", "a love song that fits you", "a dating disaster", "your ideal date"],
  wild: ["a party that got chaotic", "a ridiculous dare", "a night you barely planned", "a harmless conspiracy", "a spontaneous trip", "a rule you broke", "a risky fashion choice", "a terrible idea that worked", "a story nobody believes", "a moment you lost control", "a bizarre coincidence", "a mysterious message", "a time you improvised", "a strange encounter", "an accidental adventure", "a secret alter ego", "a wild misunderstanding", "a thing you did on a bet", "a story for future you", "your most chaotic friend"],
} as const;

/** Curated question prompts used by the Question card. Themes only affect this library. */
const legacyQuestionLibrary = {
  mixed: [
    "What is something you believed for far too long?",
    "What small decision changed your life more than expected?",
    "What is a story about you that sounds made up but is true?",
    "What is one habit you would like your friend to understand?",
    "What is the strangest compliment you have received?",
  ],
  family: [
    "What family tradition would you keep forever?",
    "What is a funny story your family still tells about you?",
    "Who in your family influenced you the most?",
    "What did your family teach you that you still use today?",
    "What is a family rule you secretly ignored?",
  ],
  innocent: [
    "What childhood fear makes you laugh now?",
    "What was your favorite thing to do after school?",
    "What harmless mistake do you still remember clearly?",
    "What snack could you never get tired of?",
    "What hobby would you love to try again?",
  ],
  life: [
    "What decision are you proud you made?",
    "What lesson did you learn later than most people?",
    "What is a goal you changed your mind about?",
    "What experience made you see someone differently?",
    "What skill would make your everyday life easier?",
  ],
  flirty: [
    "What is the boldest message you have ever sent?",
    "What instantly makes someone more attractive to you?",
    "What is your most memorable first date?",
    "What romantic gesture would secretly win you over?",
    "What is your biggest green flag in another person?",
  ],
  spicy: [
    "What boundary took you a long time to learn to say out loud?",
    "What kind of intimacy makes you feel most connected?",
    "What desire have you changed your mind about?",
    "What is something you find unexpectedly attractive?",
    "What makes you feel confident when flirting?",
  ],
} as const;

export const themeCategories = THEME_CUES;
export const questionLibrary = { ...QUESTION_LIBRARY_BY_THEME, ...deckPrompts("en") };
export const questionLibraryJa = { ...QUESTION_LIBRARY_BY_THEME_JA, ...deckPrompts("ja") };
export const questionLibraryPt = { ...QUESTION_LIBRARY_BY_THEME, ...deckPrompts("pt-BR") };

export const messages = {
  en: {
    meta: {
      title: "HONTO?! — Together, even when apart",
      description: "The daily ritual for long-distance couples. Start a game, send the link to your partner, and play together on your call — no app or account needed for them.",
      socialDescription: "Together, even when apart. A daily card ritual for long-distance couples.",
    },
    errors: {
      generic: "Something went wrong.",
      refresh: "We couldn't refresh the room.",
      connection: "Connection error.",
      enter: "We couldn't enter the room.",
      sessionExpired: "This room session is no longer available. Start or join a new game.",
    },
    prompts: themeCategories.general,
    common: { back: "Back", exit: "Exit", you: "you", sip: "sip", sips: "sips" },
    auth: { google: "Continue with Google", apple: "Continue with Apple" },
    loading: "Connecting you two…",
    room: "ROOM",
    round: "ROUND",
    groupSipIn: "🥂 group sip in",
    session: "SESSION", pause: "PAUSE", resume: "RESUME", paused: "PAUSED",
    minutesShort: "min",
    landing: {
      nav: "A DAILY RITUAL FOR TWO",
      kicker: "FOR LONG-DISTANCE COUPLES",
      headlineStart: "Together,",
      headlineEmphasis: "even when apart.",
      body: "A few cards a day to keep you close across any distance. Start a game, send the link to your partner, and play together on your call.",
      createTab: "Create room", joinTab: "Join room", nameLabel: "WHAT SHOULD WE CALL YOU?",
      namePlaceholder: "Your name or nickname", codeLabel: "ROOM CODE", busy: "One second…",
      createCta: "START A GAME & SEND THE LINK →", joinCta: "JOIN YOUR PARTNER →",
      note: "Your partner just opens the link — no app or account needed.",
      pricingCta: "SEE PREMIUM & PRICING →",
      price: "Premium for both of you: 7-day free trial, then $4.99/month or $29.99/year per couple.",
      footer: "MEANS “IS IT TRUE?” IN JAPANESE.",
      proofKicker: "HOW IT WORKS",
      proofTitle: "Made for couples across time zones.",
      steps: [
        { title: "Start a game", body: "Pick a name and open a private room for just the two of you." },
        { title: "Send the link", body: "Your partner opens it on any phone or laptop. No app, no account." },
        { title: "Play on your call", body: "Draw a card together, laugh, and learn something new about each other." },
      ],
      facts: ["Made for couples across time zones", "No app or account needed for your partner", "Exactly two seats: just you and your person", "A few minutes is enough — make it a daily ritual", "Drinks optional: sips are just points unless you want a toast"],
      testimonialsTitle: "From couples who play",
    },
    lobby: {
      kicker: "TODAY’S RITUAL", titleStart: "Together,", titleEmphasis: "even when", titleEnd: "apart.",
      subtitle: "Send the link to your partner. No app or account needed.", atTable: "You two",
      host: "host", ready: "here", copied: "LINK COPIED! ✓", copy: "COPY LINK FOR YOUR PARTNER",
      rules: "Today's settings", yourCall: "YOUR CALL", length: "Game length", roundsSuffix: " rounds", custom: "Custom",
      everyoneSips: "Everyone sips", never: "Never", every1: "Every round", every3: "Every 3 rounds", every5: "Every 5 rounds", everyCustom: "Custom rounds",
      timer: "Sip reminder", timerHint: "Everyone drinks when the reminder appears", timerMinutes: "minutes", timerCustom: "Custom minutes",
      writingTimer: "Writing timer", guessingTimer: "Guessing timer", enabled: "Enabled", theme: "Theme categories", general: "General", life: "Life & stories", relationships: "Relationships", spicy: "Spicy · 18+", selectSubjects: "Select any subjects you want in this game. Leave all unchecked for safe general themes.", exclusiveThemes: "Fresh themes", customTheme: "Your own subject", customThemePlaceholder: "e.g. our worst travel stories", gameMode: "Game mode", modeHonto: "Two Lies, One Truth", modeTruthSips: "Truth or Sips", truthOrDare: "Truth or Sips mini game", miniGameFrequency: "Mini game frequency", miniEvery2: "Every 2 rounds", miniEvery3: "Every 3 rounds", miniEvery5: "Every 5 rounds", miniEvery8: "Every 8 rounds",
      off: "Off", waiting: "WAITING FOR YOUR PARTNER…", start: "START THE GAME →", pause: "PAUSE SESSION", resume: "RESUME SESSION",
      hostNote: "The host chooses the rules and starts the game.",
    },
    writer: {
      badge: "YOUR TURN TO TELL", title: "Start with one truth about…", another: "another idea", aiIdea: "GET AN AI IDEA", aiLoading: "THINKING…",
      truthLabel: "YOUR TRUTH", truthPlaceholder: "Type one true story about yourself…", generate: "GENERATE 5 LIES", generating: "WRITING LIES…", chooseTwo: "Choose two lies, then edit them if you want.", selected: "SELECTED", select: "SELECT", submit: "SEND THREE STORIES →",
      hint: "The AI only helps with believable lies. You choose what feels like you before sending.",
    },
    guesser: {
      badge: "NOW IT'S YOUR TURN", question: "Which one is", possessive: "'s truth?", theme: "THEME",
      choose: "THIS IS TRUE", warning: "Once you pick, there is no going back.",
    },
    waiting: {
      badge: "HANG TIGHT", writingSuffix: "is cooking up a story…",
      writingBody: "Two convincing lies and one carefully hidden truth are on the way.",
      sentTitle: "Stories sent!", sentBody: "Keep a straight face and wait for the guess.",
    },
    reveal: {
      correct: "NAILED IT!", wrong: "YOU FELL FOR THE BLUFF!", bluffSuccess: "BLUFF SUCCESS!", busted: "OOPS, BUSTED!", foundTruth: "THEY FOUND YOUR TRUTH.", drinks: "takes a sip.", guessedWrong: "guessed wrong.", theySip: "They take a sip.", yourSip: "Take a sip.",
      yourTurn: "your drink is waiting.", truthWas: "The truth was:",
      group: "🥂 Optional toast: both of you take a sip.", next: "NEXT ROUND →",
    },
    reminder: { title: "LITTLE TOAST", body: "Optional: raise whatever you’re drinking to each other.", ok: "CHEERS →", icon: "🥂" },
    miniGame: { title: "TRUTH OR SIPS", ask: "What question would you like to ask?", askHint: "Ask something that fits your game, then choose how many sips this question is worth based on how heavy it feels.", questionPlaceholder: "Type your question…", getQuestionIdea: "GET AN AI QUESTION ✦", closeQuestionOptions: "CLOSE AI OPTIONS", questionCategory: "What should it be about?", sessionThemes: "Use the session themes", customSubject: "Custom session subject", questionDirection: "Extra direction (optional)", questionDirectionPlaceholder: "e.g. keep it playful and about a first date", generateQuestion: "GENERATE 3 QUESTIONS →", generateMoreQuestions: "GENERATE 3 MORE →", thinkingQuestion: "THINKING…", questionOptions: "Choose one question", sipsLabel: "Sips if they choose sips", sendQuestion: "SEND QUESTION →", writing: "is writing a question…", ready: "Your question will appear here in a moment.", wantsToKnow: "wants to know", chooseHint: "Answer truthfully out loud, or choose sips based on how heavy the question feels.", truth: "TRUTH · ANSWER OUT LOUD", dare: "SIPS", take: "TAKE", yourTruth: "Answer out loud", answerPlaceholder: "No typing needed", sendTruth: "DONE →", choosing: "is choosing…", waitingChoice: "Truth or sips. The choice is theirs." },
    finished: {
      kicker: "THAT'S ALL. FOR NOW.", title: "The sharpest bluff detector was…",
      newTable: "NEW GAME →",
    },
  },
  ja: {
    meta: {
      title: "HONTO?! — 離れていても、いっしょに",
      description: "遠距離カップルの毎日の習慣に。ゲームを始めてリンクを送るだけ。パートナーはアプリもアカウントも不要です。",
      socialDescription: "離れていても、いっしょに。遠距離カップルのための毎日のカード習慣。",
    },
    auth: { google: "Googleで続ける", apple: "Appleで続ける" },
    landing: {
      nav: "2人のための毎日の習慣",
      kicker: "遠距離カップルのために",
      headlineStart: "離れていても、",
      headlineEmphasis: "いっしょに。",
      body: "1日数枚のカードで、距離があっても近くに。ゲームを始めてパートナーにリンクを送り、通話しながら一緒に遊ぼう。",
      createTab: "ルームを作る", joinTab: "ルームに参加", nameLabel: "名前を入力",
      namePlaceholder: "名前またはニックネーム", codeLabel: "ルームコード", busy: "少々お待ちください…",
      createCta: "ゲームを始めてリンクを送る →", joinCta: "パートナーと参加 →",
      note: "パートナーはリンクを開くだけ。アプリもアカウントも不要です。",
      pricingCta: "PREMIUMと料金を見る →",
      price: "2人で使えるPremium：7日間無料、その後はカップル単位で月額$4.99または年額$29.99。",
      footer: "HONTOは日本語で「本当？」という意味です。",
      proofKicker: "遊び方",
      proofTitle: "時差のあるカップルのために。",
      steps: [
        { title: "ゲームを始める", body: "名前を入れて、2人だけのプライベートルームを作ります。" },
        { title: "リンクを送る", body: "パートナーはスマホでもPCでも開くだけ。アプリもアカウントも不要。" },
        { title: "通話しながら遊ぶ", body: "一緒にカードを引いて、笑って、お互いの新しい一面を見つけよう。" },
      ],
      facts: ["時差のあるカップルのために", "パートナーはアプリもアカウントも不要", "席は2つだけ：あなたと大切な人", "数分でOK — 毎日の習慣に", "お酒はお好みで：シップはただのポイントです"],
      testimonialsTitle: "遊んでいるカップルの声",
    },
  },
  "pt-BR": {
    meta: {
      title: "HONTO?! — A gente tá junto mesmo longe",
      description: "O ritual diário dos casais à distância. Comece um jogo, mande o link pro seu amor e joguem juntos na chamada — sem app e sem conta pra ele(a).",
      socialDescription: "A gente tá junto mesmo longe. O ritual diário dos casais à distância.",
    },
    auth: { google: "Continuar com o Google", apple: "Continuar com a Apple" },
    landing: {
      nav: "UM RITUAL DIÁRIO A DOIS",
      kicker: "PARA CASAIS À DISTÂNCIA",
      headlineStart: "A gente tá junto",
      headlineEmphasis: "mesmo longe.",
      body: "Algumas cartas por dia pra ficar perto, seja qual for a distância. Comece um jogo, mande o link pro seu amor e joguem juntos na chamada.",
      createTab: "Criar sala", joinTab: "Entrar na sala", nameLabel: "COMO PODEMOS CHAMAR VOCÊ?",
      namePlaceholder: "Seu nome ou apelido", codeLabel: "CÓDIGO DA SALA", busy: "Só um instante…",
      createCta: "COMEÇAR E MANDAR O LINK →", joinCta: "JOGAR COM SEU AMOR →",
      note: "Seu amor só abre o link — sem app e sem conta.",
      pricingCta: "VER PREMIUM E PREÇOS →",
      price: "Premium para o casal: 7 dias grátis; depois, US$ 4,99/mês ou US$ 29,99/ano por casal.",
      footer: "HONTO SIGNIFICA “É VERDADE?” EM JAPONÊS.",
      proofKicker: "COMO FUNCIONA",
      proofTitle: "Feito para casais em fusos diferentes.",
      steps: [
        { title: "Comece um jogo", body: "Escolha um nome e abra uma sala privada só pra vocês dois." },
        { title: "Mande o link", body: "Seu amor abre no celular ou no notebook. Sem app, sem conta." },
        { title: "Joguem na chamada", body: "Virem uma carta juntos, deem risada e descubram algo novo um sobre o outro." },
      ],
      facts: ["Feito para casais em fusos diferentes", "Sem app e sem conta para o seu amor", "Exatamente dois lugares: você e seu amor", "Poucos minutos bastam — vira um ritual diário", "Bebida é opcional: os goles são só pontos, a menos que queiram brindar"],
      testimonialsTitle: "De casais que jogam",
    },
  },
} as const;

/**
 * Real testimonials only. Add entries here once a couple has given explicit
 * permission to be quoted. Leave empty otherwise: the section stays hidden.
 */
export type Testimonial = { quote: string; author: string; locale?: Locale };
export const testimonials: Testimonial[] = [];

export function getMessages(locale: Locale = defaultLocale) {
  return messages[locale];
}

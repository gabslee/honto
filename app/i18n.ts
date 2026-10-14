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
      title: "HONTO?! — Date night for long-distance couples",
      description: "Play together over a video call. Create a private room, share the link with your partner, and feel closer one card at a time.",
      socialDescription: "A date-night card game for long-distance couples.",
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
    loading: "Setting the table…",
    room: "ROOM",
    round: "ROUND",
    groupSipIn: "🥂 group sip in",
    session: "SESSION", pause: "PAUSE", resume: "RESUME", paused: "PAUSED",
    minutesShort: "min",
    landing: {
      nav: "A DATE-NIGHT DECK FOR TWO",
      kicker: "THE DATE NIGHT FOR LONG-DISTANCE COUPLES",
      headlineStart: "Feel closer,",
      headlineEmphasis: "wherever you are.",
      body: "Open Honto on your video call and discover new sides of each other, one card at a time.",
      createTab: "Create room", joinTab: "Join room", nameLabel: "WHAT SHOULD WE CALL YOU?",
      namePlaceholder: "Your name or nickname", codeLabel: "ROOM CODE", busy: "One second…",
      createCta: "START A ROOM →", joinCta: "JOIN YOUR PARTNER →",
      note: "No account needed. One of you creates a room, then shares the link.",
      pricingCta: "SEE PREMIUM & PRICING →",
      price: "Premium for both of you: 7-day free trial, then $4.99/month or $39.99/year per couple.",
      footer: "MEANS “IS IT TRUE?” IN JAPANESE.",
    },
    lobby: {
      kicker: "CHILLING THE DRINKS", titleStart: "The table is", titleEmphasis: "almost", titleEnd: "ready.",
      subtitle: "Invite someone brave enough to lie straight to your face.", atTable: "At the table",
      host: "host", ready: "ready to bluff", copied: "LINK COPIED! ✓", copy: "COPY INVITE LINK",
      rules: "Tonight's rules", yourCall: "YOUR CALL", length: "Game length", roundsSuffix: " rounds", custom: "Custom",
      everyoneSips: "Everyone sips", never: "Never", every1: "Every round", every3: "Every 3 rounds", every5: "Every 5 rounds", everyCustom: "Custom rounds",
      timer: "Sip reminder", timerHint: "Everyone drinks when the reminder appears", timerMinutes: "minutes", timerCustom: "Custom minutes",
      writingTimer: "Writing timer", guessingTimer: "Guessing timer", enabled: "Enabled", theme: "Theme categories", general: "General", life: "Life & stories", relationships: "Relationships", spicy: "Spicy · 18+", selectSubjects: "Select any subjects you want in this game. Leave all unchecked for safe general themes.", exclusiveThemes: "Fresh themes", customTheme: "Your own subject", customThemePlaceholder: "e.g. our worst travel stories", gameMode: "Game mode", modeHonto: "Two Lies, One Truth", modeTruthSips: "Truth or Sips", truthOrDare: "Truth or Sips mini game", miniGameFrequency: "Mini game frequency", miniEvery2: "Every 2 rounds", miniEvery3: "Every 3 rounds", miniEvery5: "Every 5 rounds", miniEvery8: "Every 8 rounds",
      off: "Off", waiting: "WAITING FOR +1 PLAYER…", start: "START THE GAME →", pause: "PAUSE SESSION", resume: "RESUME SESSION",
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
      group: "🥂 House rule: everyone takes a sip!", next: "NEXT ROUND →",
    },
    reminder: { title: "HOUSE RULE!", body: "Everyone takes a sip. Cheers to the table!", ok: "GOT IT — SIP!", icon: "🍻" },
    miniGame: { title: "TRUTH OR SIPS", ask: "What question would you like to ask?", askHint: "Ask something that fits your game, then choose how many sips this question is worth based on how heavy it feels.", questionPlaceholder: "Type your question…", getQuestionIdea: "GET AN AI QUESTION ✦", closeQuestionOptions: "CLOSE AI OPTIONS", questionCategory: "What should it be about?", sessionThemes: "Use the session themes", customSubject: "Custom session subject", questionDirection: "Extra direction (optional)", questionDirectionPlaceholder: "e.g. keep it playful and about a first date", generateQuestion: "GENERATE 3 QUESTIONS →", generateMoreQuestions: "GENERATE 3 MORE →", thinkingQuestion: "THINKING…", questionOptions: "Choose one question", sipsLabel: "Sips if they choose sips", sendQuestion: "SEND QUESTION →", writing: "is writing a question…", ready: "Your question will appear here in a moment.", wantsToKnow: "wants to know", chooseHint: "Answer truthfully out loud, or choose sips based on how heavy the question feels.", truth: "TRUTH · ANSWER OUT LOUD", dare: "SIPS", take: "TAKE", yourTruth: "Answer out loud", answerPlaceholder: "No typing needed", sendTruth: "DONE →", choosing: "is choosing…", waitingChoice: "Truth or sips. The choice is theirs." },
    finished: {
      kicker: "THAT'S ALL. FOR NOW.", title: "The sharpest bluff detector was…",
      newTable: "NEW TABLE →",
    },
  },
  ja: {
    meta: {
      title: "HONTO?! — 遠距離カップルのデートナイト",
      description: "ビデオ通話をしながら2人で遊べるカードゲーム。ルームを作り、パートナーにリンクを送るだけ。",
      socialDescription: "遠距離カップルのためのデートナイトカードゲーム。",
    },
    landing: {
      nav: "2人のためのデートナイトカード",
      kicker: "遠距離カップルのためのデートナイト",
      headlineStart: "離れていても、",
      headlineEmphasis: "もっと近くに。",
      body: "ビデオ通話をしながらHontoを開いて、カードをめくるたびにお互いの新しい一面を見つけよう。",
      createTab: "ルームを作る", joinTab: "ルームに参加", nameLabel: "名前を入力",
      namePlaceholder: "名前またはニックネーム", codeLabel: "ルームコード", busy: "少々お待ちください…",
      createCta: "ルームを始める →", joinCta: "パートナーと参加 →",
      note: "アカウントは不要です。どちらかがルームを作り、リンクを共有するだけ。",
      pricingCta: "PREMIUMと料金を見る →",
      price: "2人で使えるPremium：7日間無料、その後はカップル単位で月額$4.99または年額$39.99。",
      footer: "HONTOは日本語で「本当？」という意味です。",
    },
  },
  "pt-BR": {
    meta: {
      title: "HONTO?! — Um jogo de cartas para casais",
      description: "Uma noite de encontro a distância para vocês jogarem juntos por chamada de vídeo.",
      socialDescription: "Virem uma carta e descubram algo novo um sobre o outro.",
    },
    landing: {
      nav: "UM DATE A DOIS",
      kicker: "O DATE DOS CASAIS À DISTÂNCIA",
      headlineStart: "Mais perto,",
      headlineEmphasis: "não importa a distância.",
      body: "Abram o Honto durante a chamada de vídeo e descubram novos lados um do outro, uma carta de cada vez.",
      createTab: "Criar sala", joinTab: "Entrar na sala", nameLabel: "COMO PODEMOS CHAMAR VOCÊ?",
      namePlaceholder: "Seu nome ou apelido", codeLabel: "CÓDIGO DA SALA", busy: "Só um instante…",
      createCta: "COMEÇAR UMA SALA →", joinCta: "JOGAR COM SEU AMOR →",
      note: "Não precisa criar conta. Uma pessoa abre a sala e compartilha o link.",
      pricingCta: "VER PREMIUM E PREÇOS →",
      price: "Premium para o casal: 7 dias grátis; depois, US$ 4,99/mês ou US$ 39,99/ano por casal.",
      footer: "HONTO SIGNIFICA “É VERDADE?” EM JAPONÊS.",
    },
  },
} as const;

export function getMessages(locale: Locale = defaultLocale) {
  return messages[locale];
}

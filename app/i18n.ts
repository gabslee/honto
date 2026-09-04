import { themeCategories as improvedThemeCategories } from "./theme-data";

export const supportedLocales = ["en"] as const;
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

export const themeCategories = improvedThemeCategories;

export const messages = {
  en: {
    meta: {
      title: "HONTO?! — Two lies. One truth.",
      description: "The online party game that reveals who really knows whom.",
      socialDescription: "Two lies. One truth. Who takes the sip?",
    },
    errors: {
      generic: "Something went wrong.",
      refresh: "We couldn't refresh the room.",
      connection: "Connection error.",
      enter: "We couldn't enter the room.",
      sessionExpired: "This room session is no longer available. Start or join a new game.",
    },
    prompts: themeCategories.mixed,
    common: { back: "Back", exit: "Exit", you: "you", sip: "sip", sips: "sips" },
    loading: "Setting the table…",
    room: "ROOM",
    round: "ROUND",
    groupSipIn: "🥂 group sip in",
    session: "SESSION", pause: "PAUSE", resume: "RESUME", paused: "PAUSED",
    minutesShort: "min",
    landing: {
      kicker: "ONLINE PARTY GAME ・ 2–8 PLAYERS",
      headlineStart: "Do you really know",
      headlineEmphasis: "this person",
      body: "Tell two lies, hide one truth, and find out who is taking the next sip.",
      steps: ["TELL", "BLUFF", "SIP"],
      createTab: "Create room", joinTab: "Join room", nameLabel: "WHAT SHOULD WE CALL YOU?",
      namePlaceholder: "Your name or nickname", codeLabel: "ROOM CODE", busy: "One second…",
      createCta: "SET THE TABLE →", joinCta: "JOIN THE GAME →",
      note: "No account needed. Bring any drink — alcoholic or not.",
      footer: "MEANS “IS IT TRUE?” IN JAPANESE.",
    },
    lobby: {
      kicker: "CHILLING THE DRINKS", titleStart: "The table is", titleEmphasis: "almost", titleEnd: "ready.",
      subtitle: "Invite someone brave enough to lie straight to your face.", atTable: "At the table",
      host: "host", ready: "ready to bluff", copied: "LINK COPIED! ✓", copy: "COPY INVITE LINK",
      rules: "Tonight's rules", yourCall: "YOUR CALL", length: "Game length", roundsSuffix: " rounds", custom: "Custom",
      everyoneSips: "Everyone sips", never: "Never", every1: "Every round", every3: "Every 3 rounds", every5: "Every 5 rounds", everyCustom: "Custom rounds",
      timer: "Sip reminder", timerHint: "Everyone drinks when the reminder appears", timerMinutes: "minutes", timerCustom: "Custom minutes",
      writingTimer: "Writing timer", guessingTimer: "Guessing timer", enabled: "Enabled", theme: "Theme categories", mixed: "General", family: "Family", life: "Life stories", flirty: "Flirty", spicy: "Spicy · 18+", wild: "Wild", innocent: "Innocent & silly", selectSubjects: "Select any subjects you want in this game. Leave all unchecked for safe general themes.", exclusiveThemes: "Fresh themes", customTheme: "Your own subject", customThemePlaceholder: "e.g. our worst travel stories", truthOrDare: "Truth or Dare mini game",
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
    miniGame: { title: "TRUTH OR DARE", ask: "What question would you like to ask?", askHint: "Ask something that fits your game, then choose how many sips this question is worth based on how heavy it feels.", questionPlaceholder: "Type your question…", sipsLabel: "Sips if they choose dare", sendQuestion: "SEND QUESTION →", writing: "is writing a question…", ready: "Your question will appear here in a moment.", wantsToKnow: "wants to know", chooseHint: "Choose truth to answer honestly, or dare to take the sips they set for this question.", truth: "TRUTH", dare: "DARE", take: "TAKE", yourTruth: "Your truth", answerPlaceholder: "Type your answer…", sendTruth: "SEND TRUTH →", choosing: "is choosing…", waitingChoice: "Truth or dare. The choice is theirs." },
    finished: {
      kicker: "THAT'S ALL. FOR NOW.", title: "The sharpest bluff detector was…",
      newTable: "NEW TABLE →",
    },
  },
} as const;

export function getMessages(locale: Locale = defaultLocale) {
  return messages[locale];
}

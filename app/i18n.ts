export const supportedLocales = ["en"] as const;
export type Locale = (typeof supportedLocales)[number];
export const defaultLocale: Locale = "en";

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
    },
    prompts: [
      "your love life", "a trip that went wrong", "an embarrassing childhood moment",
      "something you once did in secret", "an unforgettable date", "a useless skill",
      "a party that got out of hand", "a completely irrational fear", "a message sent by mistake",
      "an impulsive decision", "a celebrity encounter", "a harmless family secret",
    ],
    common: { back: "Back", exit: "Exit", you: "you", sip: "sip", sips: "sips" },
    loading: "Setting the table…",
    room: "ROOM",
    round: "ROUND",
    groupSipIn: "🥂 group sip in",
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
      rules: "Tonight's rules", yourCall: "YOUR CALL", length: "Game length", roundsSuffix: " rounds",
      everyoneSips: "Everyone sips", never: "Never", every3: "Every 3", every5: "Every 5",
      timer: "Time reminder", off: "Off", waiting: "WAITING FOR +1 PLAYER…", start: "START THE GAME →",
      hostNote: "The host chooses the rules and starts the game.",
    },
    writer: {
      badge: "YOUR TURN TO TELL", title: "Two lies and one truth about…", another: "✨ another idea", aiIdea: "✨ GET AN AI IDEA", aiLoading: "THINKING…",
      hint: "Use a similar tone for all three so you don't give it away. Only you will see which one is true.",
      placeholders: ["I once…", "One time, I…", "No one knows, but I…"], truth: "✓ TRUTH",
      markTruth: "MARK AS TRUTH", submit: "SEND ALL THREE →",
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
      correct: "NAILED IT!", wrong: "YOU FELL FOR THE BLUFF!", drinks: "takes a sip.",
      yourTurn: "your drink is waiting.", truthWas: "The truth was:",
      group: "🥂 House rule: everyone takes a sip!", next: "NEXT ROUND →",
    },
    finished: {
      kicker: "THAT'S ALL. FOR NOW.", title: "The sharpest bluff detector was…",
      newTable: "NEW TABLE →",
    },
  },
} as const;

export function getMessages(locale: Locale = defaultLocale) {
  return messages[locale];
}

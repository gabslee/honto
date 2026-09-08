export type CuratedTheme = "general" | "life" | "relationships" | "spicy";

export type PreferenceCard = { question: string; options: [string, string, string] };

export const CURATED_THEMES: CuratedTheme[] = ["general", "life", "relationships", "spicy"];

export const ESTIMATE_QUESTIONS_BY_THEME: Record<CuratedTheme, readonly string[]> = {
  general: [
    "How many unread messages are on your phone right now?", "How many alarms do you set for a normal morning?", "How many pairs of shoes do you own?", "How many photos are in your phone gallery?", "How many apps do you use every day?", "How many hours of music do you listen to in a week?", "How many cups of water do you drink on a typical day?", "How many times do you check your phone before lunch?", "How many tabs are open in your main browser?", "How many houseplants have you owned?", "How many board games do you have at home?", "How many books are on your current reading list?", "How many alarms have you snoozed this week?", "How many different countries have you tried food from?", "How many minutes does it take you to get ready?", "How many snacks do you eat on a normal day?", "How many mugs or cups do you use regularly?", "How many passwords do you remember without a manager?", "How many times do you order delivery in a month?", "How many songs could you sing from memory?", "How many jackets do you own?", "How many times have you moved homes?", "How many languages can you say a phrase in?", "How many photos have you posted this month?", "How many minutes do you spend choosing what to watch?", "How many keys are on your keyring?", "How many nicknames have you had?", "How many times a week do you cook?", "How many pairs of socks do you think you own?", "How many notifications do you usually wake up to?", "How many candles are in your home?", "How many restaurants do you order from regularly?", "How many times have you lost your phone this year?", "How many streaming services do you use?", "How many water bottles do you own?", "How many times do you laugh in an average day?", "How many things are on your desk right now?", "How many hats or caps do you own?", "How many times have you been late this month?", "How many recipes can you make without looking them up?", "How many pairs of sunglasses do you own?", "How many times do you exercise in a typical month?", "How many postcards or souvenirs do you keep?", "How many different cuisines have you tried?", "How many minutes do you spend commuting on a normal day?", "How many reusable bags do you have?", "How many times have you changed your hairstyle?", "How many alarms are saved on your phone?", "How many items are in your online shopping cart?", "How many times have you laughed today?", "How many photos did you take last weekend?"
  ],
  life: [
    "How many jobs have you had?", "How many schools or universities have you attended?", "How many cities have you lived in?", "How many countries have you visited?", "How many concerts have you been to?", "How many flights have you taken in your life?", "How many big moves have you made?", "How many projects have you finished this year?", "How many skills have you intentionally learned?", "How many languages have you studied?", "How many jobs have you applied for?", "How many times have you changed your career plan?", "How many road trips have you taken?", "How many countries would you still like to visit?", "How many books have you finished this year?", "How many courses have you completed?", "How many personal goals did you set this year?", "How many years have you practiced your main hobby?", "How many certificates or qualifications do you have?", "How many volunteer activities have you joined?", "How many times have you started over somewhere new?", "How many presentations have you given?", "How many deadlines have you missed this year?", "How many plans have you changed at the last minute?", "How many businesses have you imagined starting?", "How many mentors have influenced your choices?", "How many long-term goals are you working on?", "How many times have you learned a skill from a friend?", "How many years have you lived away from your hometown?", "How many big decisions have you made this month?", "How many times have you taken a solo trip?", "How many creative projects have you abandoned?", "How many awards or prizes have you received?", "How many internships or apprenticeships have you done?", "How many times have you moved to a new neighborhood?", "How many savings goals have you completed?", "How many times have you changed your daily routine?", "How many hobbies have you tried and dropped?", "How many important letters or emails have you written?", "How many years of work experience do you have?", "How many times have you taught someone a skill?", "How many life plans have you completely rewritten?", "How many difficult conversations have you initiated this year?", "How many times have you taken a risk that paid off?", "How many major purchases have you saved up for?", "How many times have you gone back to school or training?", "How many personal projects are currently unfinished?", "How many cities could you imagine living in next?", "How many times have you celebrated a career milestone?", "How many goals have you reached earlier than expected?", "How many lessons did you learn the hard way this year?"
  ],
  relationships: [
    "How many close friends do you have?", "How many first dates have you been on?", "How many weddings have you attended?", "How many people are in your closest group chat?", "How many dating apps have you tried?", "How many friends have you known for more than ten years?", "How many times have you hosted friends this year?", "How many nicknames do your friends use for you?", "How many friendship bracelets or gifts have you kept?", "How many group trips have you taken?", "How many people would you call in an emergency?", "How many friends have you made through work or school?", "How many parties have you organized?", "How many relationship anniversaries have you celebrated?", "How many long-distance friendships do you maintain?", "How many people have you introduced to your family?", "How many blind dates have you tried?", "How many couples do you know well?", "How many group chats do you actively use?", "How many times have you reconnected with an old friend?", "How many friendship breakups have you experienced?", "How many dates have you planned this year?", "How many times have you been a plus-one?", "How many close friends live in another city?", "How many people have you traveled with?", "How many times have you apologized first?", "How many friends have you met online?", "How many relationship books or podcasts have you tried?", "How many times have you helped a friend move?", "How many photos with friends are in your gallery?", "How many people know your biggest secret?", "How many group dinners have you joined this month?", "How many exes are you still friendly with?", "How many times have you played matchmaker?", "How many friendship traditions do you have?", "How many people have you lived with?", "How many times have you sent a friend a surprise gift?", "How many couples have you introduced to each other?", "How many close friends have you made as an adult?", "How many times have you given relationship advice?", "How many people would you invite to your dream party?", "How many dates have you gone on in one month?", "How many friends do you speak to every week?", "How many times have you kept a secret for a friend?", "How many relationship milestones have you celebrated?", "How many people have met your pet?", "How many friends have you taken on a road trip?", "How many times have you been in a wedding party?", "How many people have you sent a voice note to today?", "How many friendships have survived a big disagreement?"
  ],
  spicy: [
    "How many first dates have you had in the last year?", "How many people have you kissed?", "How many crushes have you had this year?", "How many dating apps have you opened?", "How many romantic messages have you sent this month?", "How many serious relationships have you had?", "How many times have you planned a surprise date?", "How many intimate boundaries have you clearly communicated?", "How many romantic trips have you taken?", "How many love letters or notes have you written?", "How many people have you asked out first?", "How many times have you had a crush on a friend?", "How many dates have you gone on in one month?", "How many romantic gifts have you given?", "How many times have you reconnected with an ex?", "How many relationship dealbreakers have you discovered?", "How many different places have you had a memorable kiss?", "How many times have you flirted with someone new this month?", "How many romantic songs remind you of someone?", "How many partners have you traveled with?", "How many times have you had a crush at work or school?", "How many dating profiles have you created?", "How many times have you changed your relationship status?", "How many people have you told about a private desire?", "How many romantic anniversaries have you celebrated?", "How many times have you sent a bold message?", "How many dates have become more intimate than planned?", "How many people have you privately fantasized about?", "How many times have you talked openly about consent?", "How many romantic surprises have you received?", "How many times have you made the first move?", "How many relationship conversations have you delayed?", "How many people have you invited to stay over?", "How many times have you tried a new kind of date?", "How many crushes have you never confessed?", "How many romantic boundaries have you changed your mind about?", "How many times have you gone on a date while nervous?", "How many people have you met through dating apps?", "How many flirtatious compliments have you given this week?", "How many romantic relationships lasted more than a year?", "How many times have you had chemistry with a stranger?", "How many dating stories could your friends tell?", "How many intimate conversations have you had this month?", "How many times have you kissed someone on a first date?", "How many romantic red flags have you ignored?", "How many times have you said exactly what you wanted?", "How many people have you wanted to ask out but did not?", "How many date ideas are saved on your phone?", "How many times have you fallen for someone unexpectedly?", "How many romantic risks have you taken?"
  ]
};

const expandPreferenceCards = (cards: readonly PreferenceCard[]): PreferenceCard[] => cards.flatMap((card) => [
  card,
  { question: `${card.question.replace(/\?$/, "")} right now?`, options: card.options }
]);

export const PREFERENCE_CARDS_BY_THEME: Record<CuratedTheme, readonly PreferenceCard[]> = {
  general: expandPreferenceCards([
    { question: "Which comfort food would you choose tonight?", options: ["Pizza", "Sushi", "Tacos"] },
    { question: "Which plan sounds best for a free Saturday?", options: ["Stay home", "Explore somewhere new", "Meet friends"] },
    { question: "Which place would you visit first?", options: ["Japan", "Italy", "Iceland"] },
    { question: "Which pet would you choose?", options: ["Dog", "Cat", "Something unusual"] },
    { question: "Which movie night would you choose?", options: ["Comedy", "Horror", "Romance"] },
    { question: "Which little luxury matters most?", options: ["Great coffee", "A perfect bed", "Fast internet"] },
    { question: "Which surprise would make you happiest?", options: ["A planned trip", "A meaningful gift", "A surprise party"] },
    { question: "Which hobby would you try for a month?", options: ["Cooking", "Photography", "Dancing"] },
    { question: "Which breakfast would you pick every day?", options: ["Sweet pastries", "Eggs and toast", "Fruit and yogurt"] },
    { question: "Which fictional home would you live in?", options: ["A treehouse", "A beach house", "A city loft"] },
    { question: "Which gift would you rather receive?", options: ["An experience", "Something useful", "Something sentimental"] },
    { question: "Which weather makes you happiest?", options: ["Sunny and warm", "Cool and cloudy", "Rainy and cozy"] },
    { question: "Which drink would you order first?", options: ["Beer", "Cocktail", "Soft drink"] },
    { question: "Which kind of weekend trip sounds best?", options: ["Beach escape", "Mountain cabin", "Big city"] },
    { question: "Which room would you redesign first?", options: ["Kitchen", "Bedroom", "Living room"] },
    { question: "Which game-night role fits you?", options: ["Strategist", "Bluffer", "Comic relief"] },
    { question: "Which class would you take for fun?", options: ["Pottery", "Cooking", "Improv"] },
    { question: "Which snack belongs in your ideal movie night?", options: ["Popcorn", "Chips", "Chocolate"] },
    { question: "Which small upgrade would improve your day?", options: ["More sleep", "Better coffee", "A shorter commute"] },
    { question: "Which kind of restaurant would you choose?", options: ["Tiny local spot", "Fancy tasting menu", "Busy food hall"] },
    { question: "Which item would you save from your room?", options: ["Your phone", "Your photos", "Your favorite clothes"] },
    { question: "Which skill would you instantly master?", options: ["Play music", "Speak languages", "Cook anything"] },
    { question: "Which festival would you attend?", options: ["Music", "Food", "Film"] },
    { question: "Which kind of story do you enjoy most?", options: ["Funny", "Mysterious", "Romantic"] },
    { question: "Which way would you spend an unexpected day off?", options: ["Go out", "Visit someone", "Do nothing"] }
  ]),
  life: expandPreferenceCards([
    { question: "Which city would you live in for a year?", options: ["A huge capital", "A quiet town", "A coastal city"] },
    { question: "Which new skill would help your life most?", options: ["Public speaking", "Cooking", "Managing money"] },
    { question: "Which career path sounds most appealing?", options: ["Build something", "Help people", "Work creatively"] },
    { question: "Which kind of trip would teach you the most?", options: ["Solo travel", "A road trip", "Living abroad"] },
    { question: "Which project would you start this month?", options: ["A business", "A creative project", "A fitness goal"] },
    { question: "Which subject would you study again?", options: ["History", "Science", "Art"] },
    { question: "Which workday would suit you best?", options: ["Fully remote", "Always with a team", "A mix of both"] },
    { question: "Which life upgrade would you choose?", options: ["More free time", "More money", "More confidence"] },
    { question: "Which challenge would you accept?", options: ["Run a race", "Perform on stage", "Move somewhere new"] },
    { question: "Which routine would you keep forever?", options: ["Morning exercise", "Weekly dinner", "Daily reading"] },
    { question: "Which mistake would you rather avoid?", options: ["Wrong career", "Wrong city", "Wrong relationship"] },
    { question: "Which kind of mentor would help you most?", options: ["A practical expert", "A creative thinker", "A brave risk-taker"] },
    { question: "Which long-term goal feels most exciting?", options: ["Own a home", "Travel the world", "Build a legacy"] },
    { question: "Which experience would you repeat?", options: ["Your first big trip", "Your proudest project", "Your best celebration"] },
    { question: "Which change would make tomorrow better?", options: ["Wake up earlier", "Plan less", "Say yes more"] },
    { question: "Which kind of feedback helps you grow?", options: ["Direct", "Gentle", "Detailed"] },
    { question: "Which goal would you pursue with a free year?", options: ["Write a book", "Start a company", "Travel slowly"] },
    { question: "Which place would you call home next?", options: ["Near family", "Near nature", "Near opportunity"] },
    { question: "Which personal quality would you strengthen?", options: ["Patience", "Courage", "Focus"] },
    { question: "Which kind of achievement matters most?", options: ["Recognition", "Freedom", "Helping others"] },
    { question: "Which plan would you make for a surprise windfall?", options: ["Invest it", "Travel with it", "Share it"] },
    { question: "Which lesson should schools teach more?", options: ["Money", "Relationships", "Mental health"] },
    { question: "Which future sounds most satisfying?", options: ["A calm life", "A creative life", "An adventurous life"] },
    { question: "Which decision would you make faster?", options: ["Change jobs", "Move cities", "Start dating"] },
    { question: "Which kind of day makes you feel accomplished?", options: ["Productive", "Meaningful", "Unexpected"] }
  ]),
  relationships: expandPreferenceCards([
    { question: "Which friend plan would you choose tonight?", options: ["Dinner", "A party", "A quiet hangout"] },
    { question: "Which quality makes someone instantly likable?", options: ["Warmth", "Humor", "Confidence"] },
    { question: "Which date sounds most fun?", options: ["Museum and coffee", "Drinks and dancing", "Cooking together"] },
    { question: "Which friend would you call first for advice?", options: ["The honest one", "The calm one", "The adventurous one"] },
    { question: "Which kind of message do you love receiving?", options: ["A funny meme", "A thoughtful check-in", "A spontaneous invite"] },
    { question: "Which relationship green flag matters most?", options: ["Good listening", "Reliability", "Playfulness"] },
    { question: "Which group role sounds like you?", options: ["Planner", "Peacemaker", "Wildcard"] },
    { question: "Which first-date setting feels best?", options: ["Coffee shop", "Long walk", "Busy bar"] },
    { question: "Which friendship tradition would you start?", options: ["Annual trip", "Weekly meal", "Birthday ritual"] },
    { question: "Which person would you invite on a road trip?", options: ["The organizer", "The storyteller", "The flexible one"] },
    { question: "Which apology feels most meaningful?", options: ["A sincere message", "A face-to-face talk", "Changed behavior"] },
    { question: "Which kind of friend are you in a crisis?", options: ["The fixer", "The listener", "The distraction"] },
    { question: "Which date activity reveals someone best?", options: ["Cooking", "Traveling", "Playing a game"] },
    { question: "Which social plan would you cancel last?", options: ["A birthday", "A reunion", "A spontaneous night"] },
    { question: "Which friendship quality lasts longest?", options: ["Trust", "Shared humor", "Shared history"] },
    { question: "Which romantic gesture would win you over?", options: ["A handwritten note", "A planned surprise", "Remembering details"] },
    { question: "Which conversation would you rather have?", options: ["Deep and honest", "Funny and silly", "Flirty and playful"] },
    { question: "Which partner quality matters most on a trip?", options: ["Flexibility", "Planning", "Curiosity"] },
    { question: "Which social event sounds best this weekend?", options: ["Dinner party", "Concert", "Game night"] },
    { question: "Which boundary is easiest for you to communicate?", options: ["Time", "Privacy", "Physical space"] },
    { question: "Which kind of compliment means the most?", options: ["About your character", "About your style", "About your effort"] },
    { question: "Which friend would you want beside you in a competition?", options: ["The strategist", "The motivator", "The fearless one"] },
    { question: "Which relationship memory would you replay?", options: ["A first meeting", "A shared adventure", "A ridiculous laugh"] },
    { question: "Which dating green flag is easiest to notice?", options: ["Kindness to staff", "Good questions", "Respect for boundaries"] },
    { question: "Which kind of connection feels strongest?", options: ["Instant chemistry", "Slow trust", "Shared ambition"] }
  ]),
  spicy: expandPreferenceCards([
    { question: "Which kind of flirtation is most attractive?", options: ["Witty teasing", "Direct compliments", "Quiet eye contact"] },
    { question: "Which first-date plan has the best chemistry?", options: ["Late dinner", "A long walk", "Drinks and music"] },
    { question: "Which romantic surprise would excite you most?", options: ["A secret getaway", "A private dinner", "A spontaneous invitation"] },
    { question: "Which quality makes someone more desirable?", options: ["Confidence", "Curiosity", "Kindness"] },
    { question: "Which kind of kiss sounds most memorable?", options: ["Unexpected", "Slow and romantic", "Playful"] },
    { question: "Which message would make you smile fastest?", options: ["I miss you", "You look amazing", "Come over"] },
    { question: "Which setting feels most romantic?", options: ["A hotel balcony", "A candlelit room", "A quiet beach"] },
    { question: "Which date-night outfit would you choose?", options: ["Effortlessly casual", "Sharp and dressed up", "Bold and attention-grabbing"] },
    { question: "Which kind of tension is most fun?", options: ["A lingering glance", "Playful banter", "A daring question"] },
    { question: "Which relationship conversation matters most?", options: ["Desires", "Boundaries", "Future plans"] },
    { question: "Which romantic memory would you rather create?", options: ["A midnight adventure", "A slow morning", "A surprise weekend"] },
    { question: "Which sign of attraction is easiest to notice?", options: ["Constant eye contact", "Finding excuses to talk", "Remembering details"] },
    { question: "Which kind of date would you repeat?", options: ["Dancing", "Cooking together", "A spontaneous road trip"] },
    { question: "Which compliment feels most powerful?", options: ["You make me feel safe", "You are irresistible", "I cannot stop thinking about you"] },
    { question: "Which boundary deserves the most respect?", options: ["Pace", "Privacy", "Physical comfort"] },
    { question: "Which romantic gesture feels most intimate?", options: ["A personal playlist", "A handwritten note", "A carefully planned evening"] },
    { question: "Which kind of confidence is hottest?", options: ["Knowing what you want", "Being comfortable with yourself", "Making the first move"] },
    { question: "Which conversation starter would you choose?", options: ["Your biggest turn-on", "Your ideal date", "Your secret fantasy"] },
    { question: "Which shared activity builds the most chemistry?", options: ["Dancing", "Traveling", "Trying something new"] },
    { question: "Which atmosphere would you choose for a night together?", options: ["Playful", "Romantic", "Mysterious"] },
    { question: "Which kind of touch feels most affectionate?", options: ["Holding hands", "A long hug", "A hand on your back"] },
    { question: "Which dating green flag is most attractive?", options: ["Clear communication", "Respectful confidence", "Playful honesty"] },
    { question: "Which late-night plan sounds best?", options: ["A private conversation", "A spontaneous drive", "A slow breakfast plan"] },
    { question: "Which desire would you rather discuss first?", options: ["A fantasy", "A boundary", "A new experience"] },
    { question: "Which kind of connection would you choose?", options: ["Intense chemistry", "Gentle intimacy", "Playful tension"] }
  ])
};

export const QUESTION_LIBRARY_BY_THEME: Record<CuratedTheme, readonly string[]> = Object.fromEntries(
  CURATED_THEMES.map((theme) => [theme, PREFERENCE_CARDS_BY_THEME[theme].map((card) => card.question)])
) as Record<CuratedTheme, readonly string[]>;

/** Topic cues used by the AI fallback and by older parts of the app. */
export const THEME_CUES = QUESTION_LIBRARY_BY_THEME;

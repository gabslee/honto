# HONTO?!

**Two lies. One truth. Who takes the sip?**

HONTO?! is an online party game for 2–8 players. Every round, one player writes three stories about a prompt: two lies and one truth. Everyone else tries to spot the truth. Guess wrong and you drink; guess right and the storyteller drinks. “Hontō?” (本当?) means “is it true?” in Japanese.

## MVP

- No-account entry by name, room code, or invite link
- 10, 20, or 30-round games
- Optional timed reminders and group sips every 3 or 5 rounds
- Alternating turns, secret truth selection, guessing, and reveal
- Persistent room session and score using SQLite/D1
- Lightweight room polling that suits the turn-based pace
- 12 built-in prompts, so the game works without AI or API costs
- Responsive mobile and desktop interface
- Inclusive language: any alcoholic or non-alcoholic drink works

## Localization

English is the only supported language and the default locale today. All interface copy, built-in prompts, errors, and metadata live in `app/i18n.ts`. Add a locale to `supportedLocales`, provide its message catalog, and resolve the active locale at the route or room level to introduce another language without changing game components.

## Architecture

The project uses React and TypeScript with server routes in the same deployment. Shared state lives in D1; the browser stores only the opaque token required to resume its own session. The `/api/game` endpoint handles room actions and never reveals the truth before a guess.

AI prompt generation is the next planned integration. It should run only on the server, return a short structured response, and fall back to local prompts. API keys must never be exposed to the browser.

## Suggested next steps

1. Add AI-generated prompts and per-room repetition history.
2. Add safe and spicy modes plus lobby-selected categories.
3. Let every participant guess in rooms with 3+ players.
4. Add administrative reconnection and old-room cleanup.
5. Add the next message catalog and a room-level language selector.

## Development

```bash
npm install
npm run dev
```

The schema lives in `db/schema.ts`, and versioned migrations live in `drizzle/`.

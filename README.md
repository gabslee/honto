# HONTO?!

**Draw a card. Read each other. Who takes the sip?**

HONTO?! is an online card game for two players, with Premium-hosted multiplayer for 3–6 people. Guests can join for free. Everyone shares one shuffled deck; secret answers stay server-side until the reveal. “Hontō?” (本当?) means “is it true?” in Japanese. See [MULTIPLAYER.md](MULTIPLAYER.md) for multiplayer rules, lifecycle, and architecture.

## MVP

- No-account entry by name, room code, or invite link
- Two Free seats, or 3–6 participants with a Premium host
- Balanced mix of the seven card types with alternating roles
- Secret truth and numeric answers that are never sent to the guesser
- AI-assisted questions and lies with local fallbacks
- Persistent room session and sip count
- Responsive mobile and desktop interface
- Inclusive language: any alcoholic or non-alcoholic drink works

## Localization

The game has English and Japanese interfaces and curated prompts. Multiplayer's additional themed prompts live in `data/multiplayer-prompts.ts`.

## Architecture

The project uses React and TypeScript with server routes in the same deployment. Shared state lives in Postgres; each browser tab stores only the opaque token required to resume its own session. The `/api/game` endpoint handles room actions and never reveals the truth before a guess.

AI generation runs only on the server, returns structured responses, and falls back to local content. API keys are never exposed to the browser.

## Suggested next steps

1. Add per-room question repetition history.
2. Expand the local estimate-question library.
3. Add administrative reconnection and old-room cleanup.
4. Add the next message catalog and a room-level language selector.

## Development

```bash
npm install
npm run dev
```

The active PostgreSQL schema is initialized in `api/game.ts` and `app/server-auth.ts`. The multiplayer migration is `drizzle/0004_multiplayer.sql`; earlier migration files describe the project's original schema and must not be applied blindly to PostgreSQL.

Use Node 22.18+ and run `npm run test:unit` for behavior tests, including an isolated in-memory PostgreSQL lifecycle test. `npm test` runs these checks followed by the production build. Tests do not use production credentials or data.

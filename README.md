# HONTO?!

**Draw a card. Read each other. Who takes the sip?**

HONTO?! is an online card game for exactly two players. Both devices share one shuffled deck with six journeys: Two Lies, One Truth; Question or Sips; Read My Mind; Number Estimate; Rock Paper Scissors; and Both Drink. Roles alternate on every card, secret answers stay server-side until the reveal, and “Hontō?” (本当?) means “is it true?” in Japanese.

## MVP

- No-account entry by name, room code, or invite link
- Exactly two seats and one synchronized deck
- Balanced mix of the six card types with alternating roles
- Secret truth and numeric answers that are never sent to the guesser
- AI-assisted questions and lies with local fallbacks
- Persistent room session and sip count
- Responsive mobile and desktop interface
- Inclusive language: any alcoholic or non-alcoholic drink works

## Localization

English is the only supported language and the default locale today. All interface copy, built-in prompts, errors, and metadata live in `app/i18n.ts`. Add a locale to `supportedLocales`, provide its message catalog, and resolve the active locale at the route or room level to introduce another language without changing game components.

## Architecture

The project uses React and TypeScript with server routes in the same deployment. Shared state lives in D1; the browser stores only the opaque token required to resume its own session. The `/api/game` endpoint handles room actions and never reveals the truth before a guess.

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

The schema lives in `db/schema.ts`, and versioned migrations live in `drizzle/`.

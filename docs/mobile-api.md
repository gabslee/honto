# Honto mobile JSON API

All responses are JSON with `Cache-Control: no-store`. Errors: `{ "error": "message" }` with a 4xx status.
Honto is 2 players only. The partner never needs an account: they join by link (room code) and keep a
stable `partnerKey` (20–64 chars `[A-Za-z0-9-]`, generated once per install) so history continues across rooms.

## Auth (host account, same flow as the web)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/auth/google/start?return_to=/` | Redirects to Google; on return sets the session cookie. |
| GET | `/api/auth/apple/start?return_to=/` | Same with Sign in with Apple. |
| GET | `/api/auth/me` | `{ user: { id, email, name, plan, ... } \| null }` |
| POST | `/api/auth/logout` | Clears the session. |

Run the start URL in an in-app auth session (ASWebAuthenticationSession / Custom Tabs) and keep the cookie jar;
send the session cookie on every request. The partner skips this.

## Room identity

Create/join a room with the existing `POST /api/game` (`action: "create"` / `"join"`). Every mobile call below needs:

- `code` – room code
- `token` – player token (body/query, or header `Authorization: Room <token>`)
- `partnerKey` – partner device only
- `timeZone` – IANA zone, e.g. `America/Sao_Paulo` (optional, default UTC)

## Couple / daily card

| Method | Path | Body |
|---|---|---|
| GET | `/api/mobile/daily?code=..&token=..&timeZone=..` | – |
| POST | `/api/mobile/daily/answer` | `{ code, token, slot, answer }` (answer ≤ 500 chars) |
| POST | `/api/mobile/daily/confirm-adult` | `{ code, token, confirm18: true }` (Premium only) |

Response: `{ daily: { coupleId, today, limit, premium, adultConfirmed, partnerName, cards: [...] } }`.
Free: 1 card/day; Premium: 3. Answers are revealed only after both have answered.

## History

`GET /api/mobile/history?code=..&token=..` → `{ history: { coupleId, reunionDate, daysUntilReunion, today, daily: [...], moments: [...] } }`.

## Reunion date

`PUT /api/mobile/reunion` with `{ code, token, reunionDate: "YYYY-MM-DD" | null }` → same payload as history.
Stored per couple, so it carries to new rooms.

## Photo moments (placeholder)

`POST /api/mobile/moments/photo` → `501 { "error": "...", "code": "not_implemented" }`. Reserved for upload.

# Honto mobile JSON API

Base URL: `https://hontogame.com`. All responses are JSON with `Cache-Control: no-store`.
Errors look like `{ "error": "Human readable message", "code": "optional_machine_code" }` with a 4xx/5xx status.
Honto is for exactly 2 players. The partner never needs an account.

## Authentication

Every `/api/mobile/*` data route accepts any of the following:

| Credential | How to send it | Who uses it |
|---|---|---|
| User bearer token (`hm_u_…`) | `Authorization: Bearer <token>` | Signed-in host (Google/Apple) |
| Device bearer token (`hm_d_…`) | `Authorization: Bearer <token>` | Account-free partner (couple-scoped) |
| Web session cookie | `Cookie: honto_session=…` | Web / webviews |
| Room seat | `code` + `token` in query/body, or `Authorization: Room <seat token>` | Any client |

Tokens are random (256-bit), stored only as a SHA-256 hash, valid for 365 days and revocable.
If `code`/`token` are omitted, the server uses:
- the latest 2-player room the account hosts (user token / cookie);
- the latest room the partner device joined (device token).

If no room is found the response is `401 { "error": "...", "code": "no_room" }`.

### POST /api/mobile/auth/google

Native Google Sign-In. The ID token audience may be the web client (`GOOGLE_CLIENT_ID`) or the iOS client (`GOOGLE_IOS_CLIENT_ID`).

```json
// request
{ "idToken": "<Google ID token>", "nonce": "<raw nonce, optional>", "platform": "ios" }
```
```json
// 200 (existing user) or 201 (new user)
{
  "token": "hm_u_3q2…",
  "tokenType": "Bearer",
  "expiresInDays": 365,
  "created": false,
  "user": { "id": "7c9…", "email": "ana@example.com", "displayName": "Ana", "plan": "free", "premium": false }
}
```
Errors:
- `400 { "error": "idToken is required." }`
- `401 { "error": "Invalid sign-in token.", "code": "invalid_token" }`
- `400 { "code": "email_required" }` (first sign-in without a verified email)
- `503 { "code": "missing_config" }`

### POST /api/mobile/auth/apple

Native Sign in with Apple. The audience must be the bundle id (`APPLE_IOS_BUNDLE_ID`, default `com.hontogame.app`), verified against Apple's JWKS.

```json
{ "idToken": "<identityToken>", "nonce": "<raw nonce, optional>", "name": "Ana Souza", "platform": "ios" }
```
Apple only shares the email on the first sign-in, so send `name` then. The response is the same as Google.

Account matching (same user as the web login):
1. An existing `(provider, sub)` link.
2. Otherwise the verified email (`users.email`). The provider is then linked.

A user who signed in with Google on the web and with Apple on iOS (same email) is one account.

### POST /api/mobile/auth/partner (account-free partner)

```json
// request
{ "code": "MOON-42-123", "name": "Ben", "partnerKey": "optional existing 20-64 char key", "locale": "pt-BR" }
```
```json
// 201
{
  "token": "hm_d_Xy…",
  "tokenType": "Bearer",
  "reusedToken": false,
  "partnerKey": "1f0c2c1e-…",
  "room": { "code": "MOON-42-123", "token": "<seat token>" }
}
```
- Store `token` and `partnerKey` in the Keychain.
- When joining the next room, call again with `Authorization: Bearer <device token>`. You then get `"reusedToken": true` and no new `token`.
- The couple (host account + partner key) and its history continue across rooms.
- Errors: `404` unknown code, `400` room full or already started.

### POST /api/mobile/auth/logout

Revokes the bearer token sent in `Authorization`. Response: `{ "ok": true, "revoked": true }`.

### GET /api/auth/me

Works with the bearer token too. Response: `{ "user": { "id", "email", "displayName", "plan", ... } | null }`.

## Daily card

### GET /api/mobile/daily?timeZone=America/Sao_Paulo
```json
{
  "daily": {
    "coupleId": "5b1…", "today": "2026-10-15", "limit": 1, "premium": false, "adultConfirmed": false, "partnerName": "Ben",
    "cards": [
      { "day": "2026-10-15", "slot": 1, "deck": "deepTalk", "text": "What part of your past…?",
        "myAnswer": null, "partnerAnswered": true, "partnerAnswer": null, "revealed": false }
    ]
  }
}
```
Once both have answered, `revealed` is `true` and `partnerAnswer` holds the partner's text.

### POST /api/mobile/daily/answer
Request: `{ "day": "2026-10-15", "slot": 1, "answer": "…≤500 chars", "timeZone": "America/Sao_Paulo" }`. The response has the same shape as GET daily.

### POST /api/mobile/daily/confirm-adult
Request: `{ "confirm18": true }`. Premium only; it unlocks 18+ decks for the couple. Response: same as GET daily.

## History

### GET /api/mobile/history
```json
{
  "history": {
    "coupleId": "5b1…", "reunionDate": "2026-12-24", "daysUntilReunion": 70, "today": "2026-10-15",
    "moments": [{ "type": "wouldrather", "prompt": "…", "answer": "…", "at": "2026-10-14T22:10:00Z" }],
    "daily": [{ "day": "2026-10-15", "slot": 1, "deck": "deepTalk", "index": 3, "text": "…",
                "answers": [{ "name": "Ana", "answer": "…", "mine": true }, { "name": "Ben", "answer": "…", "mine": false }] }],
    "photos": [{ "id": "…", "url": "https://….blob.vercel-storage.com/moments/…jpg", "phrase": "会いたい", "phraseKey": "aitai",
                 "romaji": "aitai", "translation": { "en": "I miss you", "pt": "Saudade de você" },
                 "author": "Ben", "mine": false, "createdAt": "2026-10-15T06:40:00Z" }]
  }
}
```

## Reunion date

### PUT /api/mobile/reunion
Request: `{ "reunionDate": "2026-12-24" }` (use `null` to clear). Response: same as GET history. The date is stored per couple.

## Photo moments

### POST /api/mobile/moments/photo
Send `multipart/form-data` with these fields:
- `photo`: the image file. Max 5 MB. JPEG, PNG, WebP or HEIC, checked by magic bytes; the client MIME type is ignored.
- `phraseKey`: one of the keys below, **or**
- `phrase`: custom text, at most 80 characters.

Phrase keys:
- `aitai` 会いたい
- `daisuki` 大好き
- `oyasumi` おやすみ
- `ohayou` おはよう
- `zutto-issho` ずっと一緒
- `tsuki-ga-kirei` 月が綺麗ですね
- `omoide` 思い出
- `mou-sugu` もうすぐ会えるね
- `ganbatte` 頑張って
- `koko-ni-iru` ここにいるよ

```json
// 201
{ "photo": { "id": "…", "url": "https://….jpg", "phrase": "会いたい", "phraseKey": "aitai", "romaji": "aitai",
             "translation": { "en": "I miss you", "pt": "Saudade de você" }, "author": "Ben", "mine": true, "createdAt": "…" } }
```
Errors:
- `413` larger than 5 MB
- `415` not an allowed image
- `400` missing photo or phrase
- `500 "Photo storage is not configured yet."` when `BLOB_READ_WRITE_TOKEN` is missing

Photos are stored in Vercel Blob at an unguessable URL (random UUID + suffix).

### GET /api/mobile/moments/latest
Returns the newest photo from **the other partner**, for the home-screen widget: `{ "photo": { …same shape… } }` or `{ "photo": null }`.

## Web OAuth (unchanged)

`GET /api/auth/google/start`, `GET /api/auth/apple/start` and `POST /api/auth/logout` keep working for the web and webviews (cookie session).

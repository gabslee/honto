# Honto MVP contracts (W0)

Contracts only: no endpoint is implemented here. Backend workstreams (W1, W2a, W2b, W3) implement
`/api/v1` against `openapi.yaml`; app (W5a/W5b), web (W4) and native (W6/W7) build against the fakes.

| Path | What | Edited by hand? |
|---|---|---|
| `openapi.yaml` | OpenAPI 3.1 spec of `/api/v1` + cron + push/Live Activity/widget payload schemas. **Source of truth.** | yes |
| `honto-api.ts` | TS types, `Operations` map, runtime `operations` route table | generated |
| `honto-client.ts` | Typed `fetch` client (`createHontoClient`) for the web and scripts | yes |
| `widget-snapshot.v1.json` | Standalone JSON Schema of `snapshot.v1.json` (App Group / Android filesDir) | generated |
| `fixtures/*.json` | Example bodies for every operation and variant (see naming below) | yes |
| `mock/server.mjs` | Fixture-backed mock server with request validation | yes |
| `dart/` | `honto_contracts` Dart package: models, `HontoApi`, `HttpHontoApi`, `FakeHontoApi`, tests. See `dart/README.md` | `lib/src/*.g.dart` generated |
| `pigeon/` | Pigeon contract for `packages/honto_native` + generated Dart/Swift/Kotlin | `pigeons/*.dart` by hand |
| `typecheck/` | Compile-time checks of the TS types against fixtures | yes |
| `../drizzle/proposed/0008-0011_mvp_v1.sql` | Schema migration **plan** for the new tables (not applied) | yes |
| `../docs/mvp-env.md` | Env var names the backend and app will need | yes |

## Workflow

```bash
npm run contracts:generate   # after editing openapi.yaml or fixtures: regenerates TS, Dart, widget schema, Dart fixtures
npm run contracts:validate   # Redocly lint + drift check + fixture validation + tsc + Dart analyze/test + Pigeon drift
npm run contracts:mock       # http://localhost:4010 (Android emulator: http://10.0.2.2:4010)
npm run test:unit            # includes tests/contracts.test.mjs and tests/contracts-sql.test.mjs (PGlite, in memory)
```

`contracts:dart` needs a Dart SDK (or Flutter) on `PATH` and is skipped otherwise. Generator rules: every enum
and every object with properties must be a named schema; nullable refs use `anyOf: [{$ref}, {type: 'null'}]`;
`oneOf`/`allOf` are not supported; `x-dart: false` keeps server-to-server schemas out of Dart; `x-patch: true`
makes optional nullable fields `Nullable<T>?` in Dart (omit vs. clear).

### Fixtures

- `<operationId>.<status>[.<variant>].json`: response body. The mock serves the lowest 2xx by default; pick
  another with header `x-honto-fixture: 200.free_no_photos` (or `?__fixture=`).
- `<operationId>.request[.<variant>].json`: request body example.
- `schema.<SchemaName>[.<variant>].json`: non-HTTP payloads (push data, Live Activity, widget snapshot).

Persona: Ana (São Paulo, `me`) paired with Kenji (Tokyo, `partner`), "now" = 2026-10-19T12:00:00Z.

## Endpoints

Auth is `Authorization: Bearer hm_u_…` (apps) or the `honto_session` cookie (web), unless noted.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/auth/google`, `/api/v1/auth/apple` | Public. Same behavior as `/api/mobile/auth/*` (which stays frozen for build 2). 200 existing / 201 new account |
| POST | `/api/v1/auth/email/start` | Public. Magic link + 6-digit code, 15 min, 202 (503 `email_unavailable` with no provider) |
| POST | `/api/v1/auth/email/verify` | Public. `token` or `email`+`code`; `platform: web` sets the cookie and returns `token: null` |
| POST | `/api/v1/auth/link/{provider}` | Signed in. Adds a Google / Apple identity to my account; 409 `identity_in_use` if it belongs to someone else |
| POST | `/api/v1/auth/refresh` | Public. Rotates an `hm_r_` refresh token (single use, reuse revokes the chain) for a new `hm_u_` |
| POST | `/api/v1/auth/logout` | Revokes the token |
| GET / DELETE | `/api/v1/me` | User + couple + entitlement + `pendingUnpair`; DELETE = account deletion |
| PUT | `/api/v1/me/timezone` | IANA zone, on every open/foreground |
| PUT / DELETE | `/api/v1/me/weather` | Coarse weather summary from the device (condition, °C, day/night); no location stored. `GET /api/v1/today` returns `me.weather` / `partner.weather` (null after 12 h) |
| GET / POST | `/api/v1/me/export` | ZIP of my own photos (while paired and 30 days after unpairing) |
| GET / POST | `/api/v1/couple/invite` | 6-char code, 48h, single use |
| POST | `/api/v1/couple/join` | 404 invalid, 410 expired, 409 already paired, 422 own code |
| GET / PATCH / DELETE | `/api/v1/couple` | Partner + tz, `startedOn`, `reunion`, `daysTogether`; DELETE = unpair |
| GET | `/api/v1/today` | Today screen **and** widgets; ETag/304 |
| POST | `/api/v1/photos` | Presigned S3 PUTs to object storage (full + device-made thumb), idempotent by `clientId` |
| POST | `/api/v1/photos/{photoId}/complete` | HEAD check, first ready photo per author per local day = daily |
| DELETE | `/api/v1/photos/{photoId}` | Author only |
| GET | `/api/v1/memories?month=YYYY-MM` | Days with both thumbs; Free = last 7 days, older `locked` |
| GET | `/api/v1/memories/{day}` | All photos of both for a local day; 403 `premium_required` when locked |
| GET | `/api/v1/milestones[?unseen=true]` | Couple milestones (Free) for Memories, with my `seenAt`; `GET /api/v1/today` also returns `streak` and `unseenMilestones` |
| POST | `/api/v1/milestones/{id}/seen` | Marks a milestone seen by me (CelebrationSheet shown once per user), idempotent |
| POST / DELETE | `/api/v1/devices`, `/api/v1/devices/{id}` | `fcm`, `apns_alert`, `apns_widget` (+ `env`) |
| POST / DELETE | `/api/v1/live-activity/tokens`, `/{id}` | `push_to_start` / `update` (APNs direct) |
| PUT | `/api/v1/calendar/busy` | Atomic window replace (≤ 14 days); all-day dropped; titles only Premium + opted in |
| GET | `/api/v1/calendar?from&to` | Premium: both sides + `partnerStatus` |
| GET / PUT | `/api/v1/calendar/shares` | Per-calendar title opt-in (default off, Premium to turn on) |
| GET / POST | `/api/v1/trips`, PATCH / DELETE `/api/v1/trips/{id}` | Drives Live Activity / Live Update (Premium) |
| POST | `/api/v1/nudges` | "Thinking of you", Free, 1/60 s and 30/day |
| POST | `/api/v1/billing/revenuecat` | RevenueCat webhook (Authorization = shared value) |
| GET | `/api/cron/trips`, `/api/cron/retention` | Cloudflare Worker cron (`Bearer CRON_SECRET`) |

## Decisions taken in W0 (where the plan left room)

- **v1 auth endpoints**: `/api/v1/auth/{google,apple,email/*,logout}` exist so the new app never calls the frozen
  `/api/mobile`; implementations should share `app/mobile-auth.ts`. Same `hm_u_` tokens.
- **Account deletion** (`DELETE /api/v1/me`) added for App Store 5.1.1(v); no 30-day grace for deleted accounts.
- **Invite codes**: 6 chars Crockford base32, 48h TTL (W1b, per the plan), creating a new one revokes the previous.
- **Photo day** = photographer's local day (`localDay` + `timeZone` sent by the device, accepted within ±1 day).
  Today returns each person's own `localDay`. `partner.latestPhoto` keeps the Locket-style widget filled.
- **Photo formats**: JPEG/WebP only (no HEIC/PNG in v1), full ≤ 2 MB, thumb ≤ 256 KB, both made on the device.
- **Object storage**: private S3-compatible bucket (Railway Storage Buckets today), provider-neutral in the
  contract and schema (`storage = 's3'`). Virtual-host URLs `https://<bucket>.t3.storageapi.dev/<key>`, presigned
  with SigV4 (`aws4fetch` service `s3`, region `auto`, `signQuery`, or `@aws-sdk/client-s3` with
  `forcePathStyle: false`). No bucket lifecycle rules: photo expiry and `exports/` cleanup are done by
  `GET /api/cron/retention`.
- **Signed URLs**: GET 24h, PUT 10 min. Clients cache images by photo id, not URL.
- **Calendar**: upload allowed on Free (data ready when the trial starts), reading is Premium; all-day blocks are
  dropped server-side too; `calendarRef` = device-side hash of the calendar id; private events never send titles.
- **Countdown widget** is Premium (`features.countdownWidget`) per the scope's Free/Premium table, while the
  in-app countdown and partner time are Free.
- **Entitlement sources**: `revenuecat` (MVP), `stripe` (legacy web game subscribers keep Premium), `admin`.
  The 7-day trial is the store intro offer surfaced as `periodType: trial`.
- **Live Activity window**: `max(departsAt, arrivesAt − 8h)` → `arrivesAt + 1h`; both partners get it;
  `content-state` uses epoch seconds because ActivityKit decodes with a default `JSONDecoder`.
- **Push payload** (`PushData`): FCM `data` strings / APNs `honto` key; widget push body is only `content-changed`.
- **Cron** stays `GET` (Vercel cron convention, called by the Worker with `Bearer CRON_SECRET`).

## Pigeon (`pigeon/pigeons/honto_native.dart`)

Host/Flutter APIs for `packages/honto_native`, generated to `pigeon/generated/{dart,swift,kotlin}`:

- `ShellHostApi` / `ShellFlutterApi`: native `UITabBar` (Today, Calendar, Memories), glass capture and Settings
  buttons, `UIMenu`/`UIAlertController` actions (Android: no-ops, Material 3 is drawn in Flutter).
- `SessionHostApi`: shares the `hm_u_` token with the widget extension / NSE (keychain group) and Android
  receivers; `clearAllNativeData()` on logout/unpair.
- `WidgetsHostApi` / `WidgetsFlutterApi`: write `snapshot.v1.json` (as JSON, validated by
  `widget-snapshot.v1.json`, since the NSE and FCM service write the same file without Flutter), save
  thumbnails, reload kinds, iOS 26 widget push token.
- `TripActivityHostApi` / `TripActivityFlutterApi`: Live Activity start/update/end (local path and fallback),
  capabilities (push-to-start, promoted notifications), push-to-start and update tokens.
- `CalendarHostApi`: iOS 17 full access, calendars (with the hashed `ref`), expanded events with availability,
  all-day and private flags; titles only for opted-in calendars.

Swift/Kotlin outputs were generated with Pigeon (version pinned in `pigeon/pubspec.lock`) but not compiled
here (no Xcode/Gradle on the box); W6a/W7 compile them.

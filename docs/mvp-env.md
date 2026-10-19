# Honto MVP: environment variable names

Names only (W0 contract), plus the non-secret object storage settings. Values live in Vercel (Preview + Production), the Cloudflare Worker and the
App Store Connect / Play builds. Never commit values.

## Vercel (Next.js, `/api/v1`)

| Name | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | all | existing (Neon) |
| `AUTH_SESSION_SALT` | auth | existing; also salts `email_login_tokens.token_hash` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID` | auth | existing audiences for Google ID tokens |
| `APPLE_IOS_BUNDLE_ID` | auth | existing, default `com.hontogame.app` |
| `RESEND_API_KEY`, `EMAIL_FROM` | email magic link | e.g. `Honto <hello@hontogame.com>` |
| `S3_ENDPOINT` | photos, exports | object storage endpoint: `https://t3.storageapi.dev` (Railway Storage Buckets) |
| `S3_REGION` | photos, exports | `auto` |
| `S3_BUCKET` | photos, exports | `honto-photos-kwrqb3lgl-pn` (private) |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | photos, exports | bucket credentials (secret) |
| `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID` | push iOS | `.p8` contents; topic base `com.hontogame.app` |
| `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | push Android | FCM HTTP v1 service account |
| `REVENUECAT_WEBHOOK_AUTH` | billing webhook | exact `Authorization` value set in RevenueCat |
| `REVENUECAT_SECRET_API_KEY` | billing | optional, REST lookups to reconcile |
| `CRON_SECRET` | `/api/cron/*` | shared with the Worker |

## Cloudflare Worker (`workers/honto-cron`)

| Name | Notes |
|---|---|
| `HONTO_API_BASE_URL` | `https://hontogame.com` |
| `CRON_SECRET` | same value as Vercel |

## Flutter app (`--dart-define`)

| Name | Notes |
|---|---|
| `HONTO_API_BASE_URL` | default `https://hontogame.com`; mock: `http://10.0.2.2:4010` / `http://localhost:4010` |
| `HONTO_USE_FAKE_API` | `true` = `FakeHontoApi` |
| `REVENUECAT_IOS_KEY`, `REVENUECAT_ANDROID_KEY` | public SDK keys |
| `APNS_ENV` | `sandbox` (debug) or `production` (TestFlight/App Store), sent with APNs tokens |

## Object storage notes

- S3-compatible, private bucket. Object URLs are virtual-host style: `https://<S3_BUCKET>.t3.storageapi.dev/<key>`.
- Presign PUT (10 min) and GET (24h) with SigV4: `aws4fetch` (`service: 's3'`, `region: 'auto'`, `signQuery: true`)
  or `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` with `forcePathStyle: false`.
- Keys: `couples/<coupleId>/photos/<photoId>/{full,thumb}.<ext>`, `exports/<userId>/<exportId>.zip`.
- No lifecycle rules: `GET /api/cron/retention` deletes unpaired photos after 30 days and exports after 7 days.

## claude/api-v1-foundation-b38rye (W1a foundation)

No new variables. `api/v1/context.ts` (`requireUser`, `requireCouple`, `isCouplePremium`) and
`PUT /api/v1/me/timezone` only use the existing `DATABASE_URL` and `AUTH_SESSION_SALT` (token and cookie hashes).

## feat/api-v1-couple-auth (W1b: couple, pairing, me/today, magic link, refresh, unpair, export, retention)

| Name | Where | Notes |
|---|---|---|
| `RESEND_API_KEY` | Vercel (Production; optional in Preview) | Resend API key, sent with plain `fetch` to `https://api.resend.com/emails`. Empty: dev/Preview log the magic link and code to the function log; Production answers `503 email_unavailable` and never logs tokens. |
| `EMAIL_FROM` | Vercel | Sender on a domain verified in Resend. Default `Honto <hello@hontogame.com>`. |
| `CRON_SECRET` | Vercel + Cloudflare Worker | `GET /api/cron/retention` requires `Authorization: Bearer <CRON_SECRET>`; unset = every call is 401. |
| `ANDROID_CERT_SHA256` | Vercel (read at build time) | App signing certificate SHA-256 fingerprint(s) for `/.well-known/assetlinks.json`, `AA:BB:…` form, comma separated (Play App Signing key, plus upload/debug keys if wanted). Empty = `[]`. Redeploy after changing it. |

Existing names used: `DATABASE_URL`, `AUTH_SESSION_SALT` (also salts magic-link, code, refresh-token and IP hashes),
`HONTO_ADMIN_EMAIL` (an email sign-in with this address gets the admin role, as with Google/Apple) and the Vercel
system variable `VERCEL_ENV` (`production` = links always on `https://hontogame.com`, no console sender; otherwise
links use the request's own origin so they work on a Preview URL).
No new variables for the refresh tokens or the AASA file (app ID `4AW8H42XNA.com.hontogame.app` is fixed in code).
`POST /api/v1/auth/google` and `/apple` reuse the existing `GOOGLE_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`,
`GOOGLE_ANDROID_CLIENT_ID` (accepted Google audiences; none set = `503 missing_config`) and `APPLE_IOS_BUNDLE_ID`
(Apple audience, default `com.hontogame.app`). No new variables.

## feat/api-v1-photos-push (W2a photos, memories, devices, push)

| Name | Used by | Notes |
|---|---|---|
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | `app/storage.ts` | already set (see above); the object host is derived from `S3_ENDPOINT`, never hardcoded |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | `app/storage.ts` | **pending**: while empty, `/api/v1/photos*` and `/api/v1/memories*` answer `503 storage_not_configured` |
| `APNS_KEY_P8` | `app/push/apns.ts` | **pending**: contents of the `.p8` key (PEM; `\n` escapes accepted). Replaces the W0 placeholder name `APNS_PRIVATE_KEY` |
| `APNS_KEY_ID` | `app/push/apns.ts` | **pending**: key id of the `.p8` (JWT `kid`) |
| `APNS_TEAM_ID` | `app/push/apns.ts` | set (`4AW8H42XNA`, JWT `iss`) |
| `APNS_BUNDLE_ID` | `app/push/apns.ts` | optional, default `com.hontogame.app` (alert topic; widget topic `<bundle>.push-type.widgets`) |
| `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | `app/push/fcm.ts` | **pending**: Firebase service account (`FCM_PRIVATE_KEY` is the PEM, `\n` escapes accepted) |

While the APNs or FCM keys are empty, sending is a logged no-op (`[push] … not configured, skipped N device(s)`);
device tokens are never logged. APNs host is per token (`env`: sandbox / production). Migration record:
`drizzle/0009_photos_push.sql` (applied lazily by `ensurePhotosSchema()` in `api/v1/photos-schema.ts`).

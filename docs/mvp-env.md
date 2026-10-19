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

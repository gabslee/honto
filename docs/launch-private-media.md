# Launch: distance and private media

Branch: `feat/launch-distance-private-media`. Requires the matching Flutter branch.

- Apply `drizzle/0018_launch_private_media.sql` (runtime schema setup is also idempotent).
- Cities store a user-selected city centroid, never live GPS. `/today` returns rounded great-circle distance only when both cities exist.
- Daily video: one ready video per author and couple, live for 24 hours from the moment it became ready (`expires_at`), no longer until local midnight. The feed shows each author's latest live video, `GET /private-media/{id}/playback` and the chat `available` flag answer 404 / false once it expires, and the cleanup sweep then deletes the row and the objects. A new video replaces the author's previous one even if that one is still live (serialized per couple and author with a Postgres advisory lock); the actual MP4 metadata is checked for 15 seconds and 720p, and the old final and staging objects are queued for deletion. `local_day` is still stored but no longer decides visibility. Ready videos without `expires_at` (written before this rule) get `coalesce(ready_at, created_at) + 24 hours` from the idempotent schema backfill (`backfillDailyVideoExpiry`, also run by the sweep), so the sweep removes them.
- View-once: only the intended recipient can atomically claim it; response is no-store bytes encoded as JSON, never a reusable URL. It is removed from the database and storage on opening. Failed object deletions remain in the durable deletion queue.
- These objects never enter `couple_photos`, calendar memories, web history or photo exports.
- Premium is enforced server-side using the couple's existing entitlement.

## Cleanup activation after approval

Deploy `workers/private-media-cleanup/wrangler.jsonc` after the backend is approved and deployed. Set its `CRON_SECRET` to the same existing backend secret, using the secret manager. The Worker invokes the authenticated cleanup endpoint every 5 minutes (it was every minute; a per-minute database hit kept a scale-to-zero Postgres awake around the clock). No Worker or backend deployment was performed as part of the implementation.

Unopened photos become inaccessible exactly at their 24-hour expiry. Physical deletion occurs on the next successful sweep (normally within five minutes); object-store outages delay physical deletion, and the outbox retries. Opening removes access immediately even if storage deletion fails. Staging keys are separate from immutable final keys so an old signed PUT cannot recreate a viewed photo. Expired staging and orphaned final objects are swept too.

## Validation boundaries

Tests use isolated PGlite and mocked storage, not production data. iOS simulator validates UI and native compilation. Front camera orientation, audio capture, push delivery and real RevenueCat purchases require physical-device QA. Android video capture is not included in this iOS-first release.

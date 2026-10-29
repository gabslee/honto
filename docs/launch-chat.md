# Launch: couple chat ("Just between you")

Builds on `docs/launch-private-media.md`. Requires the matching Flutter branch.

## Migration

- New file `drizzle/0019_couple_chat.sql`: tables `couple_messages` and `couple_chat_reads`. 0018 is unchanged.
- The same statements run idempotently at runtime from `api/v1/launch-schema.ts` (`ensureLaunchSchema`), like 0018.
- **The migration has NOT been applied to any database** (no Neon, no remote). Only isolated PGlite tests ran it.

`couple_messages`: `couple_id` and `author_user_id` cascade on delete; `UNIQUE(author_user_id, client_id)` makes sends
idempotent; `kind` in `text | photo_comment | video_comment | view_once`; `body` is trimmed, 1-2000 characters, and null
only for `view_once`. `photo_id` (couple_photos) and `private_media_id` (private_media) are `ON DELETE SET NULL`, so a
deleted photo, a replaced video, or an opened/expired view-once photo leaves the message as a tombstone. View-once rows also
keep `media_expires_at` and `media_opened_at` so the status survives the media row being deleted.

## Routes (all require a paired couple, `409 not_paired` otherwise)

- `GET /api/v1/chat/messages?before=<message id>&limit=1..100` (default 30): newest first; `nextBefore` is the cursor for
  the next (older) page, null on the last page.
  - `photo_comment`: `photo = { photoId, available, thumbUrl, expiresAt }`. The thumb is signed the same way as Memories
    (`photoUrls`), null when the photo is gone, storage is unavailable, or the day is outside the Free 7-day window.
  - `video_comment`: `video = { mediaId, available, posterUrl }`. No posters exist yet, so `posterUrl` is always null.
  - `view_once`: `viewOnce = { mediaId, status: unopened|opened|expired, expiresAt, isRecipient }`. `mediaId` is present only
    while unopened; never a URL. Opening still goes through `POST /api/v1/private-media/{id}/open` (recipient, Premium).
- `POST /api/v1/chat/messages` `{ clientId (uuid), body, photoId? | privateMediaId? }`: Free. A comment must reference a
  ready photo / ready daily video of this couple **authored by the partner**; commenting on my own media is rejected
  (`422 media_unavailable`), as is another couple's media. Rate limit 60 per minute. Same `clientId` returns the first message.
- `POST /api/v1/chat/read` `{ messageId }`: moves my read marker forward (never back), returns the summary.
- `GET /api/v1/chat/summary`: `{ unreadCount, lastReadMessageId, latest }` for the Today card.

## Disappearing photos in the chat

The existing view-once flow is unchanged (upload / complete / open, 24 h expiry, Premium checked server-side). When
`complete` marks a view-once photo ready, a `view_once` chat message is created (idempotent per media id, also on a
retried complete). Opening sets `media_opened_at` in the same statement that claims the media; expiry and the cleanup
sweep delete the media row, which nulls `private_media_id` and leaves an `expired` tombstone.

## Push

New `PushEventType` `chat_message`, sent to the partner for every new text, comment, and ready view-once photo via
`notifyPartner` (same device tokens and preferences as nudges). APNs alert: title = sender name, body = text truncated to
120 characters, prefixed `Commented on your photo: ` / `Commented on your video: `, or `Sent you a disappearing photo`. No
image, attachment, URL, or `mutable-content`. Data payload (`honto`): `{ type: "chat_message", coupleId, sentAt, fromName,
messageId }`; the preview text is not in the data payload. A completed view-once photo now sends `chat_message` instead of
`private_photo.new`.

## Deletion

Unpair deletes the couple's messages and read markers (`purgeStatements` in `api/v1/lifecycle.ts`); account deletion
cascades through the user and couple foreign keys. Covered by `tests/couple-chat.test.mjs`.

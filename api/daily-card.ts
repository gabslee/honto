import type { NeonQueryFunction } from "@neondatabase/serverless";
import { LONG_DISTANCE_DECKS, type LongDistanceDeckKey } from "../data/long-distance-decks";
import { hasPremiumAccess, type CurrentUser } from "../app/server-auth";
import { cleanDailyAnswer, dailyDecks, dailyLimit, localDay, pickDailyCard, previousDay, publicDailyEntry } from "../app/daily-card.js";

type Sql = NeonQueryFunction<false, false>;

export async function ensureDailySchema(sql: Sql) {
  await sql`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS daily_adult_confirmed_at timestamptz`;
  await sql`CREATE TABLE IF NOT EXISTS daily_cards (room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, day text NOT NULL, slot integer NOT NULL, deck text NOT NULL, card_index integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(room_id, day, slot))`;
  await sql`CREATE TABLE IF NOT EXISTS daily_answers (room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, day text NOT NULL, slot integer NOT NULL, player_id text NOT NULL REFERENCES players(id) ON DELETE CASCADE, answer text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(room_id, day, slot, player_id))`;
}

async function couplePremium(sql: Sql, roomId: string, currentUser: CurrentUser | null) {
  if (hasPremiumAccess(currentUser)) return true;
  const rows = await sql`SELECT u.id, u.role, u.plan, u.subscription_status AS "subscriptionStatus", u.subscription_expires_at AS "subscriptionExpiresAt", u.trial_ends_at AS "trialEndsAt" FROM players p JOIN users u ON u.id = p.user_id WHERE p.room_id = ${roomId}`;
  return rows.some((row) => hasPremiumAccess(row as CurrentUser));
}

const deckSizes = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, LONG_DISTANCE_DECKS[key as LongDistanceDeckKey]?.length ?? 0]));

async function cardFor(sql: Sql, roomId: string, day: string, slot: number, decks: string[]) {
  const existing = await sql`SELECT deck, card_index AS "index" FROM daily_cards WHERE room_id = ${roomId} AND day = ${day} AND slot = ${slot}`;
  if (existing[0]) return existing[0] as { deck: string; index: number };
  const picked = pickDailyCard(roomId, day, slot, deckSizes(decks));
  if (!picked) return null;
  await sql`INSERT INTO daily_cards (room_id, day, slot, deck, card_index) VALUES (${roomId}, ${day}, ${slot}, ${picked.deck}, ${picked.index}) ON CONFLICT DO NOTHING`;
  const rows = await sql`SELECT deck, card_index AS "index" FROM daily_cards WHERE room_id = ${roomId} AND day = ${day} AND slot = ${slot}`;
  return rows[0] as { deck: string; index: number };
}

function cardText(deck: string, index: number) {
  const card = LONG_DISTANCE_DECKS[deck as LongDistanceDeckKey]?.[index];
  return card ? { en: card.en, "pt-BR": card["pt-BR"], ja: card.ja } : null;
}

async function dailyState(sql: Sql, room: any, me: any, timeZone: string, currentUser: CurrentUser | null) {
  const players = await sql`SELECT id, name FROM players WHERE room_id = ${room.id} ORDER BY joined_at`;
  const partner = players.find((player: any) => player.id !== me.id) as any;
  const premium = await couplePremium(sql, room.id, currentUser);
  const adultConfirmed = Boolean(room.daily_adult_confirmed_at);
  const decks = dailyDecks({ premium, adultConfirmed });
  const limit = dailyLimit(premium);
  const today = localDay(timeZone);
  // Yesterday is included so a partner in an earlier/later time zone can still finish a shared card.
  const days = [today, previousDay(today)];
  const answers = await sql`SELECT day, slot, player_id AS "playerId", answer FROM daily_answers WHERE room_id = ${room.id} AND day IN (${days[0]}, ${days[1]})`;
  const cards = [];
  for (const day of days) {
    for (let slot = 1; slot <= limit; slot += 1) {
      const slotAnswers = answers.filter((answer: any) => answer.day === day && answer.slot === slot) as any[];
      if (day !== today && !slotAnswers.length) continue;
      const card = await cardFor(sql, room.id, day, slot, decks);
      if (!card) continue;
      cards.push({ day, slot, deck: card.deck, text: cardText(card.deck, card.index), ...publicDailyEntry({ answers: slotAnswers, meId: me.id, partnerId: partner?.id }) });
    }
  }
  return { daily: { today, limit, premium, adultConfirmed, partnerName: partner?.name ?? null, cards } };
}

/** Handles daily* actions for an authenticated 2-player room session. */
export async function handleDaily(sql: Sql, room: any, me: any, body: Record<string, any>, currentUser: CurrentUser | null) {
  if (room.multiplayer) throw new Error("Card of the Day is for two-player rooms.");
  await ensureDailySchema(sql);
  const timeZone = String(body.timeZone ?? "UTC");
  if (body.action === "dailyConfirmAdult") {
    if (!(await couplePremium(sql, room.id, currentUser)) || !hasPremiumAccess(currentUser)) throw new Error("Spicy is a Premium theme.");
    if (body.confirm18 !== true) throw new Error("Please confirm you are both 18 or older.");
    await sql`UPDATE rooms SET daily_adult_confirmed_at = COALESCE(daily_adult_confirmed_at, now()) WHERE id = ${room.id}`;
    room.daily_adult_confirmed_at = room.daily_adult_confirmed_at ?? new Date().toISOString();
  }
  if (body.action === "dailyAnswer") {
    const answer = cleanDailyAnswer(body.answer);
    if (!answer) throw new Error("Write an answer first.");
    const premium = await couplePremium(sql, room.id, currentUser);
    const slot = Number(body.slot);
    if (!Number.isInteger(slot) || slot < 1 || slot > dailyLimit(premium)) throw new Error("No more cards today.");
    const today = localDay(timeZone);
    const day = String(body.day ?? today);
    if (day !== today && day !== previousDay(today)) throw new Error("This card has expired.");
    const players = await sql`SELECT count(*)::int AS count FROM players WHERE room_id = ${room.id}`;
    if (Number((players[0] as any).count) > 2) throw new Error("Card of the Day is for two-player rooms.");
    const card = await cardFor(sql, room.id, day, slot, dailyDecks({ premium, adultConfirmed: Boolean(room.daily_adult_confirmed_at) }));
    if (!card) throw new Error("No card available.");
    // Answers are final once submitted, so nobody can change theirs after seeing the partner's.
    await sql`INSERT INTO daily_answers (room_id, day, slot, player_id, answer) VALUES (${room.id}, ${day}, ${slot}, ${me.id}, ${answer}) ON CONFLICT DO NOTHING`;
  }
  return dailyState(sql, room, me, timeZone, currentUser);
}

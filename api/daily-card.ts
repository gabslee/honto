import type { NeonQueryFunction } from "@neondatabase/serverless";
import { LONG_DISTANCE_DECKS, type LongDistanceDeckKey } from "../data/long-distance-decks";
import { hasPremiumAccess, type CurrentUser } from "../app/server-auth";
import { cleanDailyAnswer, dailyDecks, dailyLimit, localDay, pickDailyCard, previousDay, publicDailyEntry } from "../app/daily-card.js";
import { roleFor } from "../app/couple-identity.js";
import { ensureCoupleSchema, resolveCouple } from "./couple";

type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, any>;

export async function couplePremium(sql: Sql, roomId: string, currentUser: CurrentUser | null) {
  if (hasPremiumAccess(currentUser)) return true;
  const rows = await sql`SELECT u.id, u.role, u.plan, u.subscription_status AS "subscriptionStatus", u.subscription_expires_at AS "subscriptionExpiresAt", u.trial_ends_at AS "trialEndsAt" FROM players p JOIN users u ON u.id = p.user_id WHERE p.room_id = ${roomId}`;
  return rows.some((row) => hasPremiumAccess(row as CurrentUser));
}

const deckSizes = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, LONG_DISTANCE_DECKS[key as LongDistanceDeckKey]?.length ?? 0]));

async function cardFor(sql: Sql, room: Row, coupleId: string, day: string, slot: number, decks: string[]) {
  const existing = await sql`SELECT deck, card_index AS "index" FROM daily_cards WHERE couple_id = ${coupleId} AND day = ${day} AND slot = ${slot}`;
  if (existing[0]) return existing[0] as { deck: string; index: number };
  const picked = pickDailyCard(coupleId, day, slot, deckSizes(decks));
  if (!picked) return null;
  await sql`INSERT INTO daily_cards (room_id, couple_id, day, slot, deck, card_index) VALUES (${room.id}, ${coupleId}, ${day}, ${slot}, ${picked.deck}, ${picked.index}) ON CONFLICT DO NOTHING`;
  const rows = await sql`SELECT deck, card_index AS "index" FROM daily_cards WHERE couple_id = ${coupleId} AND day = ${day} AND slot = ${slot}`;
  return rows[0] as { deck: string; index: number };
}

export function dailyCardText(deck: string, index: number) {
  const card = LONG_DISTANCE_DECKS[deck as LongDistanceDeckKey]?.[index];
  return card ? { en: card.en, "pt-BR": card["pt-BR"], ja: card.ja } : null;
}

export async function dailyState(sql: Sql, room: Row, me: Row, timeZone: string, currentUser: CurrentUser | null) {
  const couple = await resolveCouple(sql, room);
  const players = await sql`SELECT id, name, is_host FROM players WHERE room_id = ${room.id} ORDER BY joined_at`;
  const partner = players.find((player: Row) => player.id !== me.id) as Row | undefined;
  const premium = await couplePremium(sql, room.id, currentUser);
  const adultConfirmed = Boolean(couple.adultConfirmedAt);
  const decks = dailyDecks({ premium, adultConfirmed });
  const limit = dailyLimit(premium);
  const today = localDay(timeZone);
  const myRole = roleFor(me); const partnerRole = myRole === "host" ? "partner" : "host";
  // Yesterday is included so a partner in another time zone can still finish a shared card.
  const days = [today, previousDay(today)];
  const answers = await sql`SELECT day, slot, role, answer FROM daily_answers WHERE couple_id = ${couple.id} AND day IN (${days[0]}, ${days[1]})`;
  const cards = [];
  for (const day of days) {
    for (let slot = 1; slot <= limit; slot += 1) {
      const slotAnswers = (answers as Row[]).filter((answer) => answer.day === day && answer.slot === slot).map((answer) => ({ playerId: answer.role, answer: answer.answer }));
      if (day !== today && !slotAnswers.length) continue;
      const card = await cardFor(sql, room, couple.id, day, slot, decks);
      if (!card) continue;
      cards.push({ day, slot, deck: card.deck, text: dailyCardText(card.deck, card.index), ...publicDailyEntry({ answers: slotAnswers, meId: myRole, partnerId: partner ? partnerRole : null }) });
    }
  }
  return { daily: { coupleId: couple.id, today, limit, premium, adultConfirmed, partnerName: partner?.name ?? null, cards } };
}

/** Handles daily* actions for an authenticated 2-player room session. */
export async function handleDaily(sql: Sql, room: Row, me: Row, body: Row, currentUser: CurrentUser | null) {
  if (room.multiplayer) throw new Error("Card of the Day is for two-player rooms.");
  await ensureCoupleSchema(sql);
  const timeZone = String(body.timeZone ?? "UTC");
  if (body.action === "dailyConfirmAdult") {
    if (!(await couplePremium(sql, room.id, currentUser)) || !hasPremiumAccess(currentUser)) throw new Error("Spicy is a Premium theme.");
    if (body.confirm18 !== true) throw new Error("Please confirm you are both 18 or older.");
    const couple = await resolveCouple(sql, room);
    await sql`UPDATE couples SET adult_confirmed_at = COALESCE(adult_confirmed_at, now()), updated_at = now() WHERE id = ${couple.id}`;
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
    if (Number((players[0] as Row).count) > 2) throw new Error("Card of the Day is for two-player rooms.");
    const couple = await resolveCouple(sql, room);
    const card = await cardFor(sql, room, couple.id, day, slot, dailyDecks({ premium, adultConfirmed: Boolean(couple.adultConfirmedAt) }));
    if (!card) throw new Error("No card available.");
    // Answers are final once submitted, so nobody can change theirs after seeing the partner's.
    await sql`INSERT INTO daily_answers (room_id, couple_id, day, slot, player_id, role, author_name, answer) VALUES (${room.id}, ${couple.id}, ${day}, ${slot}, ${me.id}, ${roleFor(me)}, ${me.name}, ${answer}) ON CONFLICT DO NOTHING`;
  }
  return dailyState(sql, room, me, timeZone, currentUser);
}

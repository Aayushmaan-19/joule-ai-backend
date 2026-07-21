import { getFirestore } from "firebase-admin/firestore";

const GUEST_LIMIT_DISABLED = false;

const GUEST_DAILY_LIMIT = 20;
const VERIFIED_DAILY_LIMIT = 50;
const IMAGE_DAILY_LIMIT = 3;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Atomically checks a daily counter against `limit` and increments it
 * if under. `usedField`/`dateField` name the counter's pair of fields
 * on the document at `ref` — one generic implementation backs every
 * quota (guest messages, verified messages, images) instead of three
 * near-identical copies of the same transaction.
 */
async function consumeDailyQuota(ref, usedField, dateField, limit) {
  const db = getFirestore();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};

    const isNewDay = data[dateField] !== todayKey();
    const used = isNewDay ? 0 : (data[usedField] || 0);

    if (used >= limit) {
      return { allowed: false, remaining: 0, limit, displayName: data.displayName || null };
    }

    tx.set(
      ref,
      { [usedField]: used + 1, [dateField]: todayKey() },
      { merge: true }
    );

    return {
      allowed: true,
      remaining: limit - (used + 1),
      limit,
      displayName: data.displayName || null
    };
  });
}

/**
 * Refunds one use of a daily counter. Consume happens *before* the
 * work it's gating (the Groq reply, the generated image) so that two
 * concurrent requests can't both slip past the same limit — but that
 * means a failed attempt still cost the user real quota unless
 * something puts it back. This is that something: called from the
 * route's catch block when the gated work fails, same-day only (if
 * the day has already rolled over since the original consume, the
 * counter has already reset and there's nothing to refund into), and
 * never taking `used` below 0.
 */
async function refundDailyQuota(ref, usedField, dateField) {
  const db = getFirestore();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;

    const data = snap.data();
    if (data[dateField] !== todayKey()) return;

    const used = data[usedField] || 0;
    if (used <= 0) return;

    tx.set(ref, { [usedField]: used - 1 }, { merge: true });
  });
}

export async function checkAndConsumeGuestUsage(ip) {
  if (GUEST_LIMIT_DISABLED) {
    return { allowed: true, remaining: Infinity, limit: Infinity };
  }

  const db = getFirestore();
  const safeId = ip.replace(/[/.:]/g, "_");
  const ref = db.collection("guestUsage").doc(safeId);

  return consumeDailyQuota(ref, "messagesUsed", "lastUsageDate", GUEST_DAILY_LIMIT);
}

export async function refundGuestUsage(ip) {
  if (GUEST_LIMIT_DISABLED) return;

  const db = getFirestore();
  const safeId = ip.replace(/[/.:]/g, "_");
  const ref = db.collection("guestUsage").doc(safeId);

  await refundDailyQuota(ref, "messagesUsed", "lastUsageDate");
}

export async function checkAndConsumeUserUsage(uid) {
  const db = getFirestore();
  const ref = db.collection("users").doc(uid);

  return consumeDailyQuota(ref, "messagesUsed", "lastUsageDate", VERIFIED_DAILY_LIMIT);
}

export async function refundUserUsage(uid) {
  const db = getFirestore();
  const ref = db.collection("users").doc(uid);

  await refundDailyQuota(ref, "messagesUsed", "lastUsageDate");
}

/**
 * Image generation is gated separately from chat messages — its own
 * deliberately small daily cap, verified users only, tracked with its
 * own counter so it never eats into the chat message quota.
 */
export async function checkAndConsumeImageUsage(uid) {
  const db = getFirestore();
  const ref = db.collection("users").doc(uid);

  return consumeDailyQuota(ref, "imagesUsed", "lastImageUsageDate", IMAGE_DAILY_LIMIT);
}

export async function refundImageUsage(uid) {
  const db = getFirestore();
  const ref = db.collection("users").doc(uid);

  await refundDailyQuota(ref, "imagesUsed", "lastImageUsageDate");
}

export { GUEST_LIMIT_DISABLED, GUEST_DAILY_LIMIT, VERIFIED_DAILY_LIMIT, IMAGE_DAILY_LIMIT };

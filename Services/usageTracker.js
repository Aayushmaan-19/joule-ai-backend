import { getFirestore } from "firebase-admin/firestore";

const GUEST_LIMIT_DISABLED = false;

const GUEST_DAILY_LIMIT = 20;
const VERIFIED_DAILY_LIMIT = 50;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export async function checkAndConsumeGuestUsage(ip) {
  if (GUEST_LIMIT_DISABLED) {
    return { allowed: true, remaining: Infinity, limit: Infinity };
  }

  const db = getFirestore();
  const safeId = ip.replace(/[/.:]/g, "_");
  const ref = db.collection("guestUsage").doc(safeId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};

    const isNewDay = data.lastUsageDate !== todayKey();
    const used = isNewDay ? 0 : (data.messagesUsed || 0);

    if (used >= GUEST_DAILY_LIMIT) {
      return { allowed: false, remaining: 0, limit: GUEST_DAILY_LIMIT };
    }

    tx.set(
      ref,
      { messagesUsed: used + 1, lastUsageDate: todayKey() },
      { merge: true }
    );

    return {
      allowed: true,
      remaining: GUEST_DAILY_LIMIT - (used + 1),
      limit: GUEST_DAILY_LIMIT
    };
  });
}

export async function checkAndConsumeUserUsage(uid) {
  const db = getFirestore();
  const ref = db.collection("users").doc(uid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};

    const isNewDay = data.lastUsageDate !== todayKey();
    const used = isNewDay ? 0 : (data.messagesUsed || 0);

    if (used >= VERIFIED_DAILY_LIMIT) {
      return { allowed: false, remaining: 0, limit: VERIFIED_DAILY_LIMIT };
    }

    tx.set(
      ref,
      { messagesUsed: used + 1, lastUsageDate: todayKey() },
      { merge: true }
    );

    return {
      allowed: true,
      remaining: VERIFIED_DAILY_LIMIT - (used + 1),
      limit: VERIFIED_DAILY_LIMIT
    };
  });
}

export { GUEST_LIMIT_DISABLED, GUEST_DAILY_LIMIT, VERIFIED_DAILY_LIMIT };
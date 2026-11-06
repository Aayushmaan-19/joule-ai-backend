import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { buildReadableId, userLabel, userName } from "./userIdentity.js";

/**
 * One-time (and safe to re-run) tidy-up of existing data:
 *
 *   users            → readableId + label, and a userDirectory entry each
 *   followRequests   → requesterLabel / targetLabel / label ("@a → @b")
 *   follows          → followerLabel / followeeLabel / label
 *   conversations    → participantLabels / label ("@a ↔ @b")
 *
 * Nothing is renamed or deleted — document ids stay the same, fields are only
 * added. Newly created documents get these fields at creation time
 * (socialService.js / userIdentity.js); this fills in everything older.
 */

const BATCH_SIZE = 400;

async function commitInBatches(db, writes) {
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const { ref, data } of writes.slice(i, i + BATCH_SIZE)) {
      batch.set(ref, data, { merge: true });
    }
    await batch.commit();
  }
}

export async function organizeDatabase() {
  const db = getFirestore();
  const stats = { users: 0, followRequests: 0, follows: 0, conversations: 0 };

  /* ---------- users + userDirectory ---------- */

  const usersSnap = await db.collection("users").get();
  const byUid = new Map();
  const userWrites = [];

  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const uid = doc.id;

    let email = data.email;
    if (!email) {
      // Google-created profiles from before the backend owned user creation may lack it.
      try {
        email = (await getAuth().getUser(uid)).email || "";
      } catch {
        email = "";
      }
    }

    const full = { ...data, email };
    const readableId = data.readableId || buildReadableId(uid, email);
    const label = userLabel(full, uid);

    byUid.set(uid, { ...full, label });

    userWrites.push({ ref: doc.ref, data: { uid, email, readableId, label } });
    userWrites.push({
      ref: db.collection("userDirectory").doc(readableId),
      data: {
        uid,
        email,
        username: data.username || null,
        displayName: data.displayName || null,
        createdAt: data.createdAt || null,
        updatedAt: new Date()
      }
    });
    stats.users++;
  }

  await commitInBatches(db, userWrites);

  const name = uid => (byUid.has(uid) ? userName(byUid.get(uid), uid) : uid.slice(0, 6));

  /* ---------- followRequests ---------- */

  const requestWrites = [];
  for (const doc of (await db.collection("followRequests").get()).docs) {
    const d = doc.data();
    const a = name(d.requester);
    const b = name(d.target);
    requestWrites.push({
      ref: doc.ref,
      data: { requesterLabel: a, targetLabel: b, label: `${a} → ${b}` }
    });
    stats.followRequests++;
  }
  await commitInBatches(db, requestWrites);

  /* ---------- follows ---------- */

  const followWrites = [];
  for (const doc of (await db.collection("follows").get()).docs) {
    const d = doc.data();
    const a = name(d.follower);
    const b = name(d.followee);
    followWrites.push({
      ref: doc.ref,
      data: { followerLabel: a, followeeLabel: b, label: `${a} → ${b}` }
    });
    stats.follows++;
  }
  await commitInBatches(db, followWrites);

  /* ---------- conversations ---------- */

  const convoWrites = [];
  for (const doc of (await db.collection("conversations").get()).docs) {
    const d = doc.data();
    const people = [...(d.participants || [])].sort(); // same order as the conversation id
    const participantLabels = Object.fromEntries(people.map(uid => [uid, name(uid)]));
    convoWrites.push({
      ref: doc.ref,
      data: {
        participantLabels,
        label: people.map(uid => participantLabels[uid]).join(" ↔ ")
      }
    });
    stats.conversations++;
  }
  await commitInBatches(db, convoWrites);

  return stats;
}

import { getFirestore } from "firebase-admin/firestore";

/**
 * Human-readable identity for every user.
 *
 * Firestore document ids stay exactly what they were — the Firebase Auth uid.
 * This adds a second, readable handle next to it so you can tell who a
 * document belongs to without decoding a 28-character uid:
 *
 *   users/{uid}.readableId   e.g.  "aayushmaan-k3pq9"
 *   users/{uid}.label        e.g.  "@aayu · aayushmaan@gmail.com"
 *   userDirectory/{readableId}  →  { uid, email, username, displayName }
 *
 * `userDirectory` is a plain lookup table: open it in the Firebase console and
 * the document ids read as names. The readableId is derived once, from the
 * email's local part + the first 5 characters of the uid, and never changes
 * (a username or display-name change would otherwise rename documents).
 */

function slug(value) {
  return (
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "user"
  );
}

export function buildReadableId(uid, email) {
  const local = String(email || "").split("@")[0];
  return `${slug(local)}-${uid.slice(0, 5).toLowerCase()}`;
}

/** "@username" if they have one, else display name, else the email's local part. */
export function userName(data, uid) {
  if (data?.username) return `@${data.username}`;
  if (data?.displayName) return data.displayName;
  const local = String(data?.email || "").split("@")[0];
  return local || uid.slice(0, 6);
}

/** "@username · email" — the line shown in the admin console and stored as `label`. */
export function userLabel(data, uid) {
  const name = userName(data, uid);
  return data?.email ? `${name} · ${data.email}` : name;
}

/**
 * Creates the user's document if it doesn't exist and makes sure it has a
 * readableId, a label and a userDirectory entry. Safe to call on every
 * sign-in (it only ever merges). `authUser` is the decoded ID token.
 */
export async function ensureUserIdentity(uid, authUser) {
  const db = getFirestore();
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() : {};

  const email = String(authUser?.email || existing.email || "").toLowerCase();
  const readableId = existing.readableId || buildReadableId(uid, email);
  const now = new Date();

  const merged = { ...existing, email };
  const patch = {
    uid,
    email,
    readableId,
    label: userLabel(merged, uid),
    emailVerified: authUser?.email_verified ?? existing.emailVerified ?? false,
    lastLoginAt: now
  };

  if (!snap.exists) {
    Object.assign(patch, {
      createdAt: now,
      plan: "free",
      messagesUsed: 0,
      voiceUsed: 0,
      followerCount: 0,
      followingCount: 0
    });
  }

  const batch = db.batch();
  batch.set(ref, patch, { merge: true });
  batch.set(
    db.collection("userDirectory").doc(readableId),
    {
      uid,
      email,
      username: existing.username || null,
      displayName: existing.displayName || null,
      createdAt: existing.createdAt || patch.createdAt || null,
      updatedAt: now
    },
    { merge: true }
  );
  await batch.commit();

  return { readableId, created: !snap.exists };
}

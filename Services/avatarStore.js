import { getFirestore } from "firebase-admin/firestore";

/**
 * Profile pictures live in Firestore (avatars/{uid}), not Cloud Storage,
 * which now needs a billing account. The frontend already crops every
 * upload to a 480x480 JPEG (~50-100 KB); Firestore documents may hold
 * 1 MiB, so a hard 400 KB ceiling leaves plenty of room.
 *
 * The bytes are served by Routes/avatars.js. Clients can't touch the
 * `avatars` collection at all: it has no Firestore security rule, so it is
 * denied by default and only this backend (Admin SDK) reads or writes it.
 */

export const MAX_AVATAR_BYTES = 400 * 1024;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Saves the user's current avatar and returns its version (used to bust caches). */
export async function saveAvatar(uid, buffer, contentType) {
  if (!ALLOWED_TYPES.has(contentType)) {
    throw fail(400, "Avatar must be a JPEG, PNG or WebP image");
  }
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw fail(400, "That image is too large. Try a smaller one.");
  }

  const updatedAt = Date.now();

  await getFirestore().collection("avatars").doc(uid).set({
    data: buffer,
    contentType,
    updatedAt
  });

  return updatedAt;
}

export async function readAvatar(uid) {
  const snap = await getFirestore().collection("avatars").doc(uid).get();
  if (!snap.exists) return null;

  const { data, contentType } = snap.data();
  return { buffer: Buffer.from(data), contentType };
}

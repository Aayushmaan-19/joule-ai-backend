import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "crypto";
import "./firebase.js";

const EXTENSION_BY_CONTENT_TYPE = {
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/jpeg": "jpg"
};

/**
 * Uploads a generated image buffer to Firebase Storage under the
 * owning user's folder and returns a permanent download URL — the
 * same URL shape the Firebase client SDK's getDownloadURL() would
 * produce, built directly here since this runs with the admin SDK
 * (no client-side round trip needed).
 */
export async function uploadGalleryImage(uid, buffer, contentType) {
  const bucket = getStorage().bucket();
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType] || "jpg";
  const imageId = randomUUID();
  const filePath = `images/${uid}/${imageId}.${extension}`;
  const file = bucket.file(filePath);
  const downloadToken = randomUUID();

  await file.save(buffer, {
    metadata: {
      contentType,
      metadata: { firebaseStorageDownloadTokens: downloadToken }
    }
  });

  const encodedPath = encodeURIComponent(filePath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;

  return { imageId, url, path: filePath };
}

/**
 * Deletes a previously uploaded gallery image. Used when a Firestore
 * gallery-doc write fails after the file upload already succeeded,
 * so a failed save doesn't leave an orphaned file behind.
 */
export async function deleteGalleryImage(uid, imageId, contentType) {
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType] || "jpg";
  const bucket = getStorage().bucket();
  await bucket.file(`images/${uid}/${imageId}.${extension}`).delete({ ignoreNotFound: true });
}

/**
 * Uploads a user's avatar to a single fixed path per user (unlike
 * gallery images, there's only ever one current avatar, so this
 * overwrites rather than accumulating). Clears out any file left at
 * another extension first — otherwise switching from, say, a .png
 * upload to a .jpg one would silently orphan the old file forever.
 */
export async function uploadAvatar(uid, buffer, contentType) {
  const bucket = getStorage().bucket();
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType] || "jpg";

  await Promise.all(
    Object.values(EXTENSION_BY_CONTENT_TYPE).map(ext =>
      bucket.file(`avatars/${uid}.${ext}`).delete({ ignoreNotFound: true })
    )
  );

  const filePath = `avatars/${uid}.${extension}`;
  const file = bucket.file(filePath);
  const downloadToken = randomUUID();

  await file.save(buffer, {
    metadata: {
      contentType,
      metadata: { firebaseStorageDownloadTokens: downloadToken }
    }
  });

  const encodedPath = encodeURIComponent(filePath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;

  return { url, path: filePath };
}

import express from "express";
import { readAvatar } from "../Services/avatarStore.js";

const router = express.Router();

// Firebase uids are short alphanumeric strings; anything else is not an avatar.
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Public on purpose: an <img> tag can't send an Authorization header.
 * (The old Storage download URLs were equally public.) The URL carries
 * ?v=<updatedAt>, so a new upload gets a new URL and the file itself can
 * be cached for a year.
 */
router.get("/:uid", async (req, res) => {
  try {
    if (!UID_PATTERN.test(req.params.uid)) {
      return res.status(404).end();
    }

    const avatar = await readAvatar(req.params.uid);
    if (!avatar) {
      return res.status(404).end();
    }

    res.set({
      "Content-Type": avatar.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      // helmet() defaults to same-origin, which would stop the Vercel site
      // from showing images served by this backend.
      "Cross-Origin-Resource-Policy": "cross-origin"
    });

    return res.send(avatar.buffer);
  } catch (err) {
    console.error("Avatar read error:", err.message);
    return res.status(500).end();
  }
});

export default router;

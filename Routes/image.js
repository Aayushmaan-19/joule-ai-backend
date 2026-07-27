import express from "express";
import rateLimit from "express-rate-limit";
import { getFirestore } from "firebase-admin/firestore";
import verifyFirebase from "../middleware/verifyFirebase.js";
import { generateImage } from "../Services/pollinations.js";
import { uploadGalleryImage, deleteGalleryImage } from "../Services/storage.js";
import {
  checkAndConsumeImageUsage,
  refundImageUsage,
  IMAGE_DAILY_LIMIT
} from "../Services/usageTracker.js";

const router = express.Router();

const imageLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many image requests. Please wait a moment." }
});

router.post("/generate", imageLimiter, verifyFirebase, async (req, res) => {
  try {
    if (!req.user.email_verified) {
      return res.status(403).json({
        error: "Verify your email to generate images."
      });
    }

    const { prompt } = req.body;

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Prompt is required" });
    }

    if (prompt.trim().length === 0) {
      return res.status(400).json({ error: "Empty prompt not allowed" });
    }

    if (prompt.length > 500) {
      return res.status(400).json({ error: "Prompt too long (max 500 characters)" });
    }

    const usage = await checkAndConsumeImageUsage(req.user.uid);

    if (!usage.allowed) {
      return res.status(429).json({
        error: `You've used all ${IMAGE_DAILY_LIMIT} images for today. Resets in 24h.`,
        remaining: 0,
        limit: usage.limit
      });
    }

    const { buffer, contentType } = await generateImage(prompt.trim())
      .catch(async (genErr) => {
        // Quota was consumed above to keep the check atomic against
        // concurrent requests — refund it now, since this attempt
        // never actually produced an image.
        await refundImageUsage(req.user.uid).catch(refundErr =>
          console.error("Usage refund failed:", refundErr.message)
        );
        throw genErr;
      });
    const image = `data:${contentType};base64,${buffer.toString("base64")}`;

    // Gallery persistence is a secondary feature riding on a
    // successful generation — it must never delay or fail the reply
    // the user is already waiting on, so it's deliberately not
    // awaited here. Any failure is only logged.
    saveToGallery(req.user.uid, prompt.trim(), buffer, contentType).catch(err =>
      console.error("Gallery save failed:", err.message)
    );

    return res.json({
      image,
      remaining: usage.remaining,
      limit: usage.limit
    });

  } catch (err) {
    console.error("Image route error:", err.message);

    return res.status(500).json({
      error: "Something went wrong. Please try again."
    });
  }
});

export default router;

/**
 * Uploads the image to Storage, then records it in the user's
 * gallery collection. If the Firestore write fails after the file
 * already uploaded, the orphaned file is removed rather than left
 * behind with no doc pointing to it.
 */
async function saveToGallery(uid, prompt, buffer, contentType) {
  const { imageId, url, path } = await uploadGalleryImage(uid, buffer, contentType);

  try {
    await getFirestore()
      .collection("users").doc(uid)
      .collection("images").doc(imageId)
      .set({ prompt, url, path, contentType, createdAt: Date.now() });
  } catch (err) {
    await deleteGalleryImage(uid, imageId, contentType).catch(() => {});
    throw err;
  }
}

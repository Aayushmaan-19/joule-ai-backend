import express from "express";
import rateLimit from "express-rate-limit";
import { getFirestore } from "firebase-admin/firestore";
import optionalAuth from "../middleware/optionalAuth.js";
import { pingGroq } from "../Services/groq.js";

const router = express.Router();

// Its own limiter, separate from both the global chat-traffic limiter
// in server.js and any per-user daily message quota — a wake check
// isn't a chat message and shouldn't compete with either for room.
const wakeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many wake checks. Please wait a moment." }
});

router.post("/", wakeLimiter, optionalAuth, async (req, res) => {
  try {
    // Firestore check only makes sense for a signed-in user — guests
    // have no users/{uid} document to read. Read-only: proves
    // connectivity without touching any usage counter.
    if (req.user) {
      await getFirestore().collection("users").doc(req.user.uid).get();
    }

    await pingGroq();

    return res.json({ awake: true });

  } catch (err) {
    console.error("Wake route error:", err.message);

    return res.status(503).json({
      error: "One or more backend services aren't reachable right now."
    });
  }
});

export default router;

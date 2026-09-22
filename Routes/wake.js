import express from "express";
import rateLimit from "express-rate-limit";

const router = express.Router();

// Wake is deliberately a cheap process-health endpoint. It must not depend
// on Groq or Firestore: if an external provider is down, Render should still
// consider the Node process healthy and the frontend should not see a 503.
const wakeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many wake checks. Please wait a moment." }
});

router.post("/", wakeLimiter, (req, res) => {
  return res.status(200).json({ awake: true });
});

export default router;

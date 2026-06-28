import express from "express";
import { askGroq } from "../Services/groq.js";
import optionalAuth from "../middleware/optionalAuth.js";
import {
  checkAndConsumeGuestUsage,
  checkAndConsumeUserUsage,
  GUEST_DAILY_LIMIT,
  VERIFIED_DAILY_LIMIT
} from "../Services/usageTracker.js";

const router = express.Router();

router.post("/chat", optionalAuth, async (req, res) => {
  try {
    const { message, history } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    if (message.trim().length === 0) {
      return res.status(400).json({ error: "Empty message not allowed" });
    }

    if (message.length > 500) {
      return res.status(400).json({ error: "Message too long (max 500 characters)" });
    }

    const safeHistory = Array.isArray(history)
      ? history
          .filter(m => m && typeof m.role === "string" && typeof m.content === "string")
          .slice(-10)
      : [];

    const isVerified = !!req.user && req.user.email_verified;

    let usage;

    if (isVerified) {
      usage = await checkAndConsumeUserUsage(req.user.uid);

      if (!usage.allowed) {
        return res.status(429).json({
          error: `You've used all ${VERIFIED_DAILY_LIMIT} of your messages for today. Resets in 24h.`,
          remaining: 0,
          limit: usage.limit
        });
      }
    } else {
      const ip =
        req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
        req.socket.remoteAddress ||
        "unknown";

      usage = await checkAndConsumeGuestUsage(ip);

      if (!usage.allowed) {
        return res.status(429).json({
          error: `You've used all ${GUEST_DAILY_LIMIT} free messages for today. Verify your email for ${VERIFIED_DAILY_LIMIT} messages a day.`,
          remaining: 0,
          limit: usage.limit
        });
      }
    }

    const reply = await askGroq(message.trim(), safeHistory);

    return res.json({
      reply,
      remaining: usage.remaining,
      limit: usage.limit
    });

  } catch (err) {
    console.error("AI route error:", err.message);

    return res.status(500).json({
      error: "Something went wrong. Please try again."
    });
  }
});

export default router;
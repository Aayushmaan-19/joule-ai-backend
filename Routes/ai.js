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

    const { message } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    if (message.trim().length === 0) {
      return res.status(400).json({
        error: "Empty message not allowed"
      });
    }

    if (message.length > 500) {
      return res.status(400).json({
        error: "Message too long (max 500 characters)"
      });
    }

    // Two tiers:
    // 1. Verified, logged-in users — daily allowance, tracked by uid.
    // 2. Everyone else (no account, OR signed up but not yet
    //    verified) — treated identically as a guest, tracked by IP,
    //    daily allowance. An account only "counts" once OTP
    //    verification succeeds.
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

    console.log(
      isVerified ? `User (verified): ${req.user.email}` : "Guest request"
    );

    const reply = await askGroq(message.trim());

    return res.json({
      reply,
      remaining: usage.remaining,
      limit: usage.limit
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      error: err.message || "AI failed",
      details: err.message
    });
  }
});

export default router;

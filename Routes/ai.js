import express from "express";
import { streamGroqReply } from "../Services/groq.js";
import optionalAuth from "../middleware/optionalAuth.js";
import {
  checkAndConsumeGuestUsage,
  checkAndConsumeUserUsage,
  GUEST_DAILY_LIMIT,
  VERIFIED_DAILY_LIMIT
} from "../Services/usageTracker.js";

const router = express.Router();

router.post("/chat", optionalAuth, async (req, res) => {
  const t0 = Date.now();

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

    const userName = isVerified ? usage.displayName : null;

    console.log(`[TIMING] usage check done: +${Date.now() - t0}ms`);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Remaining", String(usage.remaining));
    res.setHeader("X-Limit", String(usage.limit));

    let firstChunk = true;

    for await (const chunk of streamGroqReply(message.trim(), safeHistory, userName)) {
      if (firstChunk) {
        console.log(`[TIMING] first Groq chunk: +${Date.now() - t0}ms`);
        firstChunk = false;
      }
      res.write(chunk);
    }

    console.log(`[TIMING] stream complete: +${Date.now() - t0}ms`);

    return res.end();

  } catch (err) {
    console.error("AI route error:", err.message);

    if (res.headersSent) {
      return res.end();
    }

    return res.status(500).json({
      error: "Something went wrong. Please try again."
    });
  }
});

export default router;
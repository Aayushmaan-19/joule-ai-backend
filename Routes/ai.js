import express from "express";
import { streamGroqReply } from "../Services/groq.js";
import optionalAuth from "../middleware/optionalAuth.js";
import {
  checkAndConsumeGuestUsage,
  checkAndConsumeUserUsage,
  refundGuestUsage,
  refundUserUsage,
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
    let refund;

    if (isVerified) {
      usage = await checkAndConsumeUserUsage(req.user.uid);
      refund = () => refundUserUsage(req.user.uid);

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
      refund = () => refundGuestUsage(ip);

      if (!usage.allowed) {
        return res.status(429).json({
          error: `You've used all ${GUEST_DAILY_LIMIT} free messages for today. Verify your email for ${VERIFIED_DAILY_LIMIT} messages a day.`,
          remaining: 0,
          limit: usage.limit
        });
      }
    }

    const userName = isVerified ? usage.displayName : null;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Remaining", String(usage.remaining));
    res.setHeader("X-Limit", String(usage.limit));

    try {
      for await (const chunk of streamGroqReply(message.trim(), safeHistory, userName)) {
        res.write(chunk);
      }
      return res.end();
    } catch (streamErr) {
      // Quota was consumed above to keep the check atomic against
      // concurrent requests — refund it now, since this message
      // never actually got a reply.
      await refund().catch(refundErr =>
        console.error("Usage refund failed:", refundErr.message)
      );
      throw streamErr;
    }

  } catch (err) {
    console.error("AI route error:", err.message);

    if (res.headersSent) {
      return res.end();
    }

    if (err.isRateLimit) {
      const wait = err.retryAfterSeconds;

      // Short, confirmed wait (what we've actually seen: Groq's per-minute
      // token limit, clears in well under a minute) gets an exact
      // countdown. Anything longer or unconfirmed gets honest, vaguer
      // wording — "try tomorrow" would be a guess we can't back up.
      const message = wait && wait <= 90
        ? `Joule's getting a lot of requests right now — try again in about ${Math.ceil(wait)} seconds.`
        : "Joule's hit its usage limit for the moment. Please try again shortly.";

      return res.status(429).json({ error: message });
    }

    return res.status(500).json({
      error: "Something went wrong. Please try again."
    });
  }
});

export default router;
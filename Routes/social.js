import express from "express";
import rateLimit from "express-rate-limit";
import verifyFirebase from "../middleware/verifyFirebase.js";
import {
  sendFollowRequest,
  acceptFollowRequest,
  declineFollowRequest,
  unfollow,
  sendMessage
} from "../Services/socialService.js";

const router = express.Router();

// Everything here requires a real, verified account — there's no
// guest path for social features, unlike chat.
router.use(verifyFirebase);

router.use((req, res, next) => {
  if (!req.user.email_verified) {
    return res.status(403).json({ error: "Verify your email to use messaging." });
  }
  next();
});

function requireUid(req, res, field = "targetUid") {
  const value = req.body?.[field];

  if (!value || typeof value !== "string") {
    res.status(400).json({ error: `${field} is required` });
    return null;
  }

  return value;
}

router.post("/follow", async (req, res) => {
  try {
    const targetUid = requireUid(req, res, "targetUid");
    if (!targetUid) return;

    await sendFollowRequest(req.user.uid, targetUid);

    return res.json({ requested: true });
  } catch (err) {
    console.error("Follow route error:", err.message);
    return res.status(err.status || 500).json({
      error: err.status ? err.message : "Something went wrong. Please try again."
    });
  }
});

router.post("/follow/accept", async (req, res) => {
  try {
    const requesterUid = requireUid(req, res, "requesterUid");
    if (!requesterUid) return;

    await acceptFollowRequest(req.user.uid, requesterUid);

    return res.json({ accepted: true });
  } catch (err) {
    console.error("Follow accept route error:", err.message);
    return res.status(err.status || 500).json({
      error: err.status ? err.message : "Something went wrong. Please try again."
    });
  }
});

router.post("/follow/decline", async (req, res) => {
  try {
    const requesterUid = requireUid(req, res, "requesterUid");
    if (!requesterUid) return;

    await declineFollowRequest(req.user.uid, requesterUid);

    return res.json({ declined: true });
  } catch (err) {
    console.error("Follow decline route error:", err.message);
    return res.status(err.status || 500).json({
      error: err.status ? err.message : "Something went wrong. Please try again."
    });
  }
});

router.post("/unfollow", async (req, res) => {
  try {
    const targetUid = requireUid(req, res, "targetUid");
    if (!targetUid) return;

    await unfollow(req.user.uid, targetUid);

    return res.json({ unfollowed: true });
  } catch (err) {
    console.error("Unfollow route error:", err.message);
    return res.status(err.status || 500).json({
      error: err.status ? err.message : "Something went wrong. Please try again."
    });
  }
});

const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "You're sending messages too quickly. Slow down a little." }
});

router.post("/message/send", messageLimiter, async (req, res) => {
  try {
    const toUid = requireUid(req, res, "toUid");
    if (!toUid) return;

    const { text } = req.body;

    if (typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }

    const result = await sendMessage(req.user.uid, toUid, text);

    return res.json(result);
  } catch (err) {
    console.error("Send message route error:", err.message);
    return res.status(err.status || 500).json({
      error: err.status ? err.message : "Something went wrong. Please try again."
    });
  }
});

export default router;

import express from "express";
import rateLimit from "express-rate-limit";
import verifyFirebase from "../middleware/verifyFirebase.js";
import {
  sendFollowRequest,
  acceptFollowRequest,
  declineFollowRequest,
  cancelFollowRequest,
  unfollow,
  sendMessage,
  editMessage,
  deleteMessage,
  toggleReaction,
  forwardMessage,
  markConversationRead,
  setTyping
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

router.post("/follow/cancel", async (req, res) => {
  try {
    const targetUid = requireUid(req, res, "targetUid");
    if (!targetUid) return;

    await cancelFollowRequest(req.user.uid, targetUid);

    return res.json({ cancelled: true });
  } catch (err) {
    console.error("Follow cancel route error:", err.message);
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

    const { text, replyTo } = req.body;

    if (typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }

    const result = await sendMessage(req.user.uid, toUid, text, { replyTo: replyTo || null });

    return res.json(result);
  } catch (err) {
    console.error("Send message route error:", err.message);
    return res.status(err.status || 500).json({
      error: err.status ? err.message : "Something went wrong. Please try again."
    });
  }
});

router.post("/message/edit", async (req, res) => {
  try {
    const { conversationId, messageId, text } = req.body || {};

    if (!conversationId || !messageId || typeof text !== "string") {
      return res.status(400).json({ error: "conversationId, messageId and text are required" });
    }

    await editMessage(req.user.uid, conversationId, messageId, text);

    return res.json({ edited: true });
  } catch (err) {
    console.error("Message edit route error:", err.message);
    return res.status(err.status || 500).json({
      error: err.status ? err.message : "Something went wrong. Please try again."
    });
  }
});

router.post("/message/delete", async (req, res) => {
  try {
    const { conversationId, messageId } = req.body || {};

    if (!conversationId || !messageId) {
      return res.status(400).json({ error: "conversationId and messageId are required" });
    }

    await deleteMessage(req.user.uid, conversationId, messageId);

    return res.json({ deleted: true });
  } catch (err) {
    console.error("Message delete route error:", err.message);
    return res.status(err.status || 500).json({
      error: err.status ? err.message : "Something went wrong. Please try again."
    });
  }
});

router.post("/message/react", async (req, res) => {
  try {
    const { conversationId, messageId, emoji } = req.body || {};

    if (!conversationId || !messageId || typeof emoji !== "string" || !emoji) {
      return res.status(400).json({ error: "conversationId, messageId and emoji are required" });
    }

    await toggleReaction(req.user.uid, conversationId, messageId, emoji);

    return res.json({ reacted: true });
  } catch (err) {
    console.error("Message react route error:", err.message);
    return res.status(err.status || 500).json({
      error: err.status ? err.message : "Something went wrong. Please try again."
    });
  }
});

router.post("/message/forward", messageLimiter, async (req, res) => {
  try {
    const { conversationId, messageId } = req.body || {};
    const toUid = requireUid(req, res, "toUid");
    if (!toUid) return;

    if (!conversationId || !messageId) {
      return res.status(400).json({ error: "conversationId and messageId are required" });
    }

    const result = await forwardMessage(req.user.uid, conversationId, messageId, toUid);

    return res.json(result);
  } catch (err) {
    console.error("Message forward route error:", err.message);
    return res.status(err.status || 500).json({
      error: err.status ? err.message : "Something went wrong. Please try again."
    });
  }
});

router.post("/message/read", async (req, res) => {
  try {
    const { conversationId } = req.body || {};
    if (!conversationId) {
      return res.status(400).json({ error: "conversationId is required" });
    }

    await markConversationRead(req.user.uid, conversationId);

    return res.json({ read: true });
  } catch (err) {
    console.error("Message read route error:", err.message);
    return res.status(err.status || 500).json({
      error: err.status ? err.message : "Something went wrong. Please try again."
    });
  }
});

const typingLimiter = rateLimit({
  windowMs: 10 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Slow down." }
});

router.post("/typing", typingLimiter, async (req, res) => {
  try {
    const { conversationId } = req.body || {};
    if (!conversationId) {
      return res.status(400).json({ error: "conversationId is required" });
    }

    await setTyping(req.user.uid, conversationId);

    return res.json({ ok: true });
  } catch (err) {
    // Typing is best-effort UI polish, not a critical action — fail quietly server-side, no need to surface an error to the sender over a missed keystroke ping.
    console.error("Typing route error:", err.message);
    return res.status(err.status || 500).json({ ok: false });
  }
});

export default router;

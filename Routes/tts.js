import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";

dotenv.config();

const router = express.Router();

const ttsLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many TTS requests. Please wait a moment." }
});

router.post("/", ttsLimiter, async (req, res) => {
  try {
    const { text, voiceId } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "Text is required" });
    }

    if (text.trim().length === 0) {
      return res.status(400).json({ error: "Empty text not allowed" });
    }

    if (text.length > 1500) {
      return res.status(400).json({ error: "Text too long for TTS (max 1500 characters)" });
    }

    const id = voiceId || process.env.VOICE_ID;

    if (!id) {
      return res.status(500).json({ error: "Voice ID not configured" });
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${id}/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVENLABS_API_KEY
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: "eleven_turbo_v2_5"
        })
      }
    );

    if (!response.ok) {
      console.error("ElevenLabs error:", response.status);
      return res.status(502).json({ error: "TTS service unavailable" });
    }

    const audioBuffer = await response.arrayBuffer();

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(audioBuffer));

  } catch (err) {
    console.error("TTS route error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
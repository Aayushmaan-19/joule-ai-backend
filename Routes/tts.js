import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const { text, voiceId } = req.body;

    const id = voiceId || process.env.VOICE_ID;

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${id}/stream`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": process.env.ELEVENLABS_API_KEY
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5"
        })
      }
    );

    if (!response.ok) {
      return res.status(500).send("TTS failed");
    }

    const audioBuffer = await response.arrayBuffer();

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(audioBuffer));

  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

export default router;
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import FormData from "form-data";
import fetch from "node-fetch";

const router = express.Router();

const uploadDir = path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.post("/", upload.single("audio"), async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No audio file uploaded" });
    }

    filePath = req.file.path;

    const formData = new FormData();
    formData.append("file", fs.createReadStream(filePath), {
      filename: "audio.webm",
      contentType: req.file.mimetype || "audio/webm",
    });
    formData.append("model", "whisper-large-v3");
    formData.append("response_format", "json");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: "Transcription failed", details: data });
    }

    return res.json({ success: true, text: data.text?.trim() || "" });

  } catch (err) {
    if (err.name === "AbortError") {
      return res.status(408).json({ success: false, error: "Transcription timeout" });
    }
    return res.status(500).json({ success: false, error: err.message });

  } finally {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
  }
});

export default router;

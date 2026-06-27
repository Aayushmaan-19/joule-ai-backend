import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import aiRoutes from "./Routes/ai.js";
import ttsRoute from "./Routes/tts.js";
import transcribeRoute from "./Routes/transcribe.js";
import authRoutes from "./Routes/auth.js";

const app = express();

app.use(helmet());

const ALLOWED_ORIGINS = [
  /^http:\/\/127\.0\.0\.1:\d+$/,
  /^http:\/\/localhost:\d+$/,
  /^https:\/\/joule-ai(-[a-z0-9]+)*\.vercel\.app$/
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowed = ALLOWED_ORIGINS.some(pattern => pattern.test(origin));
      if (allowed) return callback(null, true);

      callback(new Error(`CORS: origin not allowed — ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

app.use(express.json({ limit: "10kb" }));

app.use("/api/auth", authRoutes);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50
});

app.use(limiter);
app.use("/api/ai", aiRoutes);
app.use("/api/tts", ttsRoute);
app.use("/api/transcribe", transcribeRoute);
app.get("/", (req, res) => {
  res.send("🔥 Joule AI Backend Running");
});

// 5. START SERVER LAST
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(
    `🚀 Server running on http://localhost:${PORT}`
  );
});

server.on("error", (err) => {
  console.error(
    "💥 SERVER ERROR:",
    err
  );
});

process.on("exit", (code) => {
  console.error(
    "💀 PROCESS EXIT:",
    code
  );
});

process.on("uncaughtException", (err) => {
  console.error(
    "💥 UNCAUGHT EXCEPTION:",
    err
  );
});

process.on("unhandledRejection", (err) => {
  console.error(
    "💥 UNHANDLED REJECTION:",
    err
  );
});
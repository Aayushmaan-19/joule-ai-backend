import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import aiRoutes from "./Routes/ai.js";
import authRoutes from "./Routes/auth.js";
import imageRoutes from "./Routes/image.js";
import wakeRoutes from "./Routes/wake.js";

const app = express();

// Render sits as exactly one reverse-proxy hop in front of this app
// and sets X-Forwarded-For accordingly. Without this, every rate
// limiter here (and req.ip generally) sees Render's proxy address
// instead of the real client — meaning every guest would share one
// rate-limit bucket, not just a log warning.
app.set("trust proxy", 1);

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
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["X-Remaining", "X-Limit"]
  })
);

app.use(express.json({ limit: "10kb" }));

app.use("/api/auth", authRoutes);
app.use("/api/wake", wakeRoutes);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50
});

app.use(limiter);
app.use("/api/ai", aiRoutes);
app.use("/api/image", imageRoutes);
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
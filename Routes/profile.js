import express from "express";
import multer from "multer";
import { getFirestore } from "firebase-admin/firestore";
import verifyFirebase from "../middleware/verifyFirebase.js";
import { uploadAvatar } from "../Services/storage.js";

const router = express.Router();

router.use(verifyFirebase);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("File must be an image"));
    }
    cb(null, true);
  }
});

router.post("/avatar", upload.single("avatar"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image provided" });
    }

    const { url } = await uploadAvatar(req.user.uid, req.file.buffer, req.file.mimetype);

    await getFirestore()
      .collection("users")
      .doc(req.user.uid)
      .set({ avatar: url }, { merge: true });

    return res.json({ avatar: url });
  } catch (err) {
    console.error("Avatar upload error:", err.message);
    return res.status(500).json({ error: "Couldn't upload your avatar. Please try again." });
  }
});

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

router.post("/username", async (req, res) => {
  try {
    const raw = (req.body?.username || "").trim();
    const username = raw.toLowerCase();

    if (!USERNAME_PATTERN.test(username)) {
      return res.status(400).json({
        error: "Username must be 3-20 characters: lowercase letters, numbers, and underscores only."
      });
    }

    const db = getFirestore();
    const userRef = db.collection("users").doc(req.user.uid);
    const newHandleRef = db.collection("usernames").doc(username);

    await db.runTransaction(async tx => {
      const [handleSnap, userSnap] = await Promise.all([tx.get(newHandleRef), tx.get(userRef)]);

      if (handleSnap.exists && handleSnap.data().uid !== req.user.uid) {
        throw Object.assign(new Error("That username is taken."), { status: 409 });
      }

      const oldUsername = userSnap.data()?.username;

      if (oldUsername && oldUsername !== username) {
        tx.delete(db.collection("usernames").doc(oldUsername));
      }

      tx.set(newHandleRef, { uid: req.user.uid });
      tx.set(userRef, { username }, { merge: true });
    });

    return res.json({ username });
  } catch (err) {
    console.error("Username update error:", err.message);
    return res.status(err.status || 500).json({
      error: err.status ? err.message : "Couldn't update your username. Please try again."
    });
  }
});

// Multer's own errors (file too big, fileFilter rejection) call
// next(err) rather than throwing inside the async handler above, so
// they need this dedicated 4-arg error middleware to be caught.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "Image is too large (max 5MB)." : err.message;
    return res.status(400).json({ error: message });
  }
  if (err?.message === "File must be an image") {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

export default router;

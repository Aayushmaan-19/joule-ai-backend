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

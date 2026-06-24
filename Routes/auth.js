import "dotenv/config";
import express from "express";
import verifyFirebase from "../middleware/verifyFirebase.js";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import "../Services/firebase.js";
import { sendOtpEmail, generateOtp } from "../Services/mailer.js";

const router = express.Router();

const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

router.get("/me", verifyFirebase, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

/**
 * Generates a 6-digit OTP, stores it in Firestore, and emails it
 * to the currently authenticated (but not-yet-verified) user.
 */
router.post("/send-otp", verifyFirebase, async (req, res) => {
  try {
    const { uid, email } = req.user;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "No email associated with this account"
      });
    }

    const db = getFirestore();
    const otpRef = db.collection("otps").doc(uid);

    const existing = await otpRef.get();

    if (existing.exists) {
      const data = existing.data();
      const sentAt = data.sentAt?.toMillis?.() ?? 0;

      if (Date.now() - sentAt < RESEND_COOLDOWN_MS) {
        const waitMs = RESEND_COOLDOWN_MS - (Date.now() - sentAt);

        return res.status(429).json({
          success: false,
          message: "Please wait before requesting another code",
          retryAfterMs: waitMs
        });
      }
    }

    const code = generateOtp();
    const now = Date.now();

    await otpRef.set({
      code,
      email,
      sentAt: new Date(now),
      expiresAt: new Date(now + OTP_EXPIRY_MS),
      attempts: 0
    });

    await sendOtpEmail(email, code);

    return res.json({
      success: true,
      message: "Verification code sent"
    });

  } catch (err) {
    console.error("🔥 SEND-OTP ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to send verification code"
    });
  }
});

/**
 * Verifies the submitted 6-digit code. On success, flips the
 * Firebase Auth emailVerified flag for the user via Admin SDK.
 */
router.post("/verify-otp", verifyFirebase, async (req, res) => {
  try {
    const { uid } = req.user;
    const { code } = req.body;

    if (!code || typeof code !== "string" || code.trim().length !== 6) {
      return res.status(400).json({
        success: false,
        message: "Enter the 6-digit code"
      });
    }

    const db = getFirestore();
    const otpRef = db.collection("otps").doc(uid);
    const snap = await otpRef.get();

    if (!snap.exists) {
      return res.status(400).json({
        success: false,
        message: "No verification code found. Request a new one."
      });
    }

    const data = snap.data();
    const expiresAt = data.expiresAt?.toMillis?.() ?? 0;

    if (Date.now() > expiresAt) {
      await otpRef.delete();

      return res.status(400).json({
        success: false,
        message: "Code expired. Request a new one."
      });
    }

    if (data.attempts >= 5) {
      await otpRef.delete();

      return res.status(429).json({
        success: false,
        message: "Too many attempts. Request a new code."
      });
    }

    if (data.code !== code.trim()) {
      await otpRef.update({ attempts: data.attempts + 1 });

      return res.status(400).json({
        success: false,
        message: "Incorrect code"
      });
    }

    await getAuth().updateUser(uid, { emailVerified: true });

    await otpRef.delete();

    await db.collection("users").doc(uid).update({
      emailVerified: true
    });

    return res.json({
      success: true,
      message: "Email verified"
    });

  } catch (err) {
    console.error("🔥 VERIFY-OTP ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Verification failed"
    });
  }
});

export default router;

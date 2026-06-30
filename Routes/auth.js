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

/* =========================================================
   PRE-SIGNUP OTP FLOW
   No Firebase Auth user exists yet at this point. The OTP is
   keyed by email address in a dedicated "signupOtps" collection.
   The account is only created in Firebase Auth AFTER the code
   is verified — never before.
========================================================= */

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Sends a 6-digit OTP to an email address BEFORE any account exists.
 * Body: { email, password }
 * The password is stored alongside the OTP (server-side only, never
 * returned to the client) so it can be used to create the account
 * once the code is verified — this is the one and only place the
 * account gets created.
 */
router.post("/signup/send-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = req.body.password;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Valid email is required" });
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    // Reject if an account with this email already exists
    try {
      await getAuth().getUserByEmail(email);
      return res.status(409).json({ success: false, message: "An account with this email already exists" });
    } catch (err) {
      // auth/user-not-found is the expected (good) path — anything else is a real error
      if (err.code !== "auth/user-not-found") {
        throw err;
      }
    }

    const db = getFirestore();
    const otpRef = db.collection("signupOtps").doc(email);

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
      password, // server-side only — used once to create the account on verify
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
    console.error("🔥 SIGNUP SEND-OTP ERROR:", err.message);

    return res.status(500).json({
      success: false,
      message: "Failed to send verification code"
    });
  }
});

/**
 * Verifies the submitted 6-digit code for a pending signup.
 * ONLY on success does the Firebase Auth account get created.
 * Returns a Firebase custom token so the client can sign the
 * newly-created (and already-verified) user in immediately.
 */
router.post("/signup/verify-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = req.body.code;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, message: "Valid email is required" });
    }

    if (!code || typeof code !== "string" || code.trim().length !== 6) {
      return res.status(400).json({ success: false, message: "Enter the 6-digit code" });
    }

    const db = getFirestore();
    const otpRef = db.collection("signupOtps").doc(email);
    const snap = await otpRef.get();

    if (!snap.exists) {
      return res.status(400).json({
        success: false,
        message: "No verification code found. Start signup again."
      });
    }

    const data = snap.data();
    const expiresAt = data.expiresAt?.toMillis?.() ?? 0;

    if (Date.now() > expiresAt) {
      await otpRef.delete();

      return res.status(400).json({
        success: false,
        message: "Code expired. Start signup again."
      });
    }

    if (data.attempts >= 5) {
      await otpRef.delete();

      return res.status(429).json({
        success: false,
        message: "Too many attempts. Start signup again."
      });
    }

    if (data.code !== code.trim()) {
      await otpRef.update({ attempts: data.attempts + 1 });

      return res.status(400).json({
        success: false,
        message: "Incorrect code"
      });
    }

    // Code is correct — THIS is the one and only place a signup
    // account gets created. No account exists before this point.
    const userRecord = await getAuth().createUser({
      email: data.email,
      password: data.password,
      emailVerified: true
    });

    await db.collection("users").doc(userRecord.uid).set({
      uid: userRecord.uid,
      email: data.email,
      createdAt: new Date(),
      plan: "free",
      messagesUsed: 0,
      voiceUsed: 0,
      emailVerified: true
    });

    await otpRef.delete();

    const customToken = await getAuth().createCustomToken(userRecord.uid);

    return res.json({
      success: true,
      message: "Email verified",
      customToken
    });

  } catch (err) {
    console.error("🔥 SIGNUP VERIFY-OTP ERROR:", err.message);

    return res.status(500).json({
      success: false,
      message: "Verification failed"
    });
  }
});

/* =========================================================
   EXISTING LOGGED-IN-USER OTP FLOW
   Used for: an already-logged-in but unverified user (e.g. from
   Google sign-in with an unverified email, or a stale session)
   requesting/verifying a code. Distinct from the pre-signup flow
   above because here a Firebase Auth user already exists.
========================================================= */

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
    console.error("🔥 SEND-OTP ERROR:", err.message);

    return res.status(500).json({
      success: false,
      message: "Failed to send verification code"
    });
  }
});

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

    await db.collection("users").doc(uid).set({
      emailVerified: true
    }, { merge: true });

    return res.json({
      success: true,
      message: "Email verified"
    });

  } catch (err) {
    console.error("🔥 VERIFY-OTP ERROR:", err.message);

    return res.status(500).json({
      success: false,
      message: "Verification failed"
    });
  }
});

export default router;
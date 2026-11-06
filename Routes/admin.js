import express from "express";
import verifyFirebase from "../middleware/verifyFirebase.js";
import requireAdmin from "../middleware/requireAdmin.js";
import {
  acceptFollowRequest,
  declineFollowRequest
} from "../Services/socialService.js";
import {
  listUsers,
  getUserDetail,
  startImpersonation,
  endImpersonation,
  logAdminAction,
  recentAudit
} from "../Services/adminService.js";
import { organizeDatabase } from "../Services/dbOrganizer.js";
import { userLabel } from "../Services/userIdentity.js";
import { getFirestore } from "firebase-admin/firestore";

const router = express.Router();

function handle(fn) {
  return async (req, res) => {
    try {
      res.json({ success: true, ...(await fn(req)) });
    } catch (err) {
      if (!err.status) console.error("ADMIN ERROR:", err);
      res.status(err.status || 500).json({
        success: false,
        message: err.status ? err.message : "Something went wrong"
      });
    }
  };
}

// The one admin route that is NOT admin-only: it is called from inside an
// "open as user" session, which by design is not an admin session.
router.post("/impersonation/exit", verifyFirebase, handle(req => endImpersonation(req.user)));

router.use(...requireAdmin);

router.get("/users", handle(async req => ({ users: await listUsers(String(req.query.q || "")) })));

router.get("/users/:uid", handle(req => getUserDetail(req.params.uid)));

async function targetLabel(uid) {
  const snap = await getFirestore().collection("users").doc(uid).get();
  return userLabel(snap.data() || {}, uid);
}

// Accept / decline a follow request ON BEHALF OF a user (same service
// functions their own account would call), written to the audit log.
router.post(
  "/users/:uid/requests/:requesterUid/accept",
  handle(async req => {
    const { uid, requesterUid } = req.params;
    await acceptFollowRequest(uid, requesterUid);
    await logAdminAction(req.user, "request.accept", { uid, label: await targetLabel(uid) }, { requesterUid });
    return {};
  })
);

router.post(
  "/users/:uid/requests/:requesterUid/decline",
  handle(async req => {
    const { uid, requesterUid } = req.params;
    await declineFollowRequest(uid, requesterUid);
    await logAdminAction(req.user, "request.decline", { uid, label: await targetLabel(uid) }, { requesterUid });
    return {};
  })
);

router.post("/users/:uid/impersonate", handle(req => startImpersonation(req.user, req.params.uid)));

router.post(
  "/organize",
  handle(async req => {
    const stats = await organizeDatabase();
    await logAdminAction(req.user, "database.organize", {}, stats);
    return { stats };
  })
);

router.get("/audit", handle(async () => ({ entries: await recentAudit() })));

export default router;

import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { userLabel, userName } from "./userIdentity.js";
import { isAdminEmail } from "../middleware/requireAdmin.js";

const MAX_USERS = 300;

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const iso = value => (value?.toDate ? value.toDate().toISOString() : null);

/** Every admin action that changes something or opens someone's account is written here. */
export async function logAdminAction(admin, action, target = {}, details = {}) {
  await getFirestore().collection("adminAuditLog").add({
    at: new Date(),
    adminUid: admin.uid,
    adminEmail: admin.email || null,
    action,
    targetUid: target.uid || null,
    targetLabel: target.label || null,
    details
  });
}

function summarize(doc) {
  const d = doc.data();
  return {
    uid: doc.id,
    readableId: d.readableId || null,
    label: d.label || userLabel(d, doc.id),
    name: userName(d, doc.id),
    email: d.email || null,
    username: d.username || null,
    displayName: d.displayName || null,
    avatar: d.avatar || null,
    plan: d.plan || "free",
    emailVerified: d.emailVerified === true,
    followerCount: d.followerCount || 0,
    followingCount: d.followingCount || 0,
    createdAt: iso(d.createdAt),
    lastLoginAt: iso(d.lastLoginAt)
  };
}

export async function listUsers(query = "") {
  const snap = await getFirestore().collection("users").limit(MAX_USERS).get();
  const q = query.trim().toLowerCase();

  return snap.docs
    .map(summarize)
    .filter(u => !q || [u.label, u.email, u.username, u.displayName, u.readableId, u.uid].some(v => String(v || "").toLowerCase().includes(q)))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function userSummaries(uids) {
  const db = getFirestore();
  const unique = [...new Set(uids)];
  if (unique.length === 0) return new Map();

  const docs = await db.getAll(...unique.map(uid => db.collection("users").doc(uid)));
  return new Map(docs.filter(d => d.exists).map(d => [d.id, summarize(d)]));
}

/** Everything about one account that matters for support / security checks. Message text is NOT included. */
export async function getUserDetail(uid) {
  const db = getFirestore();
  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) throw fail(404, "User not found");

  const [followers, following, incoming, outgoing, convos] = await Promise.all([
    db.collection("follows").where("followee", "==", uid).get(),
    db.collection("follows").where("follower", "==", uid).get(),
    db.collection("followRequests").where("target", "==", uid).get(),
    db.collection("followRequests").where("requester", "==", uid).get(),
    db.collection("conversations").where("participants", "array-contains", uid).get()
  ]);

  const related = [
    ...followers.docs.map(d => d.data().follower),
    ...following.docs.map(d => d.data().followee),
    ...incoming.docs.map(d => d.data().requester),
    ...outgoing.docs.map(d => d.data().target),
    ...convos.docs.flatMap(d => d.data().participants || [])
  ];
  const people = await userSummaries(related);
  const who = other => people.get(other) || { uid: other, label: other.slice(0, 8), name: other.slice(0, 8) };

  return {
    user: summarize(userSnap),
    followers: followers.docs.map(d => who(d.data().follower)),
    following: following.docs.map(d => who(d.data().followee)),
    incomingRequests: incoming.docs.map(d => ({
      ...who(d.data().requester),
      requestedAt: iso(d.data().createdAt)
    })),
    outgoingRequests: outgoing.docs.map(d => ({
      ...who(d.data().target),
      requestedAt: iso(d.data().createdAt)
    })),
    conversations: convos.docs
      .map(d => {
        const data = d.data();
        const otherUid = (data.participants || []).find(p => p !== uid);
        return {
          id: d.id,
          with: who(otherUid),
          lastMessageAt: iso(data.updatedAt),
          lastMessagePreview: data.lastMessage?.deleted ? "(deleted)" : (data.lastMessage?.text || "").slice(0, 80)
        };
      })
      .sort((a, b) => String(b.lastMessageAt || "").localeCompare(String(a.lastMessageAt || "")))
  };
}

/** A custom token that signs the admin in AS the target user. Marked so the session can be recognised and exited. */
export async function startImpersonation(admin, targetUid) {
  const db = getFirestore();
  const targetSnap = await db.collection("users").doc(targetUid).get();
  if (!targetSnap.exists) throw fail(404, "User not found");
  if (targetUid === admin.uid) throw fail(400, "That's your own account");

  const target = targetSnap.data();
  if (isAdminEmail(target.email)) throw fail(403, "Admin accounts can't be opened this way");

  const customToken = await getAuth().createCustomToken(targetUid, { impersonatedBy: admin.uid });
  await logAdminAction(admin, "impersonation.start", { uid: targetUid, label: userLabel(target, targetUid) });

  return { customToken, label: userLabel(target, targetUid) };
}

/**
 * Called from the impersonated session itself. The `impersonatedBy` claim
 * was signed by this server when the session started, so it can't be forged
 * by a client; the admin's email is still re-checked against ADMIN_EMAILS.
 */
export async function endImpersonation(decoded) {
  const adminUid = decoded.impersonatedBy;
  if (!adminUid) throw fail(403, "This isn't an admin session");

  const adminRecord = await getAuth().getUser(adminUid);
  if (!adminRecord.emailVerified || !isAdminEmail(adminRecord.email)) {
    throw fail(403, "Admin access has been removed");
  }

  const customToken = await getAuth().createCustomToken(adminUid);
  await logAdminAction(
    { uid: adminUid, email: adminRecord.email },
    "impersonation.end",
    { uid: decoded.uid, label: decoded.email || decoded.uid }
  );

  return { customToken };
}

export async function recentAudit(limit = 60) {
  const snap = await getFirestore()
    .collection("adminAuditLog")
    .orderBy("at", "desc")
    .limit(limit)
    .get();

  return snap.docs.map(d => {
    const x = d.data();
    return {
      id: d.id,
      at: iso(x.at) || (x.at instanceof Date ? x.at.toISOString() : null),
      adminEmail: x.adminEmail,
      action: x.action,
      targetLabel: x.targetLabel,
      details: x.details || {}
    };
  });
}

import { getFirestore, FieldValue } from "firebase-admin/firestore";

const MAX_MESSAGE_LENGTH = 2000;

/**
 * Attaches an HTTP status to a plain Error so the route layer can
 * respond with the right code without re-deriving it. Kept as a
 * lightweight convention rather than a class hierarchy — one line
 * at each throw site, one line at each catch site.
 */
function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function followId(followerUid, followeeUid) {
  return `${followerUid}_${followeeUid}`;
}

function requestId(requesterUid, targetUid) {
  return `${requesterUid}_${targetUid}`;
}

function conversationId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

/**
 * Sends a follow request from `requesterUid` to `targetUid`. Every
 * follow in this app requires the target's approval — there is no
 * "public account, instant follow" path — so this only ever creates
 * a pending request, never a `follows` edge directly.
 */
export async function sendFollowRequest(requesterUid, targetUid) {
  if (requesterUid === targetUid) {
    throw fail(400, "You can't follow yourself");
  }

  const db = getFirestore();
  const targetRef = db.collection("users").doc(targetUid);
  const followRef = db.collection("follows").doc(followId(requesterUid, targetUid));
  const requestRef = db.collection("followRequests").doc(requestId(requesterUid, targetUid));

  const [targetSnap, followSnap, requestSnap] = await Promise.all([
    targetRef.get(),
    followRef.get(),
    requestRef.get()
  ]);

  if (!targetSnap.exists) {
    throw fail(404, "User not found");
  }
  if (followSnap.exists) {
    throw fail(409, "Already following this user");
  }
  if (requestSnap.exists) {
    throw fail(409, "Follow request already sent");
  }

  const requesterSnap = await db.collection("users").doc(requesterUid).get();
  const requesterData = requesterSnap.data() || {};

  await requestRef.set({
    requester: requesterUid,
    target: targetUid,
    requesterName: requesterData.displayName || "Someone",
    requesterAvatar: requesterData.avatar || null,
    createdAt: new Date()
  });
}

/**
 * Accepts a pending request. This is the one place a `follows` edge
 * gets created — atomically, alongside deleting the request and
 * incrementing both people's counters, so the three can never drift
 * out of sync with each other.
 */
export async function acceptFollowRequest(targetUid, requesterUid) {
  const db = getFirestore();
  const requestRef = db.collection("followRequests").doc(requestId(requesterUid, targetUid));
  const followRef = db.collection("follows").doc(followId(requesterUid, targetUid));
  const requesterRef = db.collection("users").doc(requesterUid);
  const targetRef = db.collection("users").doc(targetUid);

  await db.runTransaction(async (tx) => {
    const requestSnap = await tx.get(requestRef);

    if (!requestSnap.exists || requestSnap.data().target !== targetUid) {
      throw fail(404, "No pending request from this user");
    }

    tx.delete(requestRef);

    tx.set(followRef, {
      follower: requesterUid,
      followee: targetUid,
      createdAt: new Date()
    });

    tx.update(requesterRef, { followingCount: FieldValue.increment(1) });
    tx.update(targetRef, { followerCount: FieldValue.increment(1) });
  });
}

/** Declines (deletes) a pending request. No edge, no counters — nothing to unwind. */
export async function declineFollowRequest(targetUid, requesterUid) {
  const db = getFirestore();
  const requestRef = db.collection("followRequests").doc(requestId(requesterUid, targetUid));

  const snap = await requestRef.get();

  if (!snap.exists || snap.data().target !== targetUid) {
    throw fail(404, "No pending request from this user");
  }

  await requestRef.delete();
}

/**
 * Removes an accepted follow edge and decrements both counters
 * atomically. Either side of a connection can sever it — the
 * follower unfollowing, or the followee removing them — so this
 * takes the edge's two uids directly rather than assuming who
 * initiated the follow originally.
 */
export async function unfollow(followerUid, followeeUid) {
  const db = getFirestore();
  const followRef = db.collection("follows").doc(followId(followerUid, followeeUid));
  const followerRef = db.collection("users").doc(followerUid);
  const followeeRef = db.collection("users").doc(followeeUid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(followRef);

    if (!snap.exists) {
      throw fail(404, "Not following this user");
    }

    tx.delete(followRef);
    tx.update(followerRef, { followingCount: FieldValue.increment(-1) });
    tx.update(followeeRef, { followerCount: FieldValue.increment(-1) });
  });
}

/**
 * True once a follow edge exists in either direction between the two
 * uids. Accepting a request is the trust boundary in this app — once
 * B accepts A's request, messaging unlocks both ways, regardless of
 * whether B ever follows A back. A separate "follow back to unlock
 * replies" step would just be friction on top of a decision B already
 * made when they hit accept.
 */
async function areConnected(uidA, uidB) {
  const db = getFirestore();
  const [a, b] = await Promise.all([
    db.collection("follows").doc(followId(uidA, uidB)).get(),
    db.collection("follows").doc(followId(uidB, uidA)).get()
  ]);
  return a.exists || b.exists;
}

/**
 * Sends a message, creating the conversation document on first
 * contact. `conversations/{id}` uses a deterministic id (sorted uid
 * pair) so there's exactly one thread per pair — no query needed to
 * find or dedupe it, on either the client or here.
 */
export async function sendMessage(senderUid, recipientUid, text) {
  if (senderUid === recipientUid) {
    throw fail(400, "You can't message yourself");
  }

  const trimmed = (text || "").trim();

  if (!trimmed) {
    throw fail(400, "Message can't be empty");
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw fail(400, `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`);
  }

  const connected = await areConnected(senderUid, recipientUid);
  if (!connected) {
    throw fail(403, "You can only message people who've accepted your follow");
  }

  const db = getFirestore();
  const convoId = conversationId(senderUid, recipientUid);
  const convoRef = db.collection("conversations").doc(convoId);
  const messageRef = convoRef.collection("messages").doc();

  const [senderSnap, recipientSnap] = await Promise.all([
    db.collection("users").doc(senderUid).get(),
    db.collection("users").doc(recipientUid).get()
  ]);

  const senderData = senderSnap.data() || {};
  const recipientData = recipientSnap.data() || {};
  const now = new Date();

  await db.runTransaction(async (tx) => {
    const convoSnap = await tx.get(convoRef);

    tx.set(messageRef, {
      senderUid,
      text: trimmed,
      sentAt: now
    });

    tx.set(
      convoRef,
      {
        ...(convoSnap.exists ? {} : { createdAt: now }),
        participants: [senderUid, recipientUid],
        participantInfo: {
          [senderUid]: {
            displayName: senderData.displayName || "Someone",
            avatar: senderData.avatar || null
          },
          [recipientUid]: {
            displayName: recipientData.displayName || "Someone",
            avatar: recipientData.avatar || null
          }
        },
        lastMessage: { text: trimmed, senderUid, sentAt: now },
        updatedAt: now
      },
      { merge: true }
    );
  });

  return { conversationId: convoId, messageId: messageRef.id, sentAt: now.getTime() };
}

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

/** Withdraws a request I sent, before the other person has acted on it. Symmetric to declineFollowRequest, but from the requester's side. */
export async function cancelFollowRequest(requesterUid, targetUid) {
  const db = getFirestore();
  const requestRef = db.collection("followRequests").doc(requestId(requesterUid, targetUid));

  const snap = await requestRef.get();

  if (!snap.exists || snap.data().requester !== requesterUid) {
    throw fail(404, "No pending request to this user");
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

/** Throws unless uid is one of the two participants on this conversation. Shared gate for every per-message action below. */
async function assertParticipant(uid, convoId) {
  const db = getFirestore();
  const convoSnap = await db.collection("conversations").doc(convoId).get();

  if (!convoSnap.exists || !convoSnap.data().participants.includes(uid)) {
    throw fail(403, "You're not part of this conversation");
  }

  return convoSnap;
}

/**
 * Sends a message, creating the conversation document on first
 * contact. `conversations/{id}` uses a deterministic id (sorted uid
 * pair) so there's exactly one thread per pair — no query needed to
 * find or dedupe it, on either the client or here. `replyTo` and
 * `forwardedFrom` are optional denormalized snippets attached to the
 * message so rendering a thread never needs a second read.
 */
export async function sendMessage(senderUid, recipientUid, text, { replyTo = null, forwardedFrom = null } = {}) {
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
      sentAt: now,
      reactions: {},
      replyTo,
      forwardedFrom
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
        lastMessage: { messageId: messageRef.id, text: trimmed, senderUid, sentAt: now, deleted: false },
        updatedAt: now
      },
      { merge: true }
    );
  });

  return { conversationId: convoId, messageId: messageRef.id, sentAt: now.getTime() };
}

const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Only the sender, only within a short window, only if it hasn't already been deleted. */
export async function editMessage(uid, convoId, messageId, newText) {
  const trimmed = (newText || "").trim();
  if (!trimmed) throw fail(400, "Message can't be empty");
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw fail(400, `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`);
  }

  const db = getFirestore();
  const convoRef = db.collection("conversations").doc(convoId);
  const messageRef = convoRef.collection("messages").doc(messageId);

  await db.runTransaction(async (tx) => {
    const [convoSnap, msgSnap] = await Promise.all([tx.get(convoRef), tx.get(messageRef)]);

    if (!convoSnap.exists || !convoSnap.data().participants.includes(uid)) {
      throw fail(403, "You're not part of this conversation");
    }
    if (!msgSnap.exists || msgSnap.data().deleted) {
      throw fail(404, "Message not found");
    }
    if (msgSnap.data().senderUid !== uid) {
      throw fail(403, "You can only edit your own messages");
    }
    if (Date.now() - msgSnap.data().sentAt.toMillis() > EDIT_WINDOW_MS) {
      throw fail(403, "This message is too old to edit");
    }

    const now = new Date();
    tx.update(messageRef, { text: trimmed, editedAt: now });

    if (convoSnap.data().lastMessage?.messageId === messageId) {
      tx.update(convoRef, { "lastMessage.text": trimmed });
    }
  });
}

/**
 * Soft delete — the doc stays (so the thread's ordering and any
 * replies pointing at it stay intact) but the text is actually wiped
 * server-side, not just hidden client-side, so it isn't sitting in
 * Firestore for anyone to read back out.
 */
export async function deleteMessage(uid, convoId, messageId) {
  const db = getFirestore();
  const convoRef = db.collection("conversations").doc(convoId);
  const messageRef = convoRef.collection("messages").doc(messageId);

  await db.runTransaction(async (tx) => {
    const [convoSnap, msgSnap] = await Promise.all([tx.get(convoRef), tx.get(messageRef)]);

    if (!convoSnap.exists || !convoSnap.data().participants.includes(uid)) {
      throw fail(403, "You're not part of this conversation");
    }
    if (!msgSnap.exists) throw fail(404, "Message not found");
    if (msgSnap.data().senderUid !== uid) {
      throw fail(403, "You can only delete your own messages");
    }

    tx.update(messageRef, { text: "", deleted: true, reactions: {} });

    if (convoSnap.data().lastMessage?.messageId === messageId) {
      tx.update(convoRef, { "lastMessage.text": "", "lastMessage.deleted": true });
    }
  });
}

/** Tap the same emoji again to remove it — one reaction per person per message, like every app that does this. */
export async function toggleReaction(uid, convoId, messageId, emoji) {
  const db = getFirestore();
  await assertParticipant(uid, convoId);

  const messageRef = db.collection("conversations").doc(convoId).collection("messages").doc(messageId);
  const msgSnap = await messageRef.get();

  if (!msgSnap.exists || msgSnap.data().deleted) {
    throw fail(404, "Message not found");
  }

  const current = msgSnap.data().reactions || {};
  const isRemoving = current[uid] === emoji;

  await messageRef.update({
    [`reactions.${uid}`]: isRemoving ? FieldValue.delete() : emoji
  });
}

/** Re-sends the source message's text into a new conversation with `toUid`, tagged with who it originally came from. */
export async function forwardMessage(uid, convoId, messageId, toUid) {
  const db = getFirestore();
  await assertParticipant(uid, convoId);

  const msgSnap = await db.collection("conversations").doc(convoId).collection("messages").doc(messageId).get();

  if (!msgSnap.exists || msgSnap.data().deleted) {
    throw fail(404, "Message not found");
  }

  const original = msgSnap.data();
  const originalSenderSnap = await db.collection("users").doc(original.senderUid).get();
  const originalSenderName = originalSenderSnap.data()?.displayName || "Someone";

  return sendMessage(uid, toUid, original.text, { forwardedFrom: originalSenderName });
}

/** Advances my own read cursor for this conversation to now — the other participant's unread count is derived by comparing message timestamps against this on read. */
export async function markConversationRead(uid, convoId) {
  const db = getFirestore();
  await assertParticipant(uid, convoId);

  await db.collection("conversations").doc(convoId).update({
    [`lastRead.${uid}`]: new Date()
  });
}

/** Stamps "I'm typing" with a timestamp rather than a boolean, so a client that never sends an explicit "stopped" event still self-expires — the reader just treats anything older than a few seconds as not-typing. */
export async function setTyping(uid, convoId) {
  const db = getFirestore();
  await assertParticipant(uid, convoId);

  await db.collection("conversations").doc(convoId).update({
    [`typing.${uid}`]: new Date()
  });
}

import "../Services/firebase.js";
import { getAuth } from "firebase-admin/auth";
 
/**
 * Unlike verifyFirebase, this middleware does NOT reject requests
 * without a token. It's used on routes that should work for both
 * guests and logged-in users, with different behavior for each
 * (e.g. /api/ai/chat, which rate-limits guests by IP and logged-in
 * users by daily message count).
 *
 * - If a valid token is present: req.user is set, req.isGuest = false
 * - If no token, or an invalid token: req.user is null, req.isGuest = true
 */
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
 
  if (!authHeader) {
    req.user = null;
    req.isGuest = true;
    return next();
  }
 
  try {
    const token = authHeader.replace("Bearer ", "");
    const decodedToken = await getAuth().verifyIdToken(token);
 
    req.user = decodedToken;
    req.isGuest = false;
 
    next();
  } catch (err) {
    // Invalid/expired token — treat as guest rather than hard-failing,
    // since this route should still be usable without an account.
    console.error("optionalAuth: invalid token, falling back to guest", err.message);
 
    req.user = null;
    req.isGuest = true;
 
    next();
  }
};
 
export default optionalAuth;
import verifyFirebase from "./verifyFirebase.js";

/**
 * Who is an admin: the verified email addresses listed in the ADMIN_EMAILS
 * environment variable (comma-separated). There is no admin flag in the
 * database, no hard-coded address, and no way to become one from the
 * client. If ADMIN_EMAILS is unset, nobody is an admin.
 */
export function adminEmails() {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email) {
  return adminEmails().includes(String(email || "").toLowerCase());
}

/**
 * True for a normal sign-in by an admin. A session started by
 * "open as user" carries an `impersonatedBy` claim and is deliberately NOT
 * an admin session — it can only do what that user could, plus exit.
 */
export function isAdminToken(decoded) {
  return (
    !decoded.impersonatedBy &&
    decoded.email_verified === true &&
    isAdminEmail(decoded.email)
  );
}

function adminOnly(req, res, next) {
  if (!isAdminToken(req.user)) {
    return res.status(403).json({ success: false, message: "Admins only" });
  }
  next();
}

export default [verifyFirebase, adminOnly];

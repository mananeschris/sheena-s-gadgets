const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { query, sameOrigin, ensureSessionTable } = require("./chatSession");

const receipt = "If an account uses that email, a password reset link will be sent. Check your inbox and spam folder.";
const hash = value => crypto.createHash("sha256").update(value).digest("hex");

module.exports = function passwordRecovery({ sendEmail, ensureTwoFactorColumns, isValidPassword }) {
  const router = express.Router();
  const schemas = new WeakMap();
  const requests = new Map();

  function limited(key, maximum, windowMs) {
    const now = Date.now();
    for (const [id, entry] of requests) if (entry.until <= now) requests.delete(id);
    const entry = requests.get(key) || { count: 0, until: now + windowMs };
    if (entry.count >= maximum || requests.size > 10000) return true;
    entry.count++;
    requests.set(key, entry);
    return false;
  }

  function ensureSchema(db) {
    if (!schemas.has(db)) {
      schemas.set(db, query(db, `CREATE TABLE IF NOT EXISTS account_password_resets (
        user_id INT NOT NULL PRIMARY KEY, token_hash CHAR(64) NULL UNIQUE,
        expires_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB`).catch(error => { schemas.delete(db); throw error; }));
    }
    return schemas.get(db);
  }

  router.post("/forgot-password", sameOrigin, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid email address." });
    if (limited(`request-ip:${req.ip}`, 100, 3600000) || limited(`request:${req.ip}:${hash(email)}`, 10, 3600000)) return res.status(429).json({ message: "Too many reset requests. Please try again later." });
    try {
      const base = new URL(process.env.APP_BASE_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000"));
      if (!["http:", "https:"].includes(base.protocol) || (process.env.NODE_ENV === "production" && base.protocol !== "https:")) throw new Error("Invalid APP_BASE_URL");
      await ensureSchema(req.db);
      await require('./employeeAccounts').ensureStateSchema(req.db);
      const users = await query(req.db, "SELECT id, name, email FROM users WHERE LOWER(TRIM(email))=? AND (LOWER(role) NOT IN ('staff','rider') OR account_status='active') LIMIT 1", [email]);
      if (users.length) {
        const user = users[0];
        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = hash(token);
        // The cooldown is claimed atomically, including concurrent resend requests.
        await query(req.db, `INSERT INTO account_password_resets (user_id, token_hash, expires_at)
          VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE)) ON DUPLICATE KEY UPDATE
          token_hash=IF(created_at<=DATE_SUB(NOW(), INTERVAL 60 SECOND), VALUES(token_hash), token_hash),
          expires_at=IF(created_at<=DATE_SUB(NOW(), INTERVAL 60 SECOND), VALUES(expires_at), expires_at),
          created_at=IF(created_at<=DATE_SUB(NOW(), INTERVAL 60 SECOND), NOW(), created_at)`, [user.id, tokenHash]);
        const claimed = await query(req.db, "SELECT user_id FROM account_password_resets WHERE user_id=? AND token_hash=?", [user.id, tokenHash]);
        if (claimed.length) {
          const url = new URL("/auth.html", base);
          url.searchParams.set("mode", "reset");
          url.searchParams.set("token", token);
          // Do not expose account existence through the provider's response time or errors.
          Promise.resolve().then(() => sendEmail(user, url.toString())).catch(async () => {
            console.error("Password recovery email delivery failed.");
            try { await query(req.db, "UPDATE account_password_resets SET token_hash=NULL, expires_at=NULL WHERE user_id=? AND token_hash=?", [user.id, tokenHash]); } catch (_) {}
          });
        }
      }
      res.json({ message: receipt });
    } catch (_) {
      res.status(503).json({ message: "Account recovery is temporarily unavailable. Please try again later." });
    }
  });

  router.post("/reset-password", sameOrigin, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (limited(`reset:${req.ip}`, 100, 900000)) return res.status(429).json({ message: "Too many attempts. Please try again later." });
    const token = String(req.body?.token || "");
    const password = String(req.body?.password || "");
    if (!/^[a-f0-9]{64}$/.test(token)) return res.status(400).json({ message: "This reset link is invalid or expired. Request a new link." });
    if (Buffer.byteLength(password) > 72 || !isValidPassword(password)) return res.status(400).json({ message: "Use at least 8 characters with an uppercase letter, number, and symbol. Maximum 72 bytes." });
    try {
      await ensureSchema(req.db);
      await require('./employeeAccounts').ensureStateSchema(req.db);
      await ensureTwoFactorColumns(req.db);
      await ensureSessionTable(req.db);
      await require('./adminAuth').ensureChallenges(req.db);
      const owners = await query(req.db, `SELECT u.id,u.name,u.role FROM users u JOIN account_password_resets r ON r.user_id=u.id
        WHERE r.token_hash=? AND r.expires_at>NOW() AND (LOWER(u.role) NOT IN ('staff','rider') OR u.account_status='active') LIMIT 1`, [hash(token)]);
      if (!owners.length) return res.status(400).json({ message: 'This reset link is invalid or expired. Request a new link.' });
      const passwordHash = await bcrypt.hash(password, 10);
      // A single InnoDB update consumes the token, changes the password, and revokes sessions.
      const result = await query(req.db, `UPDATE users u
        JOIN account_password_resets r ON r.user_id=u.id
        LEFT JOIN delivery_chat_sessions s ON s.user_id=u.id
        LEFT JOIN admin_auth_challenges c ON c.user_id=u.id
        SET u.password=?, u.email_2fa_code_hash=NULL, u.email_2fa_expires_at=NULL, u.email_2fa_attempts=0,
          r.token_hash=NULL, r.expires_at=NULL, s.expires_at=NOW(), c.expires_at=NOW()
        WHERE r.token_hash=? AND r.expires_at>NOW() AND (LOWER(u.role) NOT IN ('staff','rider') OR u.account_status='active')`, [passwordHash, hash(token)]);
      if (!result.affectedRows) return res.status(400).json({ message: "This reset link is invalid or expired. Request a new link." });
      await require('./authSecurity').securityEvent(req, 'password_reset', owners[0], 'Password recovery; previous sessions and pending admin codes expired');
      res.json({ message: "Password updated. Sign in with your new password." });
    } catch (_) {
      res.status(500).json({ message: "Unable to reset your password. Please try again." });
    }
  });
  return router;
};

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { query, issueSession, revokeSession, sameOrigin } = require('./chatSession');
const { requireAdmin, requireAdminOrStaff } = require('./roleGuard');
const { storeSession, requireRecentAdmin } = require('./adminSessions');
const { securityEvent, successfulLogin, loginProtection, claimAdminEmail } = require('./authSecurity');
const schemas = new WeakMap();
const COOKIE = 'admin_challenge';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const cookieOptions = req => ({ httpOnly: true, sameSite: 'strict', secure: req.secure || process.env.NODE_ENV === 'production', path: '/auth', maxAge: 600000 });

function challengeHash(req) {
  const cookie = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`));
  const token = cookie?.slice(COOKIE.length + 1) || '';
  return /^[a-f0-9]{64}$/.test(token) ? hash(token) : null;
}
function ensureChallenges(db) {
  if (!schemas.has(db)) schemas.set(db, query(db, `CREATE TABLE IF NOT EXISTS admin_auth_challenges (
    token_hash CHAR(64) PRIMARY KEY, user_id INT NOT NULL, purpose VARCHAR(20) NOT NULL,
    session_hash CHAR(64) NULL, code_hash VARCHAR(255) NOT NULL, attempts INT NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL, INDEX idx_admin_challenge_expiry (expires_at)
  ) ENGINE=InnoDB`).catch(error => { schemas.delete(db); throw error; }));
  return schemas.get(db);
}

module.exports = function adminAuth({ sendCode, configured, passwordMatches, notifyLogin, notifySecurity, safeUser, isValidPassword }) {
  const router = express.Router();

  async function clearChallenge(req, res) {
    const tokenHash = challengeHash(req);
    if (tokenHash) {
      await ensureChallenges(req.db);
      await query(req.db, 'DELETE FROM admin_auth_challenges WHERE token_hash=?', [tokenHash]);
    }
    res.clearCookie(COOKIE, { ...cookieOptions(req), maxAge: undefined });
  }

  async function beginChallenge(req, res, user, purpose) {
    if (!configured()) return res.status(503).json({ message: 'Admin verification email is not configured. Contact the system administrator.' });
    if (!await claimAdminEmail(req, user)) {
      res.set('Retry-After', '900');
      return res.status(429).json({ message: 'Too many security code requests. Please try again in 15 minutes.' });
    }
    await ensureChallenges(req.db);
    await query(req.db, 'DELETE FROM admin_auth_challenges WHERE expires_at<=NOW() LIMIT 100');
    await clearChallenge(req, res);
    const token = crypto.randomBytes(32).toString('hex');
    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = await bcrypt.hash(code, 10);
    const session = purpose === 'reauth' ? await storeSession(req) : null;
    await query(req.db, `INSERT INTO admin_auth_challenges (token_hash,user_id,purpose,session_hash,code_hash,expires_at)
      VALUES (?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 10 MINUTE))`, [hash(token), user.id, purpose, session?.token_hash || null, codeHash]);
    try { await sendCode(user.email, user.name, code); }
    catch (_) {
      await query(req.db, 'DELETE FROM admin_auth_challenges WHERE token_hash=?', [hash(token)]);
      return res.status(503).json({ message: 'Unable to send your admin security code. Please try again.' });
    }
    if (purpose === 'login') await revokeSession(req, res);
    res.cookie(COOKIE, token, cookieOptions(req));
    await securityEvent(req, 'admin_verification_requested', user, purpose);
    return res.json({ requires_two_factor: true, requires_admin_verification: true, email: user.email, message: 'Enter the security code sent to your admin email.' });
  }

  async function consumeChallenge(req, purpose) {
    const tokenHash = challengeHash(req);
    const code = String(req.body?.code || '');
    if (!tokenHash || !/^\d{6}$/.test(code)) return null;
    await ensureChallenges(req.db);
    const session = purpose === 'reauth' ? await storeSession(req) : null;
    const claimed = await query(req.db, `UPDATE admin_auth_challenges SET attempts=attempts+1
      WHERE token_hash=? AND purpose=? AND expires_at>NOW() AND attempts<5
      AND (purpose='login' OR session_hash=?)`, [tokenHash, purpose, session?.token_hash || '']);
    if (!claimed.affectedRows) return null;
    const rows = await query(req.db, `SELECT c.*, u.name,u.email,u.role FROM admin_auth_challenges c
      JOIN users u ON u.id=c.user_id WHERE c.token_hash=? AND LOWER(u.role)='admin' AND c.expires_at>NOW()`, [tokenHash]);
    const challenge = rows[0];
    if (!challenge || !await bcrypt.compare(code, challenge.code_hash)) return null;
    // A conditional delete makes the code single-use, including concurrent submissions.
    const result = await query(req.db, 'DELETE FROM admin_auth_challenges WHERE token_hash=? AND expires_at>NOW()', [tokenHash]);
    return result.affectedRows ? { id: challenge.user_id, name: challenge.name, email: challenge.email, role: 'admin' } : null;
  }

  router.post('/admin/verify-login', sameOrigin, loginProtection, async (req, res) => {
    try {
      const user = await consumeChallenge(req, 'login');
      if (!user) {
        await securityEvent(req, 'admin_verification_failed', null, 'Invalid, expired or exhausted challenge');
        return res.status(400).json({ message: 'Invalid or expired security code. After 5 attempts, sign in again.' });
      }
      res.clearCookie(COOKIE, { ...cookieOptions(req), maxAge: undefined });
      await issueSession(req, res, user, { adminVerified: true });
      await successfulLogin(req, user);
      Promise.resolve().then(() => notifyLogin(user, req.ip)).catch(() => console.error('Unable to send admin sign-in notice.'));
      res.json({ user: safeUser(user), message: 'Admin sign-in verified.' });
    } catch (_) { res.status(503).json({ message: 'Unable to verify sign-in. Please try again.' }); }
  });

  router.get('/session', requireAdminOrStaff, async (req, res) => {
    const session = await storeSession(req);
    res.json({ user: req.actorUser, remaining_seconds: session.remaining_seconds, admin_verification_required: req.actorUser.role === 'admin' });
  });
  router.post('/session/activity', requireAdminOrStaff, async (req, res) => {
    // Only the activity endpoint or explicit user actions extend the idle deadline.
    res.json({ message: 'Session active.' });
  });
  router.post('/admin/reauth/start', requireAdmin, loginProtection, async (req, res) => {
    try {
      const rows = await query(req.db, 'SELECT password FROM users WHERE id=?', [req.actorUser.id]);
      if (!rows.length || !await passwordMatches(req.body?.password, rows[0].password)) {
        await require('./authSecurity').failedLogin(req);
        return res.status(400).json({ message: 'Unable to confirm your credentials.' });
      }
      await beginChallenge(req, res, req.actorUser, 'reauth');
    } catch (_) { res.status(503).json({ message: 'Unable to confirm your identity. Please try again.' }); }
  });
  router.post('/admin/reauth/verify', requireAdmin, async (req, res) => {
    try {
      const user = await consumeChallenge(req, 'reauth');
      if (!user) {
        await securityEvent(req, 'admin_reauthentication_failed', req.actorUser, 'Invalid challenge');
        return res.status(400).json({ message: 'Invalid or expired security code. Start again after 5 attempts.' });
      }
      const session = await storeSession(req);
      await query(req.db, 'UPDATE delivery_chat_sessions SET reauth_at=NOW() WHERE token_hash=?', [session.token_hash]);
      await securityEvent(req, 'admin_reauthenticated', user, 'Sensitive action verification');
      res.clearCookie(COOKIE, { ...cookieOptions(req), maxAge: undefined });
      res.json({ message: 'Identity confirmed.' });
    } catch (_) { res.status(503).json({ message: 'Unable to confirm your identity.' }); }
  });
  router.post('/admin/sessions/revoke', requireAdmin, requireRecentAdmin, async (req, res) => {
    try {
      const session = await storeSession(req);
      await query(req.db, 'DELETE FROM delivery_chat_sessions WHERE user_id=? AND token_hash<>?', [req.actorUser.id, session.token_hash]);
      await securityEvent(req, 'admin_sessions_revoked', req.actorUser, 'Other sessions signed out');
      Promise.resolve().then(() => notifySecurity(req.actorUser, req.ip, 'Other admin sessions were signed out')).catch(() => console.error('Unable to send admin security notice.'));
      res.json({ message: 'Other sessions have been signed out.' });
    } catch (_) { res.status(503).json({ message: 'Unable to sign out other sessions.' }); }
  });
  router.post('/admin/password', requireAdmin, requireRecentAdmin, async (req, res) => {
    const password = String(req.body?.password || '');
    if (!isValidPassword(password) || Buffer.byteLength(password) > 72) return res.status(400).json({ message: 'Use at least 8 characters with an uppercase letter, number, and symbol. Maximum 72 bytes.' });
    try {
      await ensureChallenges(req.db);
      await query(req.db, `UPDATE users u LEFT JOIN delivery_chat_sessions s ON s.user_id=u.id
        LEFT JOIN admin_auth_challenges c ON c.user_id=u.id
        SET u.password=?, s.expires_at=NOW(), c.expires_at=NOW()
        WHERE u.id=? AND u.role='admin'`, [await bcrypt.hash(password, 10), req.actorUser.id]);
      await issueSession(req, res, req.actorUser, { adminVerified: true });
      await securityEvent(req, 'admin_password_changed', req.actorUser, 'All previous sessions revoked');
      Promise.resolve().then(() => notifySecurity(req.actorUser, req.ip, 'Your admin password was changed')).catch(() => console.error('Unable to send admin security notice.'));
      res.json({ message: 'Password updated. Other sessions have been signed out.' });
    } catch (_) { res.status(503).json({ message: 'Unable to update your password.' }); }
  });
  return { router, startLogin: (req, res, user) => beginChallenge(req, res, user, 'login'), clearChallenge };
};
module.exports.ensureChallenges = ensureChallenges;

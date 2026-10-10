const express = require('express');
const bcrypt = require('bcrypt');
const { requireRole } = require('./roleGuard');
const { query, issueSession } = require('./chatSession');
const { securityEvent } = require('./authSecurity');

const router = express.Router();
router.use(requireRole(['staff']));

router.put('/profile', async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 255) return res.status(400).json({ message: 'Enter a name of up to 255 characters.' });
  try {
    await query(req.db, "UPDATE users SET name=? WHERE id=? AND LOWER(role)='staff'", [name, req.actorUser.id]);
    const user = { ...req.actorUser, name };
    await securityEvent(req, 'staff_profile_updated', user, 'Staff updated their own display name');
    res.json({ user, message: 'Account details updated.' });
  } catch (_) { res.status(503).json({ message: 'Unable to update your account. Please try again.' }); }
});

router.put('/password', require('./authSecurity').loginProtection, async (req, res) => {
  const password = String(req.body.password || '');
  if (!/^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/.test(password) || Buffer.byteLength(password) > 72) {
    return res.status(400).json({ message: 'Use 8 or more characters with an uppercase letter, number, and symbol. Maximum 72 bytes.' });
  }
  try {
    const rows = await query(req.db, "SELECT password FROM users WHERE id=? AND LOWER(role)='staff'", [req.actorUser.id]);
    if (!rows.length || !await bcrypt.compare(String(req.body.current_password || ''), rows[0].password)) {
      await require('./authSecurity').failedLogin(req);
      return res.status(400).json({ message: 'Current password is incorrect.' });
    }
    await require('./adminAuth').ensureChallenges(req.db);
    // One conditional write invalidates sessions alongside the password change.
    const result = await query(req.db, `UPDATE users u LEFT JOIN delivery_chat_sessions s ON s.user_id=u.id
      LEFT JOIN admin_auth_challenges c ON c.user_id=u.id
      SET u.password=?, s.expires_at=NOW(), c.expires_at=NOW()
      WHERE u.id=? AND LOWER(u.role)='staff' AND u.password=?`, [await bcrypt.hash(password, 12), req.actorUser.id, rows[0].password]);
    if (!result.affectedRows) return res.status(409).json({ message: 'Account changed. Sign in again before updating your password.' });
    await issueSession(req, res, req.actorUser);
    await securityEvent(req, 'staff_password_changed', req.actorUser, 'Previous staff sessions revoked');
    res.json({ message: 'Password updated. Other sessions have been signed out.' });
  } catch (_) { res.status(503).json({ message: 'Unable to update your password. Please try again.' }); }
});

module.exports = router;

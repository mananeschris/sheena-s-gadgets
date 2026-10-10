const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { query, sameOrigin, ensureSessionTable } = require('./chatSession');
const { logAudit } = require('./auditLogs');
const schemas = new WeakMap();
const states = new WeakMap();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const invalidLink = 'This invitation is invalid or expired. Ask the admin for a new invitation.';

function ensureStateSchema(db) {
  if (!states.has(db)) states.set(db, (async () => {
    const columns = await query(db, "SHOW COLUMNS FROM users LIKE 'account_status'");
    if (!columns.length) {
      try { await query(db, "ALTER TABLE users ADD COLUMN account_status VARCHAR(30) NOT NULL DEFAULT 'active'"); }
      catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
    }
  })().catch(error => { states.delete(db); throw error; }));
  return states.get(db);
}
function ensureSchema(db) {
  if (!schemas.has(db)) schemas.set(db, (async () => {
    await ensureStateSchema(db);
    await query(db, `CREATE TABLE IF NOT EXISTS employee_invitations (
      user_id INT PRIMARY KEY, token_hash CHAR(64) NULL UNIQUE, expires_at DATETIME NULL,
      last_sent_at DATETIME NULL, window_started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sends INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB`);
  })().catch(error => { schemas.delete(db); throw error; }));
  return schemas.get(db);
}
function mailSettings() {
  const provider = String(process.env.EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : 'resend')).trim().toLowerCase();
  if (provider === 'brevo' && process.env.BREVO_API_KEY) return provider;
  if (provider === 'resend' && process.env.RESEND_API_KEY) return provider;
  throw Object.assign(new Error('Activation email delivery is not configured.'), { status: 503 });
}
function baseUrl() {
  const base = new URL(process.env.APP_BASE_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000'));
  if (!['http:', 'https:'].includes(base.protocol) || (process.env.NODE_ENV === 'production' && base.protocol !== 'https:')) throw new Error('Invalid APP_BASE_URL');
  return base;
}
async function sendInvitation(user, url) {
  const provider = mailSettings();
  const subject = `Activate your Sheena's Gadgets ${user.role} account`;
  const text = `Hi ${user.name},\n\nYou have been invited as ${user.role} at Sheena's Gadgets & Accessories Shop. Verify your email and set your password using this link:\n${url}\n\nThis invitation expires in 24 hours and can only be used once. If you were not expecting it, ignore this email.`;
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#171717"><h2>${escape(subject)}</h2><p>Hi ${escape(user.name)},</p><p>Verify your email and choose your own password.</p><p><a href="${escape(url)}" style="display:inline-block;background:#171717;color:white;padding:12px 20px;text-decoration:none">Activate Account</a></p><p>This invitation expires in 24 hours and can only be used once. If you were not expecting it, ignore this email.</p></div>`;
  const response = await fetch(provider === 'brevo' ? 'https://api.brevo.com/v3/smtp/email' : 'https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: provider === 'brevo' ? { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json' } : { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(provider === 'brevo' ? {
      sender: { name: process.env.EMAIL_FROM_NAME || "Sheena's Gadgets & Accessories Shop", email: process.env.EMAIL_FROM_ADDRESS },
      to: [{ email: user.email, name: user.name }], subject, textContent: text, htmlContent: html
    } : { from: process.env.EMAIL_FROM || "Sheena's Gadgets <onboarding@resend.dev>", to: user.email, subject, text, html })
  });
  if (!response.ok) throw new Error('Activation email delivery failed.');
}
async function invite(req, user) {
  mailSettings();
  const url = new URL('/activate-account.html', baseUrl());
  await ensureSchema(req.db);
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hash(token);
  // Claim cooldown and hourly allowance atomically; only the winning token is mailed.
  await query(req.db, `INSERT INTO employee_invitations (user_id,token_hash,expires_at,last_sent_at,sends)
    VALUES (?,?,DATE_ADD(NOW(),INTERVAL 24 HOUR),NOW(),1) ON DUPLICATE KEY UPDATE
    token_hash=IF((last_sent_at IS NULL OR last_sent_at<=DATE_SUB(NOW(),INTERVAL 60 SECOND)) AND (window_started_at<=DATE_SUB(NOW(),INTERVAL 1 HOUR) OR sends<5),VALUES(token_hash),token_hash),
    expires_at=IF(token_hash=VALUES(token_hash),VALUES(expires_at),expires_at),
    last_sent_at=IF(token_hash=VALUES(token_hash),NOW(),last_sent_at),
    sends=IF(token_hash=VALUES(token_hash),IF(window_started_at<=DATE_SUB(NOW(),INTERVAL 1 HOUR),1,sends+1),sends),
    window_started_at=IF(token_hash=VALUES(token_hash) AND window_started_at<=DATE_SUB(NOW(),INTERVAL 1 HOUR),NOW(),window_started_at)`, [user.id,tokenHash]);
  const claimed = await query(req.db, 'SELECT user_id FROM employee_invitations WHERE user_id=? AND token_hash=?', [user.id,tokenHash]);
  if (!claimed.length) throw Object.assign(new Error('Please wait 60 seconds between invitations. Maximum 5 invitations per hour.'), { status: 429 });
  url.hash = `token=${token}`;
  try { await sendInvitation(user, url.toString()); }
  catch (_) {
    await query(req.db, 'UPDATE employee_invitations SET token_hash=NULL,expires_at=NULL WHERE user_id=? AND token_hash=?', [user.id,tokenHash]);
    throw Object.assign(new Error('Invitation email could not be sent. Account remains pending; retry Resend Invitation in 60 seconds.'), { status: 503 });
  }
  logAudit(req.db, { actor_id: req.actorUser.id, actor_name: req.actorUser.name, actor_role: 'admin', action: 'send_account_invitation', entity_type: user.role, entity_id: user.id, details: 'Activation invitation sent' });
}
function create(role) {
  return async (req,res) => {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    if (!name || name.length > 255 || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (role === 'rider' && (!phone || phone.length > 50))) return res.status(400).json({ message: role === 'rider' ? 'Enter a name, valid email, and contact number.' : 'Enter a name and valid email.' });
    try {
      mailSettings(); baseUrl();
      await ensureSchema(req.db);
      const existing = await query(req.db, 'SELECT id FROM users WHERE LOWER(TRIM(email))=?', [email]);
      if (existing.length) return res.status(409).json({ message: 'Email already exists. Use Resend Invitation for a pending account.' });
      const result = await query(req.db, `INSERT INTO users (name,email,password,role,phone,account_status,email_verified)
        VALUES (?,?,?,?,?,'pending_activation',0)`, [name,email,await bcrypt.hash(crypto.randomBytes(48).toString('hex'),12),role,role === 'rider' ? phone : null]);
      const user = { id: result.insertId,name,email,role,phone: role === 'rider' ? phone : null,account_status: 'pending_activation' };
      logAudit(req.db, { actor_id: req.actorUser.id, actor_name: req.actorUser.name, actor_role: 'admin', action: `create_${role}`, entity_type: role, entity_id: user.id, details: `${name} | Pending activation` });
      try { await invite(req,user); res.status(201).json({ message: 'Invitation sent. Account is pending activation.', [role]: user, email_sent: true }); }
      catch (error) { res.status(201).json({ message: error.message, [role]: user, email_sent: false }); }
    } catch (error) { res.status(error.code === 'ER_DUP_ENTRY' ? 409 : error.status || 503).json({ message: error.code === 'ER_DUP_ENTRY' ? 'Email already exists.' : 'Unable to create invitation. Check email delivery configuration and try again.' }); }
  };
}
function resend(role) {
  return async (req,res) => {
    try {
      await ensureSchema(req.db);
      const rows = await query(req.db, "SELECT id,name,email,role FROM users WHERE id=? AND role=? AND account_status='pending_activation'", [req.params.id,role]);
      if (!rows.length) return res.status(400).json({ message: 'Only pending accounts can receive an activation invitation.' });
      await invite(req,rows[0]); res.json({ message: 'A new invitation has been sent. Previous links are no longer valid.' });
    } catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : 'Unable to send invitation. Please try again.' }); }
  };
}
function status(role) {
  return async (req,res) => {
    if (!['enabled','disabled'].includes(req.body.status)) return res.status(400).json({ message: 'Invalid account status.' });
    try {
      await ensureSchema(req.db); await ensureSessionTable(req.db);
      if (role === 'rider' && req.body.status === 'disabled') {
        await require('./riders').ensureDeliveryAssignmentsTable(req.db);
        const active = await query(req.db, "SELECT id FROM delivery_assignments WHERE rider_id=? AND status IN ('assigned','picked_up','out_for_delivery','failed_attempt') LIMIT 1", [req.params.id]);
        if (active.length) return res.status(400).json({ message: 'Reassign or close active deliveries before disabling this rider.' });
      }
      const disabled = req.body.status === 'disabled';
      const deliveryGuard = role === 'rider' && disabled ? " AND NOT EXISTS (SELECT 1 FROM delivery_assignments da WHERE da.rider_id=u.id AND da.status IN ('assigned','picked_up','out_for_delivery','failed_attempt'))" : '';
      const result = await query(req.db, `UPDATE users u LEFT JOIN delivery_chat_sessions s ON s.user_id=u.id
        LEFT JOIN employee_invitations i ON i.user_id=u.id
        SET u.account_status=IF(?, 'disabled', IF(u.email_verified=1,'active','pending_activation')),
          s.expires_at=NOW(),i.token_hash=NULL,i.expires_at=NULL WHERE u.id=? AND u.role=?${deliveryGuard}`, [disabled,req.params.id,role]);
      if (!result.affectedRows) return res.status(404).json({ message: 'Account not found.' });
      logAudit(req.db, { actor_id: req.actorUser.id, actor_name: req.actorUser.name, actor_role: 'admin', action: disabled ? 'disable_account' : 'enable_account', entity_type: role, entity_id: req.params.id, details: 'Previous sessions and invitations revoked' });
      res.json({ message: disabled ? 'Account disabled.' : 'Account enabled. Unverified accounts need a new invitation.' });
    } catch (_) { res.status(503).json({ message: 'Unable to update account status.' }); }
  };
}
const router = express.Router();
router.use(sameOrigin, require('./authSecurity').loginProtection, (req,res,next) => { res.set('Cache-Control','no-store'); next(); });
async function owner(req) {
  await ensureSchema(req.db);
  const token = String(req.body.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const rows = await query(req.db, `SELECT u.id,u.name,u.email,u.role FROM users u JOIN employee_invitations i ON i.user_id=u.id
    WHERE i.token_hash=? AND i.expires_at>NOW() AND u.account_status='pending_activation' AND u.role IN ('staff','rider')`, [hash(token)]);
  return rows[0];
}
router.post('/inspect', async (req,res) => {
  try { const user = await owner(req); if (!user) return res.status(400).json({ message: invalidLink }); res.json({ user }); }
  catch (_) { res.status(503).json({ message: 'Unable to check invitation. Please try again.' }); }
});
router.post('/activate', async (req,res) => {
  const password = String(req.body.password || '');
  if (Buffer.byteLength(password)>72 || !/^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/.test(password)) return res.status(400).json({ message: 'Use 8 or more characters with an uppercase letter, number, and symbol. Maximum 72 bytes.' });
  try {
    const user = await owner(req);
    if (!user) return res.status(400).json({ message: invalidLink });
    await ensureSessionTable(req.db);
    const result = await query(req.db, `UPDATE users u JOIN employee_invitations i ON i.user_id=u.id
      LEFT JOIN delivery_chat_sessions s ON s.user_id=u.id
      SET u.password=?,u.account_status='active',u.email_verified=1,u.email_verified_at=NOW(),i.token_hash=NULL,i.expires_at=NULL,s.expires_at=NOW()
      WHERE i.token_hash=? AND i.expires_at>NOW() AND u.account_status='pending_activation' AND u.role IN ('staff','rider')`, [await bcrypt.hash(password,12),hash(req.body.token)]);
    if (!result.affectedRows) return res.status(400).json({ message: invalidLink });
    await require('./authSecurity').securityEvent(req,'employee_account_activated',user,'Email ownership verified; password set');
    res.json({ message: 'Account activated. Sign in with your email and new password.' });
  } catch (_) { res.status(503).json({ message: 'Unable to activate account. Please try again.' }); }
});
module.exports = { ensureStateSchema,ensureSchema,create,resend,status,router };

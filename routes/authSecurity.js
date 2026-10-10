const crypto = require('crypto');
const { query } = require('./chatSession');
const schemas = new WeakMap();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function ensureLimits(db) {
  if (!schemas.has(db)) schemas.set(db, query(db, `CREATE TABLE IF NOT EXISTS auth_login_limits (
    bucket CHAR(64) PRIMARY KEY, attempts INT NOT NULL, expires_at DATETIME NOT NULL,
    INDEX idx_auth_limit_expiry (expires_at)
  ) ENGINE=InnoDB`).catch(error => { schemas.delete(db); throw error; }));
  return schemas.get(db);
}
async function securityEvent(req, action, user = null, reason = '') {
  const payload = {
    actor_id: user?.id || null, actor_name: user?.name || 'System', actor_role: user?.role || 'system',
    action, entity_type: 'account_security', entity_id: user?.id || null,
    details: JSON.stringify({ ip: req.ip, reason })
  };
  await new Promise(resolve => require('./auditLogs').logAudit(req.db, payload, error => {
    if (error) console.error('Unable to record account security event.');
    resolve();
  }));
}
async function bump(db, bucket) {
  await query(db, `INSERT INTO auth_login_limits VALUES (?,1,DATE_ADD(NOW(),INTERVAL 15 MINUTE))
    ON DUPLICATE KEY UPDATE attempts=IF(expires_at<=NOW(),1,attempts+1),
    expires_at=IF(expires_at<=NOW(),VALUES(expires_at),expires_at)`, [bucket]);
}
const failureBucket = req => hash(`failure:${req.ip}:${String(req.actorUser?.email || req.body?.email || '').trim().toLowerCase()}`);

async function loginProtection(req, res, next) {
  try {
    await ensureLimits(req.db);
    await query(req.db, 'DELETE FROM auth_login_limits WHERE expires_at<=NOW() LIMIT 100');
    const ipBucket = hash(`requests:${req.ip}`);
    await bump(req.db, ipBucket);
    const limits = await query(req.db, 'SELECT bucket,attempts FROM auth_login_limits WHERE bucket IN (?,?) AND expires_at>NOW()', [ipBucket, failureBucket(req)]);
    if (limits.some(row => row.attempts >= (row.bucket === ipBucket ? 51 : 5))) {
      res.set('Retry-After', '900');
      if (limits.some(row => row.bucket === ipBucket && row.attempts === 51)) await securityEvent(req, 'login_rate_limited', null, 'Temporary login cooldown');
      return res.status(429).json({ message: 'Too many sign-in attempts. Please try again in 15 minutes.' });
    }
    next();
  } catch (_) { res.status(503).json({ message: 'Sign-in is temporarily unavailable. Please try again.' }); }
}
async function failedLogin(req) {
  await bump(req.db, failureBucket(req));
  await securityEvent(req, 'login_failed', null, 'Incorrect credentials');
}
async function successfulLogin(req, user) {
  await query(req.db, 'DELETE FROM auth_login_limits WHERE bucket=?', [failureBucket(req)]);
  await securityEvent(req, 'login_success', user, 'Signed in');
}

async function claimAdminEmail(req, user) {
  await ensureLimits(req.db);
  const bucket = hash(`admin-email:${user.id}`);
  await bump(req.db, bucket);
  const rows = await query(req.db, 'SELECT attempts FROM auth_login_limits WHERE bucket=? AND expires_at>NOW()', [bucket]);
  return rows.length === 1 && rows[0].attempts <= 12;
}

module.exports = { loginProtection, failedLogin, successfulLogin, securityEvent, claimAdminEmail };

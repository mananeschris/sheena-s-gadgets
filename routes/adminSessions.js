const { query, ensureSessionTable } = require('./chatSession');
const crypto = require('crypto');
const schemas = new WeakMap();
const IDLE_SECONDS = 15 * 60;
const MAX_SECONDS = 8 * 60 * 60;

function sessionHash(req) {
  const cookie = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('delivery_session='));
  const token = cookie?.slice('delivery_session='.length) || '';
  return /^[a-f0-9]{64}$/.test(token) ? crypto.createHash('sha256').update(token).digest('hex') : null;
}

function ensureStoreSessionSchema(db) {
  if (!schemas.has(db)) schemas.set(db, (async () => {
    await ensureSessionTable(db);
    await require('./employeeAccounts').ensureStateSchema(db);
    for (const name of ['created_at', 'last_activity_at', 'admin_verified_at', 'reauth_at']) {
      const columns = await query(db, 'SHOW COLUMNS FROM delivery_chat_sessions LIKE ?', [name]);
      if (!columns.length) {
        try { await query(db, `ALTER TABLE delivery_chat_sessions ADD COLUMN ${name} DATETIME NULL`); }
        catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; }
      }
    }
  })().catch(error => { schemas.delete(db); throw error; }));
  return schemas.get(db);
}

async function storeSession(req) {
  if (req.storeSession) return req.storeSession;
  const hash = sessionHash(req);
  if (!hash) return null;
  await ensureStoreSessionSchema(req.db);
  const rows = await query(req.db, `SELECT u.id, u.name, u.email, LOWER(u.role) AS role,
    s.token_hash, s.reauth_at, s.last_activity_at, s.created_at,
    LEAST(TIMESTAMPDIFF(SECOND,NOW(),s.expires_at),
      ?-TIMESTAMPDIFF(SECOND,s.last_activity_at,NOW()),
      ?-TIMESTAMPDIFF(SECOND,s.created_at,NOW())) AS remaining_seconds
    FROM delivery_chat_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>NOW()
    AND (LOWER(u.role) NOT IN ('staff','rider') OR u.account_status='active')
    AND (LOWER(u.role)<>'admin' OR (s.admin_verified_at IS NOT NULL
      AND s.last_activity_at>DATE_SUB(NOW(),INTERVAL ? SECOND)
      AND s.created_at>DATE_SUB(NOW(),INTERVAL ? SECOND))) LIMIT 1`,
  [IDLE_SECONDS, MAX_SECONDS, hash, IDLE_SECONDS, MAX_SECONDS]);
  req.storeSession = rows[0] || null;
  return req.storeSession;
}

async function requireRecentAdmin(req, res, next) {
  if (req.actorUser?.role !== 'admin') return res.status(403).json({ message: 'Admin account required.' });
  try {
    const session = await storeSession(req);
    if (!session) return res.status(401).json({ message: 'Your session has expired. Sign in again.' });
    const rows = await query(req.db, `SELECT token_hash FROM delivery_chat_sessions
      WHERE token_hash=? AND reauth_at>DATE_SUB(NOW(),INTERVAL 5 MINUTE)`, [session.token_hash]);
    if (!rows.length) return res.status(428).json({ requires_reauthentication: true, message: 'Confirm your identity before continuing.' });
    next();
  } catch (_) { res.status(503).json({ message: 'Unable to verify your session. Please try again.' }); }
}

module.exports = { sessionHash, ensureStoreSessionSchema, storeSession, requireRecentAdmin, IDLE_SECONDS, MAX_SECONDS };

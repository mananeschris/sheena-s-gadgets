const crypto = require("crypto");

const COOKIE = "delivery_session";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const schemaPromises = new WeakMap();
const query = (db, sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));

function ensureSessionTable(db) {
  if (!schemaPromises.has(db)) {
    const promise = query(db, `CREATE TABLE IF NOT EXISTS delivery_chat_sessions (
      token_hash CHAR(64) PRIMARY KEY, user_id INT NOT NULL, expires_at DATETIME NOT NULL,
      INDEX idx_chat_session_user (user_id), INDEX idx_chat_session_expiry (expires_at)
    )`).catch(error => { schemaPromises.delete(db); throw error; });
    schemaPromises.set(db, promise);
  }
  return schemaPromises.get(db);
}

function tokenFromRequest(req) {
  const value = String(req.headers.cookie || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`));
  const token = value?.slice(COOKIE.length + 1) || "";
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
const tokenHash = token => crypto.createHash("sha256").update(token).digest("hex");
const cookieOptions = req => ({ httpOnly: true, sameSite: "strict", secure: req.secure || process.env.NODE_ENV === "production", path: "/", maxAge: MAX_AGE });

async function revokeSession(req, res) {
  const token = tokenFromRequest(req);
  if (token) {
    await ensureSessionTable(req.db);
    await query(req.db, "DELETE FROM delivery_chat_sessions WHERE token_hash=?", [tokenHash(token)]);
  }
  res.clearCookie(COOKIE, { ...cookieOptions(req), maxAge: undefined });
}

async function issueSession(req, res, user, options = {}) {
  await ensureSessionTable(req.db);
  const admin = String(user.role).toLowerCase() === 'admin';
  if (admin && !options.adminVerified) throw new Error('Admin verification required.');
  if (admin) await require('./adminSessions').ensureStoreSessionSchema(req.db);
  await revokeSession(req, res);
  const token = crypto.randomBytes(32).toString("hex");
  const age = admin ? 8 * 60 * 60 * 1000 : MAX_AGE;
  if (admin) {
    await query(req.db, `INSERT INTO delivery_chat_sessions
      (token_hash,user_id,expires_at,created_at,last_activity_at,admin_verified_at,reauth_at)
      VALUES (?,?,?,NOW(),NOW(),NOW(),NOW())`, [tokenHash(token), user.id, new Date(Date.now() + age)]);
  } else {
    await query(req.db, "INSERT INTO delivery_chat_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [tokenHash(token), user.id, new Date(Date.now() + age)]);
  }
  res.cookie(COOKIE, token, { ...cookieOptions(req), maxAge: age });
}

function sameOrigin(req, res, next) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ message: 'Invalid request origin.' });
  if (!["GET", "HEAD"].includes(req.method) && req.headers.origin) {
    try {
      if (new URL(req.headers.origin).host !== req.get("host")) return res.status(403).json({ message: "Invalid request origin." });
    } catch { return res.status(403).json({ message: "Invalid request origin." }); }
  }
  next();
}

async function requireChatUser(req, res, next) {
  const token = tokenFromRequest(req);
  if (!token) return res.status(401).json({ message: "Sign in again to use delivery messages." });
  try {
    await ensureSessionTable(req.db);
    await require('./employeeAccounts').ensureStateSchema(req.db);
    const rows = await query(req.db, `SELECT u.id, u.name, u.role FROM delivery_chat_sessions s
      JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW()
      AND (LOWER(u.role) NOT IN ('staff','rider') OR u.account_status='active') LIMIT 1`, [tokenHash(token)]);
    const user = rows[0];
    if (!user) return res.status(401).json({ message: "Your messaging session has expired. Sign in again." });
    if (!["customer", "rider"].includes(user.role)) return res.status(403).json({ message: "Delivery messages are for customers and riders." });
    if (String(req.headers["x-chat-user"] || "") !== String(user.id)) return res.status(401).json({ message: "Account changed. Sign in again to use messages." });
    req.chatUser = user;
    res.set("Cache-Control", "no-store");
    next();
  } catch { res.status(500).json({ message: "Unable to verify your messaging session." }); }
}

function requireAccountSession(role) {
  return (req, res, next) => require('./roleGuard').requireRole([role])(req, res, next);
}

module.exports = { query, ensureSessionTable, issueSession, revokeSession, requireChatUser, sameOrigin, requireAccountSession };

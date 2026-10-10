const crypto = require('node:crypto');
const tokenFor = id => Number(id).toString(16).padStart(64, '0');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const cookieFor = id => `delivery_session=${tokenFor(id)}`;

function withSessions(db, users) {
  const original = db.query.bind(db);
  db.query = (sql, params, callback) => {
    if (typeof params === 'function') { callback = params; params = []; }
    if (/CREATE TABLE IF NOT EXISTS delivery_chat_sessions|SHOW COLUMNS FROM delivery_chat_sessions|ALTER TABLE delivery_chat_sessions/.test(sql)) return callback(null, [{ Field: 'existing' }]);
    if (sql === "SHOW COLUMNS FROM users LIKE 'account_status'") return callback(null, [{ Field: 'account_status' }]);
    if (sql.includes('FROM delivery_chat_sessions s')) {
      const user = users.find(user => hash(tokenFor(user.id)) === params[2]);
      return callback(null, user ? [{ ...user, token_hash: params[2], remaining_seconds: 900, reauth_at: new Date(), last_activity_at: new Date(), created_at: new Date() }] : []);
    }
    if (sql.startsWith('UPDATE delivery_chat_sessions SET last_activity_at')) return callback(null, { affectedRows: 1 });
    if (sql.includes('SELECT token_hash FROM delivery_chat_sessions')) return callback(null, [{ token_hash: params[0] }]);
    return original(sql, params, callback);
  };
  return db;
}
module.exports = { cookieFor, withSessions };

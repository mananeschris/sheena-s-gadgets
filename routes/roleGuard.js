const { storeSession } = require('./adminSessions');
const { sameOrigin, query } = require('./chatSession');

function actorIdFromRequest(req) {
  const rawId = req.body?.actor_id || req.query?.actor_id || req.headers["x-actor-id"];
  const id = Number(rawId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function actorPayloadFromUser(user) {
  return {
    actor_id: user.id,
    actor_name: user.name || user.email || "Store user",
    actor_role: String(user.role || "").toLowerCase()
  };
}

function requireRole(allowedRoles) {
  const allowed = allowedRoles.map(role => String(role).toLowerCase());

  return function roleGuard(req, res, next) {
    sameOrigin(req, res, async () => {
      try {
        const user = await storeSession(req);
        if (!user) return res.status(401).json({ message: 'Your session has expired. Sign in again.' });
        if (!allowed.includes(user.role)) return res.status(403).json({ message: 'You do not have permission to do this action.' });
        const supplied = [req.body?.actor_id, req.query?.actor_id, req.headers['x-actor-id']].filter(value => value !== undefined && value !== null);
        if (supplied.some(value => Number(value) !== Number(user.id))) return res.status(401).json({ message: 'Account changed. Sign in again.' });
        req.actorUser = { id: user.id, name: user.name, email: user.email, role: user.role };
        if (user.role === 'admin' && !['GET', 'HEAD'].includes(req.method)) {
          await query(req.db, 'UPDATE delivery_chat_sessions SET last_activity_at=NOW() WHERE token_hash=?', [user.token_hash]);
        }
        res.set('Cache-Control', 'no-store');
        next();
      } catch (_) { res.status(503).json({ message: 'Unable to verify your session. Please try again.' }); }
    });
  };
}

function verifiedActor(req, fallback = {}) {
  if (req.actorUser) return actorPayloadFromUser(req.actorUser);
  return {
    actor_id: req.body?.actor_id || req.query?.actor_id || fallback.actor_id || null,
    actor_name: req.body?.actor_name || req.query?.actor_name || fallback.actor_name || "Store user",
    actor_role: req.body?.actor_role || req.query?.actor_role || fallback.actor_role || "system"
  };
}

module.exports = {
  actorIdFromRequest,
  actorPayloadFromUser,
  requireAdmin: requireRole(["admin"]),
  requireAdminOrStaff: requireRole(["admin", "staff"]),
  requireRider: requireRole(["rider"]),
  requireAdminOrRider: requireRole(["admin", "rider"]),
  requireRole,
  verifiedActor
};

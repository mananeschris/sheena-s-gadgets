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
    const actorId = actorIdFromRequest(req);
    if (!actorId) {
      return res.status(403).json({ message: "Signed-in store account required." });
    }

    req.db.query(
      "SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1",
      [actorId],
      (err, rows) => {
        if (err) return res.status(500).json({ message: err.message });

        const user = rows[0];
        const role = String(user?.role || "").toLowerCase();
        if (!user || !allowed.includes(role)) {
          return res.status(403).json({ message: "You do not have permission to do this action." });
        }

        req.actorUser = { ...user, role };
        next();
      }
    );
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

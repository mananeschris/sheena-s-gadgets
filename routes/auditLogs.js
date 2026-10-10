const express = require("express");
const router = express.Router();
const { requireAdmin, requireAdminOrStaff, verifiedActor } = require("./roleGuard");

function ensureAuditLogTable(db, callback) {
  const sql = `
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      actor_id INT NULL,
      actor_name VARCHAR(255) NULL,
      actor_role VARCHAR(50) NULL,
      action VARCHAR(120) NOT NULL,
      entity_type VARCHAR(80) NOT NULL,
      entity_id VARCHAR(80) NULL,
      details TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_created (created_at),
      INDEX idx_audit_entity (entity_type, entity_id),
      INDEX idx_audit_action (action)
    )
  `;
  db.query(sql, callback);
}

function auditActor(req) {
  if (req.actorUser) return verifiedActor(req);
  return {
    actor_id: req.body?.actor_id || req.query?.actor_id || null,
    actor_name: req.body?.actor_name || req.query?.actor_name || "System",
    actor_role: req.body?.actor_role || req.query?.actor_role || "system"
  };
}

function logAudit(db, payload, callback = () => {}) {
  ensureAuditLogTable(db, (tableErr) => {
    if (tableErr) return callback(tableErr);
    db.query(
      `INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.actor_id || null,
        payload.actor_name || "System",
        payload.actor_role || "system",
        payload.action,
        payload.entity_type,
        payload.entity_id || null,
        payload.details || null
      ],
      callback
    );
  });
}

router.get("/", requireAdmin, (req, res) => {
  ensureAuditLogTable(req.db, (tableErr) => {
    if (tableErr) return res.status(500).json({ message: tableErr.message });
    req.db.query(
      `SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT 150`,
      (err, rows) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json(rows);
      }
    );
  });
});

router.post("/", requireAdminOrStaff, (req, res) => {
  res.status(405).json({ message: 'Audit entries are created by the server.' });
});

module.exports = router;
module.exports.logAudit = logAudit;
module.exports.auditActor = auditActor;

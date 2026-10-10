const express = require("express");
const router = express.Router();
const { logAudit, auditActor } = require("./auditLogs");
const { requireAdmin, verifiedActor } = require("./roleGuard");
const { requireRecentAdmin } = require('./adminSessions');
const employee = require('./employeeAccounts');

router.get("/", requireAdmin, (req, res) => {
  req.db.query(
    "SELECT id, name, email, role, account_status FROM users WHERE role = 'staff' ORDER BY id DESC",
    (err, rows) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json(rows);
    }
  );
});

router.post('/', requireAdmin, requireRecentAdmin, employee.create('staff'));
router.post('/:id/invitation', requireAdmin, requireRecentAdmin, employee.resend('staff'));
router.put('/:id/status', requireAdmin, requireRecentAdmin, employee.status('staff'));

router.delete("/:id", requireAdmin, requireRecentAdmin, (req, res) => {
  req.db.query("DELETE FROM users WHERE id = ? AND role = 'staff'", [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ message: err.message });
    if (!result.affectedRows) return res.status(404).json({ message: "Staff account not found." });
    const actor = verifiedActor(req, auditActor(req));
    logAudit(req.db, {
      ...actor,
      action: "delete_staff",
      entity_type: "staff",
      entity_id: req.params.id,
      details: `Staff #${req.params.id} deleted`
    });
    res.json({ message: "Staff account deleted." });
  });
});

module.exports = router;

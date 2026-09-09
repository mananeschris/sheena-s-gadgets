const express = require("express");
const bcrypt = require("bcrypt");
const router = express.Router();
const { logAudit, auditActor } = require("./auditLogs");
const { requireAdmin, verifiedActor } = require("./roleGuard");

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanPassword(value) {
  return String(value || "").trim();
}

function isValidPassword(password) {
  return /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/.test(String(password || ""));
}

router.get("/", requireAdmin, (req, res) => {
  req.db.query(
    "SELECT id, name, email, role FROM users WHERE role = 'staff' ORDER BY id DESC",
    (err, rows) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json(rows);
    }
  );
});

router.post("/", requireAdmin, async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = normalizeEmail(req.body.email);
  const password = cleanPassword(req.body.password);

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email, and password are required." });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({ message: "Password must have 8 characters, uppercase letter, number, and special character." });
  }

  req.db.query("SELECT id FROM users WHERE LOWER(TRIM(email)) = ?", [email], async (checkErr, existing) => {
    if (checkErr) return res.status(500).json({ message: checkErr.message });
    if (existing.length) return res.status(400).json({ message: "Email already exists." });

    const hashedPassword = await bcrypt.hash(password, 10);
    req.db.query(
      "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'staff')",
      [name, email, hashedPassword],
      (insertErr, result) => {
        if (insertErr) return res.status(500).json({ message: insertErr.message });
        const actor = verifiedActor(req, auditActor(req));
        logAudit(req.db, {
          ...actor,
          action: "create_staff",
          entity_type: "staff",
          entity_id: result.insertId,
          details: `${name} | ${email}`
        });
        res.json({ message: "Staff account created.", staff: { id: result.insertId, name, email, role: "staff" } });
      }
    );
  });
});

router.delete("/:id", requireAdmin, (req, res) => {
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

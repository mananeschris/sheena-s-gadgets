const express = require("express");
const router = express.Router();
const { logAudit, auditActor } = require("./auditLogs");
const { requireAdmin, verifiedActor } = require("./roleGuard");
router.get("/admin/all", requireAdmin, (req, res) => {
  const sql = `
    SELECT id, code, discount_type, discount_value, min_quantity, min_amount, product_id, is_active
    FROM vouchers
    ORDER BY id DESC
  `;

  req.db.query(sql, (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(rows);
  });
});


router.get("/", (req, res) => {
  const sql = `
    SELECT id, code, discount_type, discount_value, min_quantity, min_amount, product_id, is_active
    FROM vouchers
    WHERE COALESCE(is_active, 1) = 1
    ORDER BY id DESC
  `;

  req.db.query(sql, (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(rows);
  });
});

// 🟢 CREATE VOUCHER (ADMIN)
router.post("/", requireAdmin, (req, res) => {
  const {
    code,
    discount_type,
    discount_value,
    min_quantity,
    min_amount,
    product_id
  } = req.body;

  const sql = `
    INSERT INTO vouchers 
    (code, discount_type, discount_value, min_quantity, min_amount, product_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `;

  req.db.query(
    sql,
    [code, discount_type, discount_value, min_quantity, min_amount, product_id],
    (err, result) => {
      if (err) return res.status(500).json({ message: err.message });

      const actor = verifiedActor(req, auditActor(req));
      logAudit(req.db, {
        ...actor,
        action: "create_voucher",
        entity_type: "voucher",
        entity_id: result.insertId,
        details: `${code} | ${discount_type} ${discount_value}`
      });
      res.json({ message: "Voucher created successfully" });
    }
  );
});


router.put("/:id", requireAdmin, (req, res) => {
  const { is_active } = req.body;
  req.db.query(
    "UPDATE vouchers SET is_active=? WHERE id=?",
    [Number(is_active) ? 1 : 0, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ message: err.message });
      const actor = verifiedActor(req, auditActor(req));
      logAudit(req.db, {
        ...actor,
        action: "update_voucher",
        entity_type: "voucher",
        entity_id: req.params.id,
        details: `Voucher #${req.params.id} active=${Number(is_active) ? 1 : 0}`
      });
      res.json({ message: "Voucher updated" });
    }
  );
});

router.delete("/:id", requireAdmin, (req, res) => {
  req.db.query("DELETE FROM vouchers WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ message: err.message });
    const actor = verifiedActor(req, auditActor(req));
    logAudit(req.db, {
      ...actor,
      action: "delete_voucher",
      entity_type: "voucher",
      entity_id: req.params.id,
      details: `Voucher #${req.params.id} deleted`
    });
    res.json({ message: "Voucher deleted" });
  });
});
module.exports = router;
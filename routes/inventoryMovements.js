const express = require("express");
const router = express.Router();
const { requireAdminOrStaff } = require("./roleGuard");

function ensureInventoryMovementsTable(db, callback) {
  const sql = `
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NULL,
      variant_index INT NULL,
      variant_name VARCHAR(255) NULL,
      order_id INT NULL,
      movement_type VARCHAR(80) NOT NULL,
      quantity_change INT NOT NULL,
      quantity_before INT NULL,
      quantity_after INT NULL,
      actor_id INT NULL,
      actor_name VARCHAR(255) NULL,
      actor_role VARCHAR(50) NULL,
      source VARCHAR(80) NULL,
      note TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_inventory_product (product_id),
      INDEX idx_inventory_order (order_id),
      INDEX idx_inventory_type (movement_type),
      INDEX idx_inventory_created (created_at)
    )
  `;
  db.query(sql, callback);
}

function cleanText(value, max = 255) {
  return String(value || "").trim().slice(0, max) || null;
}

function cleanInteger(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function logInventoryMovement(db, payload, callback = () => {}) {
  const productId = cleanInteger(payload.product_id);
  const quantityChange = cleanInteger(payload.quantity_change, 0);

  if (!productId || !quantityChange) {
    return process.nextTick(() => callback(null, { skipped: true }));
  }

  db.query(
    `INSERT INTO inventory_movements
     (product_id, product_name, variant_index, variant_name, order_id, movement_type, quantity_change,
      quantity_before, quantity_after, actor_id, actor_name, actor_role, source, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      productId,
      cleanText(payload.product_name),
      cleanInteger(payload.variant_index),
      cleanText(payload.variant_name),
      cleanInteger(payload.order_id),
      cleanText(payload.movement_type, 80) || "manual_adjustment",
      quantityChange,
      cleanInteger(payload.quantity_before),
      cleanInteger(payload.quantity_after),
      cleanInteger(payload.actor_id),
      cleanText(payload.actor_name),
      cleanText(payload.actor_role, 50),
      cleanText(payload.source, 80),
      payload.note ? String(payload.note).trim().slice(0, 1000) : null
    ],
    callback
  );
}

function logInventoryMovementAsync(db, payload) {
  return new Promise((resolve, reject) => {
    logInventoryMovement(db, payload, (err, result) => err ? reject(err) : resolve(result));
  });
}

router.get("/", requireAdminOrStaff, (req, res) => {
  ensureInventoryMovementsTable(req.db, (tableErr) => {
    if (tableErr) return res.status(500).json({ message: tableErr.message });

    const limit = Math.min(Math.max(cleanInteger(req.query.limit, 120), 1), 250);
    const productId = cleanInteger(req.query.product_id);
    const type = cleanText(req.query.type, 80);
    const where = [];
    const params = [];

    if (productId) {
      where.push("im.product_id=?");
      params.push(productId);
    }
    if (type && type !== "all") {
      where.push("im.movement_type=?");
      params.push(type);
    }

    params.push(limit);
    req.db.query(
      `SELECT
         im.*,
         COALESCE(im.product_name, p.name) AS display_product_name,
         p.category,
         p.stock AS current_stock
       FROM inventory_movements im
       LEFT JOIN products p ON p.id = im.product_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY im.created_at DESC, im.id DESC
       LIMIT ?`,
      params,
      (err, rows) => {
        if (err) return res.status(500).json({ message: err.message });
        res.json(rows);
      }
    );
  });
});

module.exports = router;
module.exports.ensureInventoryMovementsTable = ensureInventoryMovementsTable;
module.exports.logInventoryMovement = logInventoryMovement;
module.exports.logInventoryMovementAsync = logInventoryMovementAsync;
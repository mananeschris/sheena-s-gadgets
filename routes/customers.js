const express = require("express");
const router = express.Router();
const { requireAdmin } = require("./roleGuard");

router.get("/", requireAdmin, (req, res) => {
  const sql = `
    SELECT
      u.id,
      u.name,
      u.email,
      u.role,
      u.birthday,
      u.phone,
      u.gender,
      u.address,
      u.city,
      u.province,
      u.postal_code,
      COUNT(o.id) AS order_count,
      COALESCE(SUM(o.total_price), 0) AS total_spent,
      MAX(o.created_at) AS last_order_at,
      SUM(CASE WHEN o.status = 'delivered' THEN 1 ELSE 0 END) AS delivered_orders,
      SUM(CASE WHEN o.status = 'pending' THEN 1 ELSE 0 END) AS pending_orders
    FROM users u
    LEFT JOIN orders o ON o.user_id = u.id
    WHERE u.role = 'customer'
    GROUP BY u.id
    ORDER BY last_order_at DESC, u.name ASC
  `;

  req.db.query(sql, (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(rows);
  });
});

module.exports = router;

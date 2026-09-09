const express = require("express");
const router = express.Router();
const { requireAdmin } = require("./roleGuard");

// 📊 ADMIN RECEIVABLES SUMMARY
router.get("/", requireAdmin, (req, res) => {

  const sql = `
    SELECT 
      o.id AS order_id,
      o.product_id,
      o.quantity,
      o.total_price,
      IFNULL(SUM(p.amount_paid), 0) AS total_paid,
      (o.total_price - IFNULL(SUM(p.amount_paid), 0)) AS balance
    FROM orders o
    LEFT JOIN payments p ON o.id = p.order_id
    GROUP BY o.id
  `;

  req.db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ message: err.message });

    let totalReceivables = 0;
    let overdue = 0;

    const today = new Date();

    results.forEach(r => {
      totalReceivables += Number(r.balance);

      // simple overdue logic (mock: if may balance)
      if (r.balance > 0) {
        overdue += Number(r.balance);
      }
    });

    res.json({
      message: "Receivables summary",
      data: {
        total_receivables: totalReceivables,
        overdue_amount: overdue,
        orders: results
      }
    });
  });

});

module.exports = router;
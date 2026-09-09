const express = require("express");
const router = express.Router();
const { requireAdmin } = require("./roleGuard");
const { ensureOrderCoreColumns } = require("./orderSchema");

function ensureInstallmentScheduleTable(db, callback) {
  const sql = `
    CREATE TABLE IF NOT EXISTS installment_schedules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      application_id INT NOT NULL,
      order_id INT NOT NULL,
      user_id INT NOT NULL,
      installment_no INT NOT NULL,
      due_date DATE NOT NULL,
      amount_due DECIMAL(12,2) NOT NULL DEFAULT 0,
      amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'unpaid',
      paid_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_schedule_order (order_id),
      INDEX idx_schedule_user (user_id),
      INDEX idx_schedule_status (status),
      INDEX idx_schedule_due (due_date)
    )
  `;

  db.query(sql, callback);
}

// 📊 ADMIN FINANCE DASHBOARD
router.get("/", requireAdmin, (req, res) => {
  ensureInstallmentScheduleTable(req.db, (tableErr) => {
    if (tableErr) return res.status(500).json({ message: tableErr.message });
    ensureOrderCoreColumns(req.db)
      .then(loadFinance)
      .catch((columnErr) => res.status(500).json({ message: columnErr.message }));
  });

  function loadFinance() {

  const sql = `
    SELECT
      (SELECT COUNT(*) FROM users) AS total_users,
      (SELECT COUNT(*) FROM orders) AS total_orders,
      COALESCE((SELECT SUM(total_price) FROM orders WHERE payment_status = 'paid'), 0) AS paid_sales,
      COALESCE((SELECT SUM(total_price) FROM orders WHERE payment_status = 'pending_verification'), 0) AS pending_online_amount,
      COALESCE((SELECT SUM(total_price) FROM orders WHERE payment_status = 'to_collect'), 0) AS cod_to_collect_amount,
      COALESCE((SELECT SUM(total_price) FROM orders WHERE payment_status = 'installment_active'), 0) AS installment_active_amount,
      COALESCE((SELECT SUM(amount_due - amount_paid) FROM installment_schedules WHERE status != 'paid'), 0) AS installment_unpaid_amount,
      COALESCE((SELECT SUM(amount_due - amount_paid) FROM installment_schedules WHERE status != 'paid' AND due_date < CURDATE()), 0) AS installment_overdue_amount,
      COALESCE((SELECT COUNT(*) FROM installment_schedules WHERE status != 'paid' AND due_date < CURDATE()), 0) AS installment_overdue_count,
      COALESCE((SELECT COUNT(*) FROM installment_schedules WHERE status != 'paid' AND MONTH(due_date)=MONTH(CURDATE()) AND YEAR(due_date)=YEAR(CURDATE())), 0) AS installment_due_this_month,
      COALESCE((SELECT COUNT(*) FROM orders WHERE payment_status = 'payment_setup_failed'), 0) AS gateway_failed_count,
      COALESCE((SELECT SUM(CASE WHEN status != 'paid' THEN balance ELSE 0 END) FROM payments), 0) AS total_receivables,
      COALESCE((SELECT SUM(CASE WHEN due_date < CURDATE() AND status != 'paid' THEN 1 ELSE 0 END) FROM payments), 0) AS overdue_count,
      COALESCE((SELECT SUM(CASE WHEN due_date < CURDATE() AND status != 'paid' THEN balance ELSE 0 END) FROM payments), 0) AS overdue_amount
  `;

  req.db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ message: err.message });

    res.json({
      message: "Admin Finance Dashboard",
      data: result[0]
    });
  });
  }
});

module.exports = router;

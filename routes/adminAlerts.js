const express = require("express");
const router = express.Router();
const { ensureOrderCoreColumns } = require("./orderSchema");
const { orderLabel } = require("./orderReference")

function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function ensureInstallmentScheduleTable(db) {
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

  return runQuery(db, sql);
}

async function ensureOrderAlertColumns(db) {
  await ensureOrderCoreColumns(db);
  const columns = [
    ["cancellation_request_status", "ADD COLUMN cancellation_request_status VARCHAR(30) NULL"],
    ["cancellation_reason", "ADD COLUMN cancellation_reason TEXT NULL"],
    ["cancellation_admin_note", "ADD COLUMN cancellation_admin_note TEXT NULL"],
    ["cancellation_requested_at", "ADD COLUMN cancellation_requested_at DATETIME NULL"],
    ["cancellation_reviewed_at", "ADD COLUMN cancellation_reviewed_at DATETIME NULL"],
    ["repair_request_status", "ADD COLUMN repair_request_status VARCHAR(30) NULL"],
    ["repair_service_status", "ADD COLUMN repair_service_status VARCHAR(40) NULL"],
    ["repair_issue", "ADD COLUMN repair_issue TEXT NULL"],
    ["repair_admin_note", "ADD COLUMN repair_admin_note TEXT NULL"],
    ["repair_requested_at", "ADD COLUMN repair_requested_at DATETIME NULL"],
    ["repair_reviewed_at", "ADD COLUMN repair_reviewed_at DATETIME NULL"],
    ["delivered_at", "ADD COLUMN delivered_at DATETIME NULL"],
    ["warranty_expires_at", "ADD COLUMN warranty_expires_at DATETIME NULL"]
  ];

  for (const [name, alter] of columns) {
    const rows = await runQuery(db, `SHOW COLUMNS FROM orders LIKE '${name}'`);
    if (!rows.length) await runQuery(db, `ALTER TABLE orders ${alter}`);
  }

  await runQuery(db, `
    UPDATE orders
    SET delivered_at = COALESCE(delivered_at, created_at),
        warranty_expires_at = COALESCE(warranty_expires_at, DATE_ADD(COALESCE(delivered_at, created_at), INTERVAL 7 DAY))
    WHERE status = 'delivered'
      AND (delivered_at IS NULL OR warranty_expires_at IS NULL)
  `);
}

router.get("/", async (req, res) => {
  try {
    await ensureInstallmentScheduleTable(req.db);
    await ensureOrderAlertColumns(req.db);

    const [
      summaryRows,
      recentApplications,
      recentOrders,
      cancellationRequests,
      repairRequests,
      overdueSchedules,
      gatewayIssues,
      lowStockProducts,
      outOfStockProducts
    ] = await Promise.all([
      runQuery(req.db, `
        SELECT
          COALESCE((SELECT COUNT(*) FROM orders WHERE status = 'pending'), 0) AS pending_orders,
          COALESCE((SELECT COUNT(*) FROM orders WHERE cancellation_request_status = 'pending'), 0) AS cancellation_requests,
          COALESCE((SELECT COUNT(*) FROM orders WHERE repair_request_status = 'pending'), 0) AS repair_requests,
          COALESCE((SELECT COUNT(*) FROM installment_applications WHERE status = 'pending'), 0) AS pending_installments,
          COALESCE((SELECT COUNT(*) FROM orders WHERE payment_status = 'installment_downpayment_pending'), 0) AS approved_waiting_downpayment,
          COALESCE((SELECT COUNT(*) FROM installment_schedules WHERE status != 'paid' AND due_date < CURDATE()), 0) AS overdue_installments,
          COALESCE((SELECT COUNT(*) FROM orders WHERE payment_status IN ('payment_setup_failed', 'installment_downpayment_failed')), 0) AS gateway_issues,
          COALESCE((SELECT COUNT(*) FROM products WHERE stock > 0 AND stock <= 5), 0) AS low_stock_products,
          COALESCE((SELECT COUNT(*) FROM products WHERE stock <= 0), 0) AS out_of_stock_products
      `),
      runQuery(req.db, `
        SELECT id, full_name, order_id, order_total, created_at
        FROM installment_applications
        WHERE status = 'pending'
        ORDER BY created_at DESC
        LIMIT 5
      `),
      runQuery(req.db, `
        SELECT o.id, u.name AS customer_name, o.total_price, o.payment_method, o.created_at
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.status = 'pending'
        ORDER BY o.created_at DESC
        LIMIT 5
      `),
      runQuery(req.db, `
        SELECT o.id, u.name AS customer_name, o.total_price, o.cancellation_reason, o.cancellation_requested_at
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.cancellation_request_status = 'pending'
        ORDER BY o.cancellation_requested_at DESC
        LIMIT 5
      `),
      runQuery(req.db, `
        SELECT o.id, u.name AS customer_name, o.total_price, o.repair_issue, o.repair_requested_at
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.repair_request_status = 'pending'
        ORDER BY o.repair_requested_at DESC
        LIMIT 5
      `),
      runQuery(req.db, `
        SELECT s.id, s.order_id, s.due_date, (s.amount_due - s.amount_paid) AS balance, ia.full_name
        FROM installment_schedules s
        LEFT JOIN installment_applications ia ON s.application_id = ia.id
        WHERE s.status != 'paid' AND s.due_date < CURDATE()
        ORDER BY s.due_date ASC
        LIMIT 5
      `),
      runQuery(req.db, `
        SELECT o.id, u.name AS customer_name, o.total_price, o.payment_status, o.payment_error, o.created_at
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.payment_status IN ('payment_setup_failed', 'installment_downpayment_failed')
        ORDER BY o.created_at DESC
        LIMIT 5
      `),
      runQuery(req.db, `
        SELECT id, name, stock, price, category
        FROM products
        WHERE stock > 0 AND stock <= 5
        ORDER BY stock ASC, id DESC
        LIMIT 5
      `),
      runQuery(req.db, `
        SELECT id, name, stock, price, category
        FROM products
        WHERE stock <= 0
        ORDER BY id DESC
        LIMIT 5
      `)
    ]);

    const summary = summaryRows[0] || {};
    const total =
      Number(summary.pending_orders || 0) +
      Number(summary.cancellation_requests || 0) +
      Number(summary.repair_requests || 0) +
      Number(summary.pending_installments || 0) +
      Number(summary.overdue_installments || 0) +
      Number(summary.gateway_issues || 0) +
      Number(summary.low_stock_products || 0) +
      Number(summary.out_of_stock_products || 0);
    const inventoryTimestamp = new Date().toISOString();

    res.json({
      summary: { ...summary, total },
      items: [
        ...recentApplications.map(item => ({
          type: "installment",
          title: "Installment application needs review",
          detail: `${item.full_name || "Customer"} submitted an application for ${item.order_id ? orderLabel(item.order_id) : "Order ID N/A"}.`,
          amount: item.order_total,
          order_id: item.order_id,
          application_id: item.id,
          section: "installments",
          created_at: item.created_at
        })),
        ...recentOrders.map(item => ({
          type: "order",
          title: "New order pending",
          detail: `${orderLabel(item.id)} from ${item.customer_name || "Customer"} is waiting for processing.`,
          amount: item.total_price,
          order_id: item.id,
          section: "orders",
          created_at: item.created_at
        })),
        ...cancellationRequests.map(item => ({
          type: "cancel",
          title: "Cancellation request pending",
          detail: `${item.customer_name || "Customer"} requested cancellation for ${orderLabel(item.id)}.`,
          amount: item.total_price,
          order_id: item.id,
          section: "orders",
          created_at: item.cancellation_requested_at
        })),
        ...repairRequests.map(item => ({
          type: "repair",
          title: "Repair request pending",
          detail: `${item.customer_name || "Customer"} requested repair for ${orderLabel(item.id)}.`,
          amount: item.total_price,
          order_id: item.id,
          section: "orders",
          created_at: item.repair_requested_at
        })),
        ...overdueSchedules.map(item => ({
          type: "overdue",
          title: "Installment payment overdue",
          detail: `${item.full_name || "Customer"} has an overdue schedule for ${orderLabel(item.order_id)}.`,
          amount: item.balance,
          order_id: item.order_id,
          schedule_id: item.id,
          section: "collections",
          created_at: item.due_date
        })),
        ...gatewayIssues.map(item => ({
          type: "gateway",
          title: "Payment gateway issue",
          detail: `${orderLabel(item.id)} has a failed online payment setup.`,
          amount: item.total_price,
          order_id: item.id,
          section: "orders",
          created_at: item.created_at
        })),
        ...outOfStockProducts.map(item => ({
          type: "out_stock",
          title: "Product out of stock",
          detail: `${item.name || "Product"} has no remaining stock.`,
          amount: item.price,
          product_id: item.id,
          product_name: item.name,
          section: "inventory",
          created_at: inventoryTimestamp
        })),
        ...lowStockProducts.map(item => ({
          type: "low_stock",
          title: "Low stock product",
          detail: `${item.name || "Product"} only has ${item.stock} left.`,
          amount: item.price,
          product_id: item.id,
          product_name: item.name,
          section: "inventory",
          created_at: inventoryTimestamp
        }))
      ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0, 12)
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

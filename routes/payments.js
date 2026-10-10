const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const router = express.Router();
const { createNotification } = require("./notifications");
const { orderLabel } = require("./orderReference");
const { recordVoucherRedemption } = require("./voucherService");
const { requireAdminOrStaff, requireAdmin } = require("./roleGuard");
const { customerSession, orderSession, customerIdentity, ownedOrder } = require('./customerAccess');
const { logAudit } = require("./auditLogs");

const PAYMENT_UPLOAD_DIR = require('../services/uploadStorage').paymentProofs;
const PROOF_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PAID_STATUSES = ["paid", "installment_downpayment_paid", "installment_active", "installment_completed"];

function dbQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function ensurePaymentUploadDir() {
  fs.mkdirSync(PAYMENT_UPLOAD_DIR, { recursive: true });
}

function safeUploadName(file) {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const safeExt = [".jpg", ".jpeg", ".png", ".webp"].includes(ext) ? ext : ".jpg";
  return `gcash-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      ensurePaymentUploadDir();
      cb(null, PAYMENT_UPLOAD_DIR);
    },
    filename: (req, file, cb) => cb(null, safeUploadName(file))
  }),
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!PROOF_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error("Payment proof must be JPG, PNG, or WEBP."));
    }
    cb(null, true);
  }
});

function paymentConfig() {
  return {
    account_name: process.env.GCASH_ACCOUNT_NAME || "SH*** M** C.",
    account_number: process.env.GCASH_ACCOUNT_NUMBER || "",
    qr_image: process.env.GCASH_QR_IMAGE || "/assets/gcash-store-qr-code.png",
    instructions: [
      "Send the exact order amount to the store GCash account.",
      "Enter the reference number from GCash.",
      "Upload a clear screenshot of your payment.",
      "Wait while the store checks your payment."
    ]
  };
}

async function ensureOrderPaymentVerificationColumns(db) {
  const columns = [
    ["gcash_reference", "ADD COLUMN gcash_reference VARCHAR(80) NULL"],
    ["payment_proof_image", "ADD COLUMN payment_proof_image TEXT NULL"],
    ["payment_submitted_at", "ADD COLUMN payment_submitted_at DATETIME NULL"],
    ["payment_verified_at", "ADD COLUMN payment_verified_at DATETIME NULL"],
    ["payment_verified_by", "ADD COLUMN payment_verified_by INT NULL"],
    ["payment_verified_by_name", "ADD COLUMN payment_verified_by_name VARCHAR(255) NULL"],
    ["payment_rejection_reason", "ADD COLUMN payment_rejection_reason TEXT NULL"]
  ];

  for (const [name, alter] of columns) {
    const rows = await dbQuery(db, `SHOW COLUMNS FROM orders LIKE '${name}'`);
    if (rows.length) continue;
    try {
      await dbQuery(db, `ALTER TABLE orders ${alter}`);
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
}

function normalizeReference(value) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function validateReference(value) {
  const reference = normalizeReference(value);
  if (!/^[A-Za-z0-9-]{8,50}$/.test(reference)) {
    throw new Error("Enter a valid GCash reference number.");
  }
  return reference;
}

function proofPath(file) {
  return file ? `/uploads/payments/${file.filename}` : null;
}

function publicOrderFields(row) {
  return {
    order_id: row.id,
    payment_method: row.payment_method,
    payment_status: row.payment_status,
    payment_provider: row.payment_provider,
    payment_reference: row.payment_reference,
    gcash_reference: row.gcash_reference,
    payment_proof_image: row.payment_proof_image,
    payment_submitted_at: row.payment_submitted_at,
    payment_verified_at: row.payment_verified_at,
    payment_verified_by_name: row.payment_verified_by_name,
    payment_rejection_reason: row.payment_rejection_reason
  };
}

async function loadOrder(db, orderId) {
  const rows = await dbQuery(db, "SELECT * FROM orders WHERE id=? LIMIT 1", [orderId]);
  return rows[0] || null;
}

async function ensureCustomerOwnsOrder(db, order, userId) {
  if (!userId || Number(order.user_id) !== Number(userId)) {
    throw Object.assign(new Error("This order is not linked to your customer account."), { status: 403 });
  }
}

async function assertUniqueReference(db, reference, orderId) {
  const rows = await dbQuery(db, `
    SELECT id
    FROM orders
    WHERE gcash_reference=? AND id<>?
    LIMIT 1
  `, [reference, orderId]);
  if (rows.length) {
    throw Object.assign(new Error("This GCash reference number is already used by another order."), { status: 409 });
  }
}

async function createPaymentLedgerIfNeeded(db, order) {
  const rows = await dbQuery(db, "SELECT id FROM payments WHERE order_id=? LIMIT 1", [order.id]);
  if (rows.length) return;
  const paidAmount = order.payment_method === "installment"
    ? Number(order.installment_downpayment || 0)
    : Number(order.total_price || 0);
  const balance = order.payment_method === "installment"
    ? Number(order.installment_balance || 0)
    : 0;
  await dbQuery(db, `
    INSERT INTO payments (order_id, amount_paid, balance, status, paid_at)
    VALUES (?, ?, ?, ?, NOW())
  `, [order.id, paidAmount, balance, balance <= 0 ? "paid" : "partial"]);
}

async function syncInstallmentDownpayment(db, order) {
  if (order.payment_method !== "installment" && !order.installment_application_id) return;
  await dbQuery(db, "UPDATE installment_applications SET downpayment_status='paid' WHERE order_id=?", [order.id]);
  const rows = await dbQuery(db, "SELECT * FROM installment_applications WHERE order_id=? ORDER BY id DESC LIMIT 1", [order.id]);
  const application = rows[0];
  if (!application || application.status !== "approved") return;

  await dbQuery(db, `
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
  `);

  const existing = await dbQuery(db, "SELECT id FROM installment_schedules WHERE application_id=? LIMIT 1", [application.id]);
  if (!existing.length) {
    const terms = Number(application.preferred_terms || order.installment_terms || 3);
    const monthlyAmount = Number(application.monthly_amount || order.installment_monthly || 0);
    const values = [];
    const baseDate = new Date();
    for (let i = 1; i <= terms; i += 1) {
      const dueDate = new Date(baseDate);
      dueDate.setMonth(dueDate.getMonth() + i);
      values.push([
        application.id,
        application.order_id,
        application.user_id,
        i,
        dueDate.toISOString().slice(0, 10),
        monthlyAmount,
        0,
        "unpaid"
      ]);
    }
    if (values.length) {
      await dbQuery(db, `
        INSERT INTO installment_schedules
        (application_id, order_id, user_id, installment_no, due_date, amount_due, amount_paid, status)
        VALUES ?
      `, [values]);
    }
  }

  await dbQuery(db, `
    UPDATE orders
    SET payment_status='installment_active',
        payment_provider='in_house_installment',
        installment_balance=?
    WHERE id=?
  `, [Number(application.financed_amount || order.installment_balance || 0), order.id]);
}

function notify(db, payload) {
  return new Promise((resolve) => {
    createNotification(db, payload, () => resolve());
  });
}

async function markVerifiedOrderPlaced(db, order, actorName) {
  if (String(order.status || "pending") !== "pending") return;

  try {
    await dbQuery(db, `
      INSERT INTO order_status_history (order_id, status, note, actor_role, actor_name)
      VALUES (?, 'pending', 'GCash payment approved. Order placed and waiting for processing.', 'admin', ?)
    `, [order.id, actorName || "Admin"]);
  } catch (error) {
    if (error.code !== "ER_NO_SUCH_TABLE" && error.code !== "ER_BAD_FIELD_ERROR") throw error;
  }
}

router.get("/gcash/config", (req, res) => {
  res.json(paymentConfig());
});

router.get("/gcash/pending", requireAdminOrStaff, async (req, res) => {
  try {
    await ensureOrderPaymentVerificationColumns(req.db);
    const rows = await dbQuery(req.db, `
      SELECT o.*, u.name AS customer_name, u.email AS customer_email
      FROM orders o
      LEFT JOIN users u ON u.id=o.user_id
      WHERE o.payment_provider='manual_gcash'
        AND o.payment_status='for_verification'
        AND o.gcash_reference IS NOT NULL
        AND o.payment_proof_image IS NOT NULL
      ORDER BY COALESCE(o.payment_submitted_at, o.created_at) DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/gcash/status/:order_id", orderSession, ownedOrder(), async (req, res) => {
  try {
    await ensureOrderPaymentVerificationColumns(req.db);
    const order = await loadOrder(req.db, Number(req.params.order_id));
    if (!order) return res.status(404).json({ message: "Order not found." });
    if (String(order.status || "") === "cancelled") {
      return res.status(400).json({ message: "Cancelled orders cannot accept payment proof." });
    }
    res.json({
      message: "Manual GCash payment status loaded.",
      ...publicOrderFields(order)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/gcash/retry/:order_id", customerSession, customerIdentity(), ownedOrder(), async (req, res) => {
  try {
    await ensureOrderPaymentVerificationColumns(req.db);
    const order = await loadOrder(req.db, Number(req.params.order_id));
    if (!order) return res.status(404).json({ message: "Order not found." });
    if (order.status === 'cancelled') return res.status(400).json({ message: 'Cancelled orders cannot accept payment proof.' });
    if (PAID_STATUSES.includes(order.payment_status)) {
      return res.status(400).json({ message: "This order is already paid." });
    }
    const retry = await dbQuery(req.db, `
      UPDATE orders
      SET payment_method=IF(payment_method='installment', payment_method, 'gcash'),
          payment_status='pending_payment',
          payment_provider='manual_gcash',
          payment_error=NULL
      WHERE id=? AND status<>'cancelled' AND COALESCE(payment_status,'') NOT IN (?)
    `, [order.id, PAID_STATUSES]);
    if (!retry.affectedRows) return res.status(409).json({ message: 'Payment changed. Refresh the order before trying again.' });
    const updated = await loadOrder(req.db, order.id);
    res.json({
      message: "You can now upload your GCash proof.",
      ...publicOrderFields(updated)
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/gcash/:order_id/submit", customerSession, ownedOrder(), (req, res, next) => {
  upload.single("payment_proof")(req, res, uploadErr => {
    if (uploadErr) return res.status(400).json({ message: uploadErr.message });
    next();
  });
}, require('../services/uploadStorage').validateUploadedMedia, customerIdentity(), async (req, res) => {

    const orderId = Number(req.params.order_id);
    const userId = Number(req.body.user_id || req.query.user_id);

    try {
      if (!Number.isInteger(orderId) || orderId <= 0) throw Object.assign(new Error("Valid order id is required."), { status: 400 });
      await ensureOrderPaymentVerificationColumns(req.db);
      const order = await loadOrder(req.db, orderId);
      if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });
      await ensureCustomerOwnsOrder(req.db, order, userId);
      if (String(order.status || "") === "cancelled") throw Object.assign(new Error("Cancelled orders cannot accept payment proof."), { status: 400 });
      if (PAID_STATUSES.includes(order.payment_status)) throw Object.assign(new Error("This order is already paid."), { status: 400 });
      if (!["gcash", "installment"].includes(String(order.payment_method || "").toLowerCase()) && order.payment_provider !== "manual_gcash") {
        throw Object.assign(new Error("This order does not use GCash proof upload."), { status: 400 });
      }

      const reference = validateReference(req.body.gcash_reference || req.body.payment_reference);
      const imagePath = proofPath(req.file);
      if (!imagePath) throw Object.assign(new Error("Upload a clear GCash payment proof image."), { status: 400 });
      await assertUniqueReference(req.db, reference, order.id);

      const submission = await dbQuery(req.db, `
        UPDATE orders
        SET payment_method=IF(payment_method='installment', payment_method, 'gcash'),
            payment_status='for_verification',
            payment_provider='manual_gcash',
            payment_reference=?,
            gcash_reference=?,
            payment_proof_image=?,
            payment_submitted_at=NOW(),
            payment_rejection_reason=NULL,
            payment_error=NULL
        WHERE id=? AND status<>'cancelled' AND COALESCE(payment_status,'') NOT IN (?)
      `, [reference, reference, imagePath, order.id, PAID_STATUSES]);
      if (!submission.affectedRows) throw Object.assign(new Error('Payment changed. Refresh the order before trying again.'), { status: 409 });

      await notify(req.db, {
        user_id: order.user_id,
        title: "Payment proof submitted",
        message: `${orderLabel(order.id)} GCash proof is ready to check.`,
        type: "payment",
        action_url: `/customer/order.html?order_id=${order.id}`
      });

      const updated = await loadOrder(req.db, order.id);
      res.json({
        message: "GCash proof uploaded. The store will check it shortly.",
        ...publicOrderFields(updated)
      });
    } catch (error) {
      res.status(error.status || 500).json({ message: error.message });
    }
});

async function verifyGcashPayment(req, res) {
  const orderId = Number(req.params.order_id);
  const decision = String(req.body.decision || req.body.status || "").toLowerCase();
  const actor = req.actorUser || {};

  try {
    if (!Number.isInteger(orderId) || orderId <= 0) throw Object.assign(new Error("Valid order id is required."), { status: 400 });
    if (!["approved", "rejected"].includes(decision)) throw Object.assign(new Error("Choose approved or rejected."), { status: 400 });
    await ensureOrderPaymentVerificationColumns(req.db);
    const order = await loadOrder(req.db, orderId);
    if (!order) throw Object.assign(new Error("Order not found."), { status: 404 });
    if (PAID_STATUSES.includes(order.payment_status)) throw Object.assign(new Error('This payment is already approved.'), { status: 400 });
    if (String(order.status || "") === "cancelled") {
      throw Object.assign(new Error("This order was cancelled and can no longer accept payment decisions."), { status: 400 });
    }
    if (order.payment_provider !== "manual_gcash" && order.payment_method !== "gcash" && order.payment_method !== "installment") {
      throw Object.assign(new Error("This order is not using GCash proof upload."), { status: 400 });
    }
    if (!order.gcash_reference || !order.payment_proof_image) {
      throw Object.assign(new Error("No GCash payment proof has been submitted for this order."), { status: 400 });
    }

    if (decision === "rejected") {
      const reason = String(req.body.rejection_reason || "").trim();
      if (!reason) throw Object.assign(new Error("Rejection reason is required."), { status: 400 });
      const rejection = await dbQuery(req.db, `
        UPDATE orders
        SET payment_status='rejected',
            payment_verified_at=NOW(),
            payment_verified_by=?,
            payment_verified_by_name=?,
            payment_rejection_reason=?,
            payment_error=?
        WHERE id=? AND status<>'cancelled' AND payment_proof_image=? AND gcash_reference=? AND payment_status=?
      `, [actor.id || null, actor.name || "Admin", reason, reason, order.id, order.payment_proof_image, order.gcash_reference, order.payment_status]);
      if (!rejection.affectedRows) throw Object.assign(new Error('Payment proof changed. Refresh before reviewing it again.'), { status: 409 });
      await notify(req.db, {
        user_id: order.user_id,
        title: "Payment proof rejected",
        message: `${orderLabel(order.id)} payment proof was rejected. ${reason} You can upload a new valid proof while the order remains active.`,
        type: "payment",
        action_url: `/customer/order.html?order_id=${order.id}`
      });
      logAudit(req.db, {
        actor_id: actor.id || null,
        actor_name: actor.name || actor.email || "Admin",
        actor_role: actor.role || "admin",
        action: "reject_payment",
        entity_type: "order",
        entity_id: order.id,
        details: `${orderLabel(order.id)} GCash payment rejected | reason: ${reason} | customer may re-upload proof`
      });
      const updated = await loadOrder(req.db, order.id);
      return res.json({ message: "Payment rejected. Customer was notified and may upload a new proof.", ...publicOrderFields(updated) });
    }

    const approval = await dbQuery(req.db, `
      UPDATE orders
      SET payment_status=IF(payment_method='installment', 'installment_downpayment_paid', 'paid'),
          payment_provider='manual_gcash',
          payment_completed_at=COALESCE(payment_completed_at, NOW()),
          payment_verified_at=NOW(),
          payment_verified_by=?,
          payment_verified_by_name=?,
          payment_rejection_reason=NULL,
          payment_error=NULL
      WHERE id=? AND status<>'cancelled' AND payment_proof_image=? AND gcash_reference=? AND payment_status=?
    `, [actor.id || null, actor.name || "Admin", order.id, order.payment_proof_image, order.gcash_reference, order.payment_status]);
    if (!approval.affectedRows) throw Object.assign(new Error('Payment proof changed. Refresh before reviewing it again.'), { status: 409 });

    const updated = await loadOrder(req.db, order.id);
    await createPaymentLedgerIfNeeded(req.db, updated);
    await syncInstallmentDownpayment(req.db, updated);
    const latest = await loadOrder(req.db, order.id);
    await markVerifiedOrderPlaced(req.db, latest, actor.name || "Admin");
    const finalOrder = await loadOrder(req.db, order.id);
    if (updated.payment_status === "paid") {
      await recordVoucherRedemption(req.db, updated, "regular");
    }
    await notify(req.db, {
      user_id: finalOrder.user_id,
      title: "Payment verified",
      message: `${orderLabel(finalOrder.id)} payment has been approved. Your order is now placed and waiting for processing.`,
      type: "payment",
      action_url: `/customer/order.html?order_id=${finalOrder.id}`
    });
    logAudit(req.db, {
      actor_id: actor.id || null,
      actor_name: actor.name || actor.email || "Admin",
      actor_role: actor.role || "admin",
      action: "approve_payment",
      entity_type: "order",
      entity_id: finalOrder.id,
      details: `${orderLabel(finalOrder.id)} GCash payment approved | status: ${finalOrder.payment_status}`
    });

    res.json({
      message: "Payment approved. Order placed and waiting for processing.",
      status: finalOrder.status,
      processing_at: finalOrder.processing_at,
      ...publicOrderFields(finalOrder)
    });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
}

router.put("/gcash/:order_id/verify", requireAdmin, verifyGcashPayment);
router.post("/gcash/:order_id/verify", requireAdmin, verifyGcashPayment);

router.post("/", requireAdmin, (req, res) => {
  const { order_id, amount_paid, due_date } = req.body;
  const payment = Number(amount_paid);

  if (!order_id || !payment || payment <= 0) {
    return res.status(400).json({ message: "Valid order_id and amount_paid are required" });
  }

  req.db.query("SELECT * FROM orders WHERE id = ?", [order_id], (err, orderResult) => {
    if (err) return res.status(500).json({ message: err.message });
    if (orderResult.length === 0) return res.status(404).json({ message: "Order not found" });

    const order = orderResult[0];
    const totalPrice = Number(order.total_price) || 0;

    req.db.query("SELECT SUM(amount_paid) AS total_paid FROM payments WHERE order_id = ?", [order_id], (err2, paidResult) => {
      if (err2) return res.status(500).json({ message: err2.message });

      const totalPaid = Number(paidResult[0].total_paid) || 0;
      const newTotalPaid = totalPaid + payment;
      const balance = Math.max(totalPrice - newTotalPaid, 0);
      const status = balance <= 0 ? "paid" : "partial";

      req.db.query(
        "INSERT INTO payments (order_id, amount_paid, balance, status, due_date) VALUES (?, ?, ?, ?, ?)",
        [order_id, payment, balance, status, due_date || null],
        (err3) => {
          if (err3) return res.status(500).json({ message: err3.message });
          res.json({ message: "Installment payment recorded", total_paid: newTotalPaid, balance, status, due_date: due_date || null });
        }
      );
    });
  });
});

router.get("/history/:order_id", orderSession, ownedOrder(), (req, res) => {
  req.db.query(
    "SELECT id, order_id, amount_paid, balance, status, due_date, created_at FROM payments WHERE order_id = ? ORDER BY created_at ASC",
    [req.params.order_id],
    (err, result) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json({ order_id: req.params.order_id, payments: result });
    }
  );
});

router.get("/overdue", requireAdmin, (req, res) => {
  const sql = `
    SELECT id, order_id, amount_paid, balance, status, due_date, created_at
    FROM payments
    WHERE due_date IS NOT NULL
      AND due_date < CURDATE()
      AND status != 'paid'
    ORDER BY due_date ASC
  `;

  req.db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json({ message: "Overdue payments fetched", count: result.length, overdue: result });
  });
});

router.get("/overdue-check", requireAdmin, (req, res) => {
  const sql = `
    SELECT *,
      CASE WHEN due_date < CURDATE() AND status != 'paid' THEN 'OVERDUE' ELSE status END AS computed_status
    FROM payments
  `;

  req.db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(result);
  });
});

router.get("/admin/receivables", requireAdmin, (req, res) => {
  const sql = `
    SELECT
      COUNT(*) AS total_payments,
      SUM(CASE WHEN status != 'paid' THEN balance ELSE 0 END) AS total_receivables,
      SUM(CASE WHEN due_date < CURDATE() AND status != 'paid' THEN 1 ELSE 0 END) AS overdue_count,
      SUM(CASE WHEN due_date < CURDATE() AND status != 'paid' THEN balance ELSE 0 END) AS overdue_amount
    FROM payments
  `;

  req.db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json({ message: "Admin receivables dashboard", data: result[0] });
  });
});

router.get("/admin/receivables/per-customer", requireAdmin, (req, res) => {
  const sql = `
    SELECT
      o.id AS order_id,
      o.product_id,
      u.name AS customer_name,
      u.email,
      SUM(p.balance) AS total_balance,
      SUM(CASE WHEN p.due_date < CURDATE() AND p.status != 'paid' THEN p.balance ELSE 0 END) AS overdue_balance,
      COUNT(p.id) AS payment_records
    FROM payments p
    JOIN orders o ON p.order_id = o.id
    JOIN users u ON o.user_id = u.id
    GROUP BY o.id, u.id
    ORDER BY overdue_balance DESC
  `;

  req.db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json({ message: "Per customer receivables", data: result });
  });
});

module.exports = router;

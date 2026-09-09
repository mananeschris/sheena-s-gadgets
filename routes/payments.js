const express = require("express");
const router = express.Router();
const { createNotification } = require("./notifications");
const { orderLabel } = require("./orderReference");
const ONLINE_PAYMENT_METHODS = ["gcash", "maya", "card"];
const PAYMONGO_METHODS = {
  gcash: "gcash",
  maya: "paymaya",
  card: "card"
};
const RETRY_BLOCKED_STATUSES = ["paid", "installment_downpayment_paid", "installment_active", "installment_completed", "installment_rejected"];

function paymongoAuthHeader() {
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey) return null;
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

function normalizePaymongoStatus(checkoutSession) {
  const attributes = checkoutSession?.attributes || {};
  const payments = Array.isArray(attributes.payments) ? attributes.payments : [];
  const paymentIntent = attributes.payment_intent?.attributes || {};
  const candidates = [
    payments[0]?.attributes?.status,
    paymentIntent.status,
    attributes.status
  ].filter(Boolean).map(value => String(value).toLowerCase());

  if (candidates.some(status => ["paid", "succeeded", "success"].includes(status))) return "paid";
  if (candidates.includes("expired")) return "expired";
  if (candidates.some(status => ["failed", "payment_failed"].includes(status))) return "failed";
  if (candidates.some(status => ["cancelled", "canceled"].includes(status))) return "cancelled";
  return "pending_verification";
}

function isPaymentPaid(status) {
  return ["paid", "installment_downpayment_paid", "installment_active", "installment_completed"].includes(status);
}

function isPaymentFailed(status) {
  return [
    "failed",
    "expired",
    "cancelled",
    "payment_setup_failed",
    "installment_downpayment_failed",
    "installment_downpayment_expired",
    "installment_rejected"
  ].includes(status);
}

function cleanNullable(value) {
  return value === undefined || value === "" ? null : value;
}

function updateOrderPayment(db, orderId, fields, callback) {
  const paymentStatus = fields.payment_status || null;

  db.query(
    `UPDATE orders
     SET payment_status=?,
         payment_provider=COALESCE(?, payment_provider),
         payment_reference=COALESCE(?, payment_reference),
         payment_checkout_id=COALESCE(?, payment_checkout_id),
         payment_checkout_url=COALESCE(?, payment_checkout_url),
         payment_error=?,
         payment_last_checked_at=NOW(),
         payment_completed_at=IF(? = 1, COALESCE(payment_completed_at, NOW()), payment_completed_at),
         payment_failed_at=IF(? = 1, COALESCE(payment_failed_at, NOW()), payment_failed_at)
     WHERE id=?`,
    [
      paymentStatus,
      cleanNullable(fields.payment_provider || "paymongo"),
      cleanNullable(fields.payment_reference),
      cleanNullable(fields.payment_checkout_id),
      cleanNullable(fields.payment_checkout_url),
      fields.payment_error || null,
      isPaymentPaid(paymentStatus) ? 1 : 0,
      isPaymentFailed(paymentStatus) ? 1 : 0,
      orderId
    ],
    callback
  );
}

function recordPaymentCheckError(db, orderId, message, callback) {
  db.query(
    "UPDATE orders SET payment_last_checked_at=NOW(), payment_error=? WHERE id=?",
    [message || "Unable to refresh payment status.", orderId],
    callback
  );
}

function installmentAwareStatus(order, paymongoStatus) {
  if (order.payment_method !== "installment") return paymongoStatus;
  if (paymongoStatus === "paid") return "installment_downpayment_paid";
  if (paymongoStatus === "expired") return "installment_downpayment_expired";
  if (paymongoStatus === "failed" || paymongoStatus === "cancelled") return "installment_downpayment_failed";
  return "installment_downpayment_pending";
}

function syncInstallmentDownpayment(db, orderId, paymentStatus, callback) {
  if (!String(paymentStatus || "").startsWith("installment_downpayment_")) {
    return callback();
  }

  const downpaymentStatus = paymentStatus === "installment_downpayment_paid"
    ? "paid"
    : paymentStatus === "installment_downpayment_expired"
      ? "expired"
      : paymentStatus === "installment_downpayment_failed"
        ? "failed"
        : "pending";

  db.query(
    "UPDATE installment_applications SET downpayment_status=? WHERE order_id=?",
    [downpaymentStatus, orderId],
    (err) => {
      if (err) return callback(err);
      if (downpaymentStatus !== "paid") return callback();

      db.query("SELECT * FROM installment_applications WHERE order_id=? LIMIT 1", [orderId], (selectErr, rows) => {
        if (selectErr) return callback(selectErr);
        const application = rows[0];
        if (!application || application.status !== "approved") return callback();
        activateInstallmentOrder(db, application, callback);
      });
    }
  );
}

function activateInstallmentOrder(db, application, callback) {
  db.query("SELECT id FROM payments WHERE order_id=? LIMIT 1", [application.order_id], (paymentErr, paymentRows) => {
    if (paymentErr) return callback(paymentErr);

    const updateOrder = (next) => {
      db.query(
        "UPDATE orders SET payment_status=?, payment_provider=?, payment_error=NULL, payment_completed_at=COALESCE(payment_completed_at, NOW()) WHERE id=?",
        ["installment_active", "in_house_installment", application.order_id],
        (orderErr) => {
          if (orderErr) return next(orderErr);
          createInstallmentSchedule(db, application, (scheduleErr) => {
            if (scheduleErr) return next(scheduleErr);
            createNotification(db, {
              user_id: application.user_id,
              title: "Installment schedule activated",
              message: `Your downpayment for ${orderLabel(application.order_id)} was confirmed. Your monthly schedule is now active.`,
              type: "installment",
              action_url: `/customer/order.html?order_id=${application.order_id}`
            }, next);
          });
        }
      );
    };

    if (paymentRows.length) return updateOrder(callback);

    const dueDate = new Date();
    dueDate.setMonth(dueDate.getMonth() + 1);
    const dueDateText = dueDate.toISOString().slice(0, 10);

    db.query(
      "INSERT INTO payments (order_id, amount_paid, balance, status, due_date) VALUES (?, ?, ?, ?, ?)",
      [
        application.order_id,
        Number(application.downpayment_amount || 0),
        Number(application.financed_amount || 0),
        Number(application.financed_amount || 0) <= 0 ? "paid" : "partial",
        dueDateText
      ],
      (insertErr) => {
        if (insertErr) return callback(insertErr);
        updateOrder(callback);
      }
    );
  });
}

function createInstallmentSchedule(db, application, callback) {
  db.query(
    "SELECT COUNT(*) AS total FROM installment_schedules WHERE application_id=?",
    [application.id],
    (countErr, countRows) => {
      if (countErr) {
        if (countErr.code === "ER_NO_SUCH_TABLE") {
          return ensureInstallmentScheduleTable(db, (tableErr) => {
            if (tableErr) return callback(tableErr);
            createInstallmentSchedule(db, application, callback);
          });
        }
        return callback(countErr);
      }
      if (Number(countRows[0]?.total || 0) > 0) return callback();

      const terms = Number(application.preferred_terms || 3);
      const monthlyAmount = Number(application.monthly_amount || 0);
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

      db.query(
        `INSERT INTO installment_schedules
         (application_id, order_id, user_id, installment_no, due_date, amount_due, amount_paid, status)
         VALUES ?`,
        [values],
        callback
      );
    }
  );
}


function dbQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function scheduleRemaining(schedule) {
  return Math.max(Number(schedule.amount_due || 0) - Number(schedule.amount_paid || 0), 0);
}

function createNotificationAsync(db, payload) {
  return new Promise((resolve, reject) => {
    createNotification(db, payload, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function loadInstallmentSchedule(db, scheduleId) {
  const rows = await dbQuery(db, `
    SELECT s.*
    FROM installment_schedules s
    WHERE s.id=?
    LIMIT 1
  `, [scheduleId]);
  return rows[0] || null;
}

async function recordInstallmentScheduleLedger(db, schedule, appliedAmount) {
  if (!Number.isFinite(appliedAmount) || appliedAmount <= 0) return;

  const rows = await dbQuery(db, `
    SELECT COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)), 0) AS remaining_balance
    FROM installment_schedules
    WHERE order_id=?
  `, [schedule.order_id]);
  const balance = Math.max(Number(rows[0]?.remaining_balance || 0), 0);

  await dbQuery(db, `
    INSERT INTO payments (order_id, amount_paid, balance, status, due_date, paid_at)
    VALUES (?, ?, ?, ?, ?, NOW())
  `, [
    schedule.order_id,
    appliedAmount,
    balance,
    balance <= 0 ? "paid" : "partial",
    schedule.due_date || null
  ]);
}

async function syncInstallmentScheduleOrder(db, orderId) {
  const rows = await dbQuery(db, `
    SELECT
      COALESCE(SUM(GREATEST(amount_due - amount_paid, 0)), 0) AS remaining_balance,
      SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
      COUNT(*) AS total_count
    FROM installment_schedules
    WHERE order_id=?
  `, [orderId]);
  const summary = rows[0] || {};
  const remaining = Math.max(Number(summary.remaining_balance || 0), 0);
  const totalCount = Number(summary.total_count || 0);
  const paidCount = Number(summary.paid_count || 0);

  if (totalCount > 0 && paidCount === totalCount) {
    await dbQuery(db, `
      UPDATE orders
      SET payment_status='installment_completed',
          installment_balance=0,
          payment_completed_at=COALESCE(payment_completed_at, NOW())
      WHERE id=?
    `, [orderId]);
    return;
  }

  await dbQuery(db, `
    UPDATE orders
    SET installment_balance=?,
        payment_status=IF(payment_status='installment_completed', 'installment_active', payment_status)
    WHERE id=?
  `, [remaining, orderId]);
}

async function handleInstallmentScheduleWebhook(db, scheduleId, checkout, sourceStatus) {
  const schedule = await loadInstallmentSchedule(db, scheduleId);
  if (!schedule) {
    return { ignored: true, message: "Installment schedule not found for PayMongo reference." };
  }

  const checkoutAttributes = checkout?.attributes || {};
  const paymentReference = checkoutAttributes.reference_number || schedule.payment_reference;
  const checkoutUrl = checkoutAttributes.checkout_url || schedule.payment_checkout_url;

  if (sourceStatus === "paid") {
    if (schedule.status === "paid" || scheduleRemaining(schedule) <= 0) {
      return {
        schedule_id: schedule.id,
        order_id: schedule.order_id,
        source_status: sourceStatus,
        payment_status: "paid",
        already_paid: true
      };
    }

    const due = Number(schedule.amount_due || 0);
    const previousPaid = Number(schedule.amount_paid || 0);
    const appliedAmount = Math.max(due - previousPaid, 0);

    await dbQuery(db, `
      UPDATE installment_schedules
      SET amount_paid=?,
          status='paid',
          paid_at=COALESCE(paid_at, NOW()),
          payment_status='paid',
          payment_provider='paymongo_installment_monthly',
          payment_reference=COALESCE(?, payment_reference),
          payment_checkout_id=COALESCE(?, payment_checkout_id),
          payment_checkout_url=COALESCE(?, payment_checkout_url),
          payment_error=NULL,
          payment_last_checked_at=NOW()
      WHERE id=?
    `, [
      due,
      paymentReference,
      checkout?.id || schedule.payment_checkout_id,
      checkoutUrl,
      schedule.id
    ]);

    await recordInstallmentScheduleLedger(db, schedule, appliedAmount);
    await syncInstallmentScheduleOrder(db, schedule.order_id);
    await createNotificationAsync(db, {
      user_id: schedule.user_id,
      title: "Installment payment confirmed",
      message: `Installment ${schedule.installment_no} for ${orderLabel(schedule.order_id)} was confirmed online.`,
      type: "payment",
      action_url: `/customer/order.html?order_id=${schedule.order_id}`
    });

    return {
      schedule_id: schedule.id,
      order_id: schedule.order_id,
      source_status: sourceStatus,
      payment_status: "paid"
    };
  }

  const paymentStatus = sourceStatus === "expired"
    ? "expired"
    : sourceStatus === "failed" || sourceStatus === "cancelled"
      ? sourceStatus
      : "pending_verification";

  await dbQuery(db, `
    UPDATE installment_schedules
    SET payment_status=?,
        payment_provider='paymongo_installment_monthly',
        payment_reference=COALESCE(?, payment_reference),
        payment_checkout_id=COALESCE(?, payment_checkout_id),
        payment_checkout_url=COALESCE(?, payment_checkout_url),
        payment_error=?,
        payment_last_checked_at=NOW()
    WHERE id=?
  `, [
    paymentStatus,
    paymentReference,
    checkout?.id || schedule.payment_checkout_id,
    checkoutUrl,
    ["failed", "expired", "cancelled"].includes(paymentStatus) ? paymentStatus : null,
    schedule.id
  ]);

  return {
    schedule_id: schedule.id,
    order_id: schedule.order_id,
    source_status: sourceStatus,
    payment_status: paymentStatus
  };
}
function baseUrl(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function publicError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requestActorId(req) {
  const raw = req.body?.actor_id || req.query?.actor_id || req.headers["x-actor-id"];
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function requestUserId(req) {
  const raw = req.body?.user_id || req.query?.user_id;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function authorizePaymentRetry(db, req, order) {
  const actorId = requestActorId(req);
  if (actorId) {
    const users = await dbQuery(db, "SELECT id, name, email, role FROM users WHERE id=? LIMIT 1", [actorId]);
    const actor = users[0];
    const role = String(actor?.role || "").toLowerCase();
    if (actor && ["admin", "staff"].includes(role)) {
      return { ok: true, role, actor };
    }
  }

  const userId = requestUserId(req);
  if (userId && Number(order.user_id) === userId) {
    return { ok: true, role: "customer", actor: { id: userId, role: "customer" } };
  }

  return { ok: false };
}

async function loadRetryOrder(db, orderId) {
  const rows = await dbQuery(db, `
    SELECT o.*, p.name AS product_name, p.image AS product_image, p.images AS product_images
    FROM orders o
    LEFT JOIN products p ON o.product_id = p.id
    WHERE o.id=?
    LIMIT 1
  `, [orderId]);
  const order = rows[0];
  if (!order) return null;

  try {
    order.items = await dbQuery(db, "SELECT * FROM order_items WHERE order_id=? ORDER BY id ASC", [order.id]);
  } catch (error) {
    if (error.code !== "ER_NO_SUCH_TABLE") throw error;
    order.items = [];
  }

  if (order.payment_method === "installment" || order.installment_application_id) {
    const applications = await dbQuery(db, "SELECT * FROM installment_applications WHERE order_id=? ORDER BY id DESC LIMIT 1", [order.id]);
    order.installment_application = applications[0] || null;
  }

  return order;
}

function retryItemName(order, mode) {
  if (mode === "installment") return `${orderLabel(order.id)} Downpayment`;
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length > 1) return `${items.length} cart items`;
  return items[0]?.product_name || order.product_name || orderLabel(order.id);
}

function buildRetryCheckout(order) {
  if (String(order.status || "pending") === "cancelled") {
    throw publicError(400, "Cancelled orders cannot be paid again.");
  }

  if (RETRY_BLOCKED_STATUSES.includes(order.payment_status)) {
    throw publicError(400, "This order payment is already final and cannot be retried.");
  }

  if (order.payment_method === "installment") {
    const application = order.installment_application;
    if (!application || application.status !== "approved") {
      throw publicError(400, "Installment needs admin approval before a downpayment link can be generated.");
    }
    if (application.downpayment_status === "paid") {
      throw publicError(400, "Installment downpayment is already paid.");
    }

    const amount = Number(application.downpayment_amount || order.installment_downpayment || 0);
    if (!Number.isFinite(amount) || amount <= 0) throw publicError(400, "Valid downpayment amount is required.");

    return {
      mode: "installment",
      method: application.downpayment_method || "gcash",
      amount,
      provider: "paymongo_installment_downpayment",
      nextStatus: "installment_downpayment_pending",
      itemName: retryItemName(order, "installment"),
      description: `Installment downpayment for ${orderLabel(order.id)}`,
      application
    };
  }

  const method = String(order.payment_method || "").toLowerCase();
  if (!ONLINE_PAYMENT_METHODS.includes(method)) {
    throw publicError(400, "Only GCash, Maya, card, or installment downpayment can regenerate a PayMongo checkout link.");
  }

  const amount = Number(order.total_price || 0);
  if (!Number.isFinite(amount) || amount <= 0) throw publicError(400, "Valid order total is required.");

  return {
    mode: "online",
    method,
    amount,
    provider: "paymongo",
    nextStatus: "pending_verification",
    itemName: retryItemName(order, "online"),
    description: `${orderLabel(order.id)} payment`
  };
}

async function createRetryCheckoutSession(req, order, retry) {
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey) throw publicError(400, "PayMongo sandbox key is not configured yet.");

  const auth = Buffer.from(`${secretKey}:`).toString("base64");
  const origin = baseUrl(req);
  const reference = `ORDER-${order.id}-RETRY-${Date.now().toString(36).toUpperCase()}`;
  const payload = {
    data: {
      attributes: {
        description: retry.description,
        line_items: [
          {
            name: retry.itemName,
            quantity: 1,
            amount: Math.round(retry.amount * 100),
            currency: "PHP"
          }
        ],
        payment_method_types: [PAYMONGO_METHODS[retry.method] || "card"],
        reference_number: reference,
        send_email_receipt: false,
        show_description: true,
        show_line_items: true,
        success_url: `${origin}/payment-result.html?order_id=${order.id}&result=success`,
        cancel_url: `${origin}/payment-result.html?order_id=${order.id}&result=cancelled`
      }
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("PayMongo API request timed out. Check internet connection, firewall, or try again later.");
    }
    throw new Error(`Unable to connect to PayMongo API: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json();
  if (!response.ok) {
    const detail = data?.errors?.[0]?.detail || data?.errors?.[0]?.title || "PayMongo checkout creation failed";
    throw new Error(detail);
  }

  const checkout = data.data || {};
  const attributes = checkout.attributes || {};
  return {
    payment_reference: attributes.reference_number || reference,
    payment_checkout_id: checkout.id,
    payment_checkout_url: attributes.checkout_url
  };
}

async function saveRetryCheckout(db, order, retry, checkout) {
  await dbQuery(db, `
    UPDATE orders
    SET payment_status=?, payment_provider=?, payment_reference=?, payment_checkout_id=?, payment_checkout_url=?,
        payment_error=NULL, payment_last_checked_at=NULL, payment_failed_at=NULL
    WHERE id=?
  `, [
    retry.nextStatus,
    retry.provider,
    checkout.payment_reference,
    checkout.payment_checkout_id,
    checkout.payment_checkout_url,
    order.id
  ]);

  if (retry.mode === "installment" && retry.application?.id) {
    await dbQuery(db, "UPDATE installment_applications SET downpayment_status='pending' WHERE id=?", [retry.application.id]);
  }
}

async function markRetryFailure(db, order, retry, message) {
  const failedStatus = retry?.mode === "installment" ? "installment_downpayment_failed" : "payment_setup_failed";
  const provider = retry?.provider || (order.payment_method === "installment" ? "paymongo_installment_downpayment" : "paymongo");
  await dbQuery(db, `
    UPDATE orders
    SET payment_status=?, payment_provider=?, payment_error=?, payment_failed_at=COALESCE(payment_failed_at, NOW())
    WHERE id=?
  `, [failedStatus, provider, message || "Unable to regenerate payment link.", order.id]);

  if (retry?.mode === "installment" && retry.application?.id) {
    await dbQuery(db, "UPDATE installment_applications SET downpayment_status='failed' WHERE id=?", [retry.application.id]);
  }
}function ensureInstallmentScheduleTable(db, callback) {
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

router.post("/paymongo/retry/:order_id", async (req, res) => {
  const orderId = Number(req.params.order_id);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({ message: "Valid order id is required." });
  }

  let order = null;
  let retry = null;

  try {
    order = await loadRetryOrder(req.db, orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const authorization = await authorizePaymentRetry(req.db, req, order);
    if (!authorization.ok) {
      return res.status(403).json({ message: "Signed-in customer, admin, or staff account required to regenerate payment link." });
    }

    retry = buildRetryCheckout(order);
    const checkout = await createRetryCheckoutSession(req, order, retry);
    await saveRetryCheckout(req.db, order, retry, checkout);

    if (["admin", "staff"].includes(authorization.role) && order.user_id) {
      createNotification(req.db, {
        user_id: order.user_id,
        title: retry.mode === "installment" ? "Downpayment link refreshed" : "Payment link refreshed",
        message: `${orderLabel(order.id)} has a new secure payment link.`,
        type: "payment",
        action_url: `/customer/order.html?order_id=${order.id}`
      });
    }

    res.json({
      message: retry.mode === "installment" ? "New downpayment link generated." : "New payment link generated.",
      order_id: order.id,
      payment_status: retry.nextStatus,
      payment_provider: retry.provider,
      payment_reference: checkout.payment_reference,
      payment_checkout_id: checkout.payment_checkout_id,
      payment_checkout_url: checkout.payment_checkout_url
    });
  } catch (error) {
    if (order && retry && !error.status) {
      try {
        await markRetryFailure(req.db, order, retry, error.message);
      } catch (failureUpdateError) {
        return res.status(500).json({ message: failureUpdateError.message });
      }
    }
    res.status(error.status || 502).json({ message: error.message || "Unable to regenerate payment link." });
  }
});

router.get("/paymongo/status/:order_id", (req, res) => {
  const orderId = req.params.order_id;
  const auth = paymongoAuthHeader();

  req.db.query("SELECT * FROM orders WHERE id=?", [orderId], async (orderErr, orderRows) => {
    if (orderErr) return res.status(500).json({ message: orderErr.message });
    if (!orderRows.length) return res.status(404).json({ message: "Order not found" });

    const order = orderRows[0];
    if (!auth) {
      return res.json({
        order_id: orderId,
        payment_status: order.payment_status || "awaiting_gateway_setup",
        message: "PayMongo sandbox key is not configured yet."
      });
    }

    if (!order.payment_checkout_id) {
      return recordPaymentCheckError(req.db, orderId, "No PayMongo checkout session is linked to this order yet.", () => {
        res.json({
          order_id: orderId,
          payment_status: order.payment_status || "pending_verification",
          needs_checkout: true,
          message: "No PayMongo checkout session is linked to this order yet."
        });
      });
    }

    try {
      const response = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${order.payment_checkout_id}`, {
        headers: { Authorization: auth }
      });
      const data = await response.json();

      if (!response.ok) {
        const detail = data?.errors?.[0]?.detail || data?.errors?.[0]?.title || "Unable to retrieve payment status";
        return recordPaymentCheckError(req.db, orderId, detail, () => {
          res.status(502).json({ message: detail });
        });
      }

      const checkout = data.data || {};
      const attributes = checkout.attributes || {};
      const sourceStatus = normalizePaymongoStatus(checkout);
      const paymentStatus = installmentAwareStatus(order, sourceStatus);
      const fields = {
        payment_status: paymentStatus,
        payment_provider: order.payment_method === "installment" ? "paymongo_installment_downpayment" : "paymongo",
        payment_reference: attributes.reference_number || order.payment_reference,
        payment_checkout_id: checkout.id || order.payment_checkout_id,
        payment_checkout_url: attributes.checkout_url || order.payment_checkout_url,
        payment_error: null
      };

      updateOrderPayment(req.db, orderId, fields, (updateErr) => {
        if (updateErr) return res.status(500).json({ message: updateErr.message });
        syncInstallmentDownpayment(req.db, orderId, paymentStatus, (syncErr) => {
          if (syncErr) return res.status(500).json({ message: syncErr.message });
          res.json({
            order_id: orderId,
            source_status: sourceStatus,
            checked_at: new Date().toISOString(),
            ...fields
          });
        });
      });
    } catch (error) {
      recordPaymentCheckError(req.db, orderId, error.message, () => {
        res.status(502).json({ message: error.message });
      });
    }
  });
});
router.post("/paymongo/webhook", (req, res) => {
  const event = req.body?.data || req.body;
  const attributes = event?.attributes || {};
  const type = attributes.type || event?.type;
  const checkout = attributes.data || event?.data;
  const checkoutAttributes = checkout?.attributes || {};
  const reference = checkoutAttributes.reference_number || "";
  const scheduleMatch = reference.match(/^INST-SCHED-(\d+)$/);

  if (scheduleMatch) {
    const sourceStatus = type === "checkout_session.payment.paid"
      ? "paid"
      : normalizePaymongoStatus(checkout);

    handleInstallmentScheduleWebhook(req.db, Number(scheduleMatch[1]), checkout, sourceStatus)
      .then((result) => res.json({ received: true, ...result }))
      .catch((error) => res.status(500).json({ message: error.message }));
    return;
  }

  const match = reference.match(/ORDER-(\d+)/);

  if (!match) return res.json({ received: true, ignored: true });

  req.db.query("SELECT * FROM orders WHERE id=?", [match[1]], (orderErr, orderRows) => {
    if (orderErr) return res.status(500).json({ message: orderErr.message });
    if (!orderRows.length) {
      return res.json({ received: true, ignored: true, message: "Order not found for PayMongo reference." });
    }

    const order = orderRows[0];
    const sourceStatus = type === "checkout_session.payment.paid"
      ? "paid"
      : normalizePaymongoStatus(checkout);
    const paymentStatus = installmentAwareStatus(order, sourceStatus);

    updateOrderPayment(req.db, match[1], {
      payment_status: paymentStatus,
      payment_provider: order.payment_method === "installment" ? "paymongo_installment_downpayment" : "paymongo",
      payment_reference: reference || order.payment_reference,
      payment_checkout_id: checkout?.id || order.payment_checkout_id,
      payment_checkout_url: checkoutAttributes.checkout_url || order.payment_checkout_url,
      payment_error: null
    }, (updateErr) => {
      if (updateErr) return res.status(500).json({ message: updateErr.message });
      syncInstallmentDownpayment(req.db, match[1], paymentStatus, (syncErr) => {
        if (syncErr) return res.status(500).json({ message: syncErr.message });
        res.json({ received: true, order_id: match[1], source_status: sourceStatus, payment_status: paymentStatus });
      });
    });
  });
});
// INSTALLMENT PAYMENT WITH DUE DATE
router.post("/", (req, res) => {
  const { order_id, amount_paid, due_date } = req.body;
  const payment = Number(amount_paid);

  if (!order_id || !payment || payment <= 0) {
    return res.status(400).json({ message: "Valid order_id and amount_paid are required" });
  }

  const getOrder = "SELECT * FROM orders WHERE id = ?";

  req.db.query(getOrder, [order_id], (err, orderResult) => {
    if (err) return res.status(500).json({ message: err.message });

    if (orderResult.length === 0) {
      return res.status(404).json({ message: "Order not found" });
    }

    const order = orderResult[0];
    const totalPrice = Number(order.total_price) || 0;

    const getPaid =
      "SELECT SUM(amount_paid) AS total_paid FROM payments WHERE order_id = ?";

    req.db.query(getPaid, [order_id], (err2, paidResult) => {
      if (err2) return res.status(500).json({ message: err2.message });

      const totalPaid = Number(paidResult[0].total_paid) || 0;
      const newTotalPaid = totalPaid + payment;
      const balance = Math.max(totalPrice - newTotalPaid, 0);
      const status = balance <= 0 ? "paid" : "partial";

      const insertPayment = `
        INSERT INTO payments (order_id, amount_paid, balance, status, due_date)
        VALUES (?, ?, ?, ?, ?)
      `;

      req.db.query(
        insertPayment,
        [order_id, payment, balance, status, due_date || null],
        (err3) => {
          if (err3) return res.status(500).json({ message: err3.message });

          res.json({
            message: "Installment payment recorded",
            total_paid: newTotalPaid,
            balance,
            status,
            due_date: due_date || null
          });
        }
      );
    });
  });
});

// PAYMENT HISTORY
router.get("/history/:order_id", (req, res) => {
  const { order_id } = req.params;

  const sql = `
    SELECT id, order_id, amount_paid, balance, status, due_date, created_at
    FROM payments
    WHERE order_id = ?
    ORDER BY created_at ASC
  `;

  req.db.query(sql, [order_id], (err, result) => {
    if (err) return res.status(500).json({ message: err.message });

    res.json({
      order_id,
      payments: result
    });
  });
});

// OVERDUE PAYMENTS
router.get("/overdue", (req, res) => {
  const sql = `
    SELECT 
      id,
      order_id,
      amount_paid,
      balance,
      status,
      due_date,
      created_at
    FROM payments
    WHERE due_date IS NOT NULL
    AND due_date < CURDATE()
    AND status != 'paid'
    ORDER BY due_date ASC
  `;

  req.db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ message: err.message });

    res.json({
      message: "Overdue payments fetched",
      count: result.length,
      overdue: result
    });
  });
});

// OVERDUE CHECK
router.get("/overdue-check", (req, res) => {
  const sql = `
    SELECT 
      *,
      CASE 
        WHEN due_date < CURDATE() AND status != 'paid' THEN 'OVERDUE'
        ELSE status
      END AS computed_status
    FROM payments
  `;

  req.db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ message: err.message });

    res.json(result);
  });
});

// ADMIN DASHBOARD - RECEIVABLES SUMMARY
router.get("/admin/receivables", (req, res) => {
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

    res.json({
      message: "Admin receivables dashboard",
      data: result[0]
    });
  });
});

// ADMIN DASHBOARD - RECEIVABLES SUMMARY PER CUSTOMER
router.get("/admin/receivables/per-customer", (req, res) => {
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

    res.json({
      message: "Per customer receivables",
      data: result
    });
  });
});

module.exports = router;

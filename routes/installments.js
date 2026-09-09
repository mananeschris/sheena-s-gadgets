const express = require("express");
const router = express.Router();
const { requireAdmin } = require("./roleGuard");
const { createNotification } = require("./notifications");
const { orderLabel } = require("./orderReference")

const TERMS = [3, 6, 12];
const STATUSES = ["pending", "approved", "rejected"];
const ONLINE_PAYMENT_METHODS = ["gcash", "maya", "card"];
const PAYMONGO_METHODS = {
  gcash: "gcash",
  maya: "paymaya",
  card: "card"
};

function dbQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function createNotificationAsync(db, payload) {
  return new Promise((resolve, reject) => {
    createNotification(db, payload, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

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

function scheduleRemaining(schedule) {
  return Math.max(Number(schedule.amount_due || 0) - Number(schedule.amount_paid || 0), 0);
}

function cleanText(value, maxLength = 1000) {
  return String(value || "").trim().slice(0, maxLength);
}

function baseUrl(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

async function createPaymongoDownpaymentCheckout(req, application) {
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey) {
    throw new Error("PayMongo sandbox key is not configured yet.");
  }

  const methodMap = {
    gcash: "gcash",
    maya: "paymaya",
    card: "card"
  };
  const method = methodMap[application.downpayment_method] || "gcash";
  const auth = Buffer.from(`${secretKey}:`).toString("base64");
  const origin = baseUrl(req);

  const payload = {
    data: {
      attributes: {
        description: `Installment downpayment for ${orderLabel(application.order_id)}`,
        line_items: [
          {
            name: `${orderLabel(application.order_id)} Downpayment`,
            quantity: 1,
            amount: Math.round(Number(application.downpayment_amount || 0) * 100),
            currency: "PHP"
          }
        ],
        payment_method_types: [method],
        reference_number: `ORDER-${application.order_id}`,
        send_email_receipt: false,
        show_description: true,
        show_line_items: true,
        success_url: `${origin}/payment-result.html?order_id=${application.order_id}&result=success`,
        cancel_url: `${origin}/payment-result.html?order_id=${application.order_id}&result=cancelled`
      }
    }
  };

  const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json();

  if (!response.ok) {
    const detail = data?.errors?.[0]?.detail || data?.errors?.[0]?.title || "PayMongo checkout creation failed";
    throw new Error(detail);
  }

  const checkout = data.data || {};
  const attributes = checkout.attributes || {};
  return {
    payment_reference: attributes.reference_number || `ORDER-${application.order_id}`,
    payment_checkout_id: checkout.id,
    payment_checkout_url: attributes.checkout_url
  };
}


async function createPaymongoScheduleCheckout(req, schedule, paymentMethod) {
  const auth = paymongoAuthHeader();
  if (!auth) throw new Error("PayMongo sandbox key is not configured yet.");

  const method = PAYMONGO_METHODS[paymentMethod] || "gcash";
  const amount = scheduleRemaining(schedule);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("This installment schedule has no remaining balance.");
  }

  const origin = baseUrl(req);
  const reference = `INST-SCHED-${schedule.id}`;
  const payload = {
    data: {
      attributes: {
        description: `${orderLabel(schedule.order_id)} installment ${schedule.installment_no}`,
        line_items: [
          {
            name: `${orderLabel(schedule.order_id)} Installment ${schedule.installment_no}`,
            quantity: 1,
            amount: Math.round(amount * 100),
            currency: "PHP"
          }
        ],
        payment_method_types: [method],
        reference_number: reference,
        send_email_receipt: false,
        show_description: true,
        show_line_items: true,
        success_url: `${origin}/payment-result.html?schedule_id=${schedule.id}&order_id=${schedule.order_id}&result=success`,
        cancel_url: `${origin}/payment-result.html?schedule_id=${schedule.id}&order_id=${schedule.order_id}&result=cancelled`
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
        Authorization: auth,
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
    payment_method: paymentMethod,
    payment_provider: "paymongo_installment_monthly",
    payment_reference: attributes.reference_number || reference,
    payment_checkout_id: checkout.id,
    payment_checkout_url: attributes.checkout_url
  };
}
function ensureInstallmentTable(db, callback) {
  const sql = `
    CREATE TABLE IF NOT EXISTS installment_applications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      order_id INT NULL,
      full_name VARCHAR(255) NOT NULL,
      birthday DATE NOT NULL,
      phone VARCHAR(50) NOT NULL,
      address TEXT NOT NULL,
      employment_status VARCHAR(80) NOT NULL,
      employer_name VARCHAR(255) NULL,
      monthly_income DECIMAL(12,2) NOT NULL DEFAULT 0,
      valid_id_type VARCHAR(80) NOT NULL,
      valid_id_number VARCHAR(120) NOT NULL,
      preferred_terms INT NOT NULL DEFAULT 3,
      requested_limit DECIMAL(12,2) NOT NULL DEFAULT 0,
      order_total DECIMAL(12,2) NOT NULL DEFAULT 0,
      downpayment_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      downpayment_method VARCHAR(40) NULL,
      downpayment_status VARCHAR(40) NOT NULL DEFAULT 'pending',
      financed_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      monthly_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      national_id_image TEXT NULL,
      selfie_with_id_image TEXT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      admin_note TEXT NULL,
      reviewed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_installment_user (user_id),
      INDEX idx_installment_status (status)
    )
  `;

  db.query(sql, (err) => {
    if (err) return callback(err);
    ensureInstallmentColumns(db, callback);
  });
}

function ensureInstallmentColumns(db, callback) {
  const columns = [
    ["order_id", "ADD COLUMN order_id INT NULL"],
    ["order_total", "ADD COLUMN order_total DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["downpayment_amount", "ADD COLUMN downpayment_amount DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["downpayment_method", "ADD COLUMN downpayment_method VARCHAR(40) NULL"],
    ["downpayment_status", "ADD COLUMN downpayment_status VARCHAR(40) NOT NULL DEFAULT 'pending'"],
    ["financed_amount", "ADD COLUMN financed_amount DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["monthly_amount", "ADD COLUMN monthly_amount DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["national_id_image", "ADD COLUMN national_id_image TEXT NULL"],
    ["selfie_with_id_image", "ADD COLUMN selfie_with_id_image TEXT NULL"]
  ];

  let index = 0;
  function next() {
    const item = columns[index];
    index += 1;
    if (!item) return callback();

    db.query(`SHOW COLUMNS FROM installment_applications LIKE '${item[0]}'`, (checkErr, rows) => {
      if (checkErr) return callback(checkErr);
      if (rows.length) return next();

      db.query(`ALTER TABLE installment_applications ${item[1]}`, (alterErr) => {
        if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") return callback(alterErr);
        next();
      });
    });
  }

  next();
}

function getAge(birthday) {
  const birthDate = new Date(birthday);
  if (Number.isNaN(birthDate.getTime())) return 0;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());

  if (!hasBirthdayPassed) age -= 1;
  return age;
}

router.use((req, res, next) => {
  ensureInstallmentTable(req.db, (err) => {
    if (err) return res.status(500).json({ message: err.message });
    ensureInstallmentScheduleTable(req.db, (scheduleErr) => {
      if (scheduleErr) return res.status(500).json({ message: scheduleErr.message });
      next();
    });
  });
});

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
      payment_method VARCHAR(40) NULL,
      payment_provider VARCHAR(80) NULL,
      payment_reference VARCHAR(255) NULL,
      payment_checkout_id VARCHAR(255) NULL,
      payment_checkout_url TEXT NULL,
      payment_status VARCHAR(40) NULL,
      payment_error TEXT NULL,
      payment_last_checked_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_schedule_order (order_id),
      INDEX idx_schedule_user (user_id),
      INDEX idx_schedule_status (status),
      INDEX idx_schedule_due (due_date)
    )
  `;

  db.query(sql, (err) => {
    if (err) return callback(err);
    ensureInstallmentScheduleColumns(db, callback);
  });
}

function ensureInstallmentScheduleColumns(db, callback) {
  const columns = [
    ["payment_method", "ADD COLUMN payment_method VARCHAR(40) NULL"],
    ["payment_provider", "ADD COLUMN payment_provider VARCHAR(80) NULL"],
    ["payment_reference", "ADD COLUMN payment_reference VARCHAR(255) NULL"],
    ["payment_checkout_id", "ADD COLUMN payment_checkout_id VARCHAR(255) NULL"],
    ["payment_checkout_url", "ADD COLUMN payment_checkout_url TEXT NULL"],
    ["payment_status", "ADD COLUMN payment_status VARCHAR(40) NULL"],
    ["payment_error", "ADD COLUMN payment_error TEXT NULL"],
    ["payment_last_checked_at", "ADD COLUMN payment_last_checked_at DATETIME NULL"]
  ];

  let index = 0;
  function next() {
    const item = columns[index];
    index += 1;
    if (!item) return callback();

    db.query(`SHOW COLUMNS FROM installment_schedules LIKE '${item[0]}'`, (checkErr, rows) => {
      if (checkErr) return callback(checkErr);
      if (rows.length) return next();

      db.query(`ALTER TABLE installment_schedules ${item[1]}`, (alterErr) => {
        if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") return callback(alterErr);
        next();
      });
    });
  }

  next();
}

function createInstallmentSchedule(db, application, callback) {
  db.query(
    "SELECT COUNT(*) AS total FROM installment_schedules WHERE application_id=?",
    [application.id],
    (countErr, countRows) => {
      if (countErr) return callback(countErr);
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

function refreshScheduleStatuses(db, callback) {
  const sql = `
    UPDATE installment_schedules
    SET status = 'overdue'
    WHERE status = 'unpaid'
      AND due_date < CURDATE()
      AND amount_paid < amount_due
  `;

  db.query(sql, callback);
}

router.post("/apply", (req, res) => {
  const {
    user_id,
    full_name,
    birthday,
    phone,
    address,
    employment_status,
    employer_name,
    monthly_income,
    valid_id_type,
    valid_id_number,
    preferred_terms,
    requested_limit
  } = req.body;

  const userId = Number(user_id);
  const terms = Number(preferred_terms);
  const income = Number(monthly_income);
  const limit = Number(requested_limit);

  if (!userId) return res.status(400).json({ message: "Customer account is required." });
  if (!full_name || !birthday || !phone || !address || !employment_status || !valid_id_type || !valid_id_number) {
    return res.status(400).json({ message: "Complete installment application details are required." });
  }
  if (getAge(birthday) < 18) {
    return res.status(400).json({ message: "Customer must be at least 18 years old to apply for installment." });
  }
  if (!Number.isFinite(income) || income < 5000) {
    return res.status(400).json({ message: "Monthly income must be at least PHP 5,000." });
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    return res.status(400).json({ message: "Requested installment limit is required." });
  }
  if (!TERMS.includes(terms)) {
    return res.status(400).json({ message: "Preferred terms must be 3, 6, or 12 months." });
  }

  const activeSql = `
    SELECT id, status
    FROM installment_applications
    WHERE user_id = ? AND status IN ('pending', 'approved')
    ORDER BY created_at DESC
    LIMIT 1
  `;

  req.db.query(activeSql, [userId], (activeErr, activeRows) => {
    if (activeErr) return res.status(500).json({ message: activeErr.message });

    if (activeRows.length) {
      const status = activeRows[0].status;
      return res.status(400).json({
        message: status === "approved"
          ? "You already have an approved installment application."
          : "You already have a pending installment application."
      });
    }

    const insertSql = `
      INSERT INTO installment_applications
      (user_id, full_name, birthday, phone, address, employment_status, employer_name, monthly_income, valid_id_type, valid_id_number, preferred_terms, requested_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    req.db.query(insertSql, [
      userId,
      cleanText(full_name, 255),
      birthday,
      cleanText(phone, 50),
      cleanText(address, 1000),
      cleanText(employment_status, 80),
      cleanText(employer_name, 255) || null,
      income,
      cleanText(valid_id_type, 80),
      cleanText(valid_id_number, 120),
      terms,
      limit
    ], (insertErr, result) => {
      if (insertErr) return res.status(500).json({ message: insertErr.message });
      res.json({
        message: "Installment application submitted for admin review.",
        application_id: result.insertId,
        status: "pending"
      });
    });
  });
});

router.get("/", requireAdmin, (req, res) => {
  const sql = `
    SELECT
      ia.*,
      u.name AS customer_name,
      u.email AS customer_email,
      o.payment_status AS order_payment_status,
      o.payment_checkout_url,
      p.name AS product_name
    FROM installment_applications ia
    LEFT JOIN users u ON ia.user_id = u.id
    LEFT JOIN orders o ON ia.order_id = o.id
    LEFT JOIN products p ON o.product_id = p.id
    ORDER BY
      CASE ia.status
        WHEN 'pending' THEN 1
        WHEN 'approved' THEN 2
        ELSE 3
      END,
      ia.created_at DESC
  `;

  req.db.query(sql, (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(rows);
  });
});

router.get("/customer/:user_id", (req, res) => {
  const sql = `
    SELECT *
    FROM installment_applications
    WHERE user_id = ?
    ORDER BY created_at DESC
  `;

  req.db.query(sql, [req.params.user_id], (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(rows);
  });
});

router.get("/customer/:user_id/approved", (req, res) => {
  const sql = `
    SELECT *
    FROM installment_applications
    WHERE user_id = ? AND status = 'approved'
    ORDER BY reviewed_at DESC, created_at DESC
    LIMIT 1
  `;

  req.db.query(sql, [req.params.user_id], (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json({
      approved: rows.length > 0,
      application: rows[0] || null
    });
  });
});

router.put("/:id/status", requireAdmin, (req, res) => {
  const { status, admin_note } = req.body;

  if (!STATUSES.includes(status)) {
    return res.status(400).json({ message: "Invalid installment application status." });
  }

  const sql = `
    UPDATE installment_applications
    SET status = ?, admin_note = ?, reviewed_at = NOW()
    WHERE id = ?
  `;

  req.db.query(sql, [status, cleanText(admin_note, 1000) || null, req.params.id], (err, result) => {
    if (err) return res.status(500).json({ message: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ message: "Application not found." });

    syncInstallmentOrderAfterReview(req, req.params.id, status, (syncErr) => {
      if (syncErr) return res.status(500).json({ message: syncErr.message });

      res.json({
        message: `Installment application ${status}.`,
        status
      });
    });
  });
});

function syncInstallmentOrderAfterReview(req, applicationId, status, callback) {
  const db = req.db;
  const sql = "SELECT * FROM installment_applications WHERE id = ?";

  db.query(sql, [applicationId], (err, rows) => {
    if (err) return callback(err);
    if (!rows.length || !rows[0].order_id) return callback();

    const application = rows[0];

    if (status === "rejected") {
      return db.query(
        "UPDATE orders SET payment_status=?, payment_error=?, payment_failed_at=COALESCE(payment_failed_at, NOW()) WHERE id=?",
        ["installment_rejected", application.admin_note || "Installment application rejected.", application.order_id],
        (updateErr) => {
          if (updateErr) return callback(updateErr);
          createNotification(db, {
            user_id: application.user_id,
            title: "Installment application rejected",
            message: `Your installment application for ${orderLabel(application.order_id)} was rejected. ${application.admin_note || ""}`.trim(),
            type: "installment",
            action_url: `/customer/order.html?order_id=${application.order_id}`
          }, callback);
        }
      );
    }

    if (status !== "approved") return callback();

    if (application.downpayment_status !== "paid") {
      return createPaymongoDownpaymentCheckout(req, application)
        .then((paymentInfo) => {
          db.query(
            `UPDATE orders
             SET payment_status=?, payment_provider=?, payment_reference=?, payment_checkout_id=?, payment_checkout_url=?, payment_error=NULL
             WHERE id=?`,
            [
              "installment_downpayment_pending",
              "paymongo_installment_downpayment",
              paymentInfo.payment_reference,
              paymentInfo.payment_checkout_id,
              paymentInfo.payment_checkout_url,
              application.order_id
            ],
            (updateErr) => {
              if (updateErr) return callback(updateErr);
              createNotification(db, {
                user_id: application.user_id,
                title: "Installment approved",
                message: `Your installment application for ${orderLabel(application.order_id)} was approved. You can now pay the downpayment.`,
                type: "installment",
                action_url: `/customer/order.html?order_id=${application.order_id}`
              }, callback);
            }
          );
        })
        .catch((error) => {
          db.query(
            "UPDATE orders SET payment_status=?, payment_provider=?, payment_error=?, payment_failed_at=COALESCE(payment_failed_at, NOW()) WHERE id=?",
            ["installment_downpayment_failed", "paymongo_installment_downpayment", error.message, application.order_id],
            callback
          );
        });
    }

    activateInstallmentOrder(db, application, callback);
  });
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
              message: `Your monthly installment schedule for ${orderLabel(application.order_id)} is now active.`,
              type: "installment",
              action_url: `/customer/order.html?order_id=${application.order_id}`
            }, next);
          });
        }
      );
    };

    if (paymentRows.length) {
      return updateOrder(callback);
    }

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

router.get("/schedules", requireAdmin, (req, res) => {
  refreshScheduleStatuses(req.db, (refreshErr) => {
    if (refreshErr) return res.status(500).json({ message: refreshErr.message });

    const sql = `
      SELECT
        s.*,
        ia.full_name,
        ia.monthly_amount,
        ia.financed_amount,
        u.email AS customer_email,
        p.name AS product_name
      FROM installment_schedules s
      LEFT JOIN installment_applications ia ON s.application_id = ia.id
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN orders o ON s.order_id = o.id
      LEFT JOIN products p ON o.product_id = p.id
      ORDER BY s.due_date ASC, s.installment_no ASC
    `;

    req.db.query(sql, (err, rows) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json(rows);
    });
  });
});

router.get("/customer/:user_id/schedules", (req, res) => {
  refreshScheduleStatuses(req.db, (refreshErr) => {
    if (refreshErr) return res.status(500).json({ message: refreshErr.message });

    const sql = `
      SELECT
        s.*,
        ia.full_name,
        ia.monthly_amount,
        ia.financed_amount,
        p.name AS product_name
      FROM installment_schedules s
      LEFT JOIN installment_applications ia ON s.application_id = ia.id
      LEFT JOIN orders o ON s.order_id = o.id
      LEFT JOIN products p ON o.product_id = p.id
      WHERE s.user_id = ?
      ORDER BY s.due_date ASC, s.installment_no ASC
    `;

    req.db.query(sql, [req.params.user_id], (err, rows) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json(rows);
    });
  });
});

async function loadScheduleWithDetails(db, scheduleId) {
  const rows = await dbQuery(db, `
    SELECT
      s.*,
      ia.status AS application_status,
      ia.downpayment_status,
      ia.full_name,
      u.email AS customer_email,
      p.name AS product_name
    FROM installment_schedules s
    LEFT JOIN installment_applications ia ON s.application_id = ia.id
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN orders o ON s.order_id = o.id
    LEFT JOIN products p ON o.product_id = p.id
    WHERE s.id=?
    LIMIT 1
  `, [scheduleId]);
  return rows[0] || null;
}

async function recordInstallmentLedger(db, schedule, appliedAmount) {
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

async function syncOrderInstallmentCompletionAsync(db, orderId) {
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
      SET payment_status=?, installment_balance=0, payment_completed_at=COALESCE(payment_completed_at, NOW())
      WHERE id=?
    `, ["installment_completed", orderId]);
    return;
  }

  await dbQuery(db, `
    UPDATE orders
    SET installment_balance=?, payment_status=IF(payment_status='installment_completed', 'installment_active', payment_status)
    WHERE id=?
  `, [remaining, orderId]);
}

async function markSchedulePaid(db, schedule, sourceLabel = "online") {
  const due = Number(schedule.amount_due || 0);
  const previousPaid = Number(schedule.amount_paid || 0);
  const appliedAmount = Math.max(due - previousPaid, 0);

  await dbQuery(db, `
    UPDATE installment_schedules
    SET amount_paid=?, status='paid', paid_at=COALESCE(paid_at, NOW()),
        payment_status='paid', payment_error=NULL, payment_last_checked_at=NOW()
    WHERE id=?
  `, [due, schedule.id]);

  await recordInstallmentLedger(db, schedule, appliedAmount);
  await syncOrderInstallmentCompletionAsync(db, schedule.order_id);
  await createNotificationAsync(db, {
    user_id: schedule.user_id,
    title: "Installment payment confirmed",
    message: `Installment ${schedule.installment_no} for ${orderLabel(schedule.order_id)} was marked paid via ${sourceLabel}.`,
    type: "payment",
    action_url: `/customer/order.html?order_id=${schedule.order_id}`
  });
}

router.post("/schedules/:id/checkout", async (req, res) => {
  const scheduleId = Number(req.params.id);
  const userId = Number(req.body.user_id || req.query.user_id);
  const method = String(req.body.method || req.query.method || "gcash").toLowerCase();

  if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
    return res.status(400).json({ message: "Valid installment schedule id is required." });
  }
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Signed-in customer is required." });
  }
  if (!ONLINE_PAYMENT_METHODS.includes(method)) {
    return res.status(400).json({ message: "Choose GCash, Maya, or card for installment payment." });
  }

  try {
    const schedule = await loadScheduleWithDetails(req.db, scheduleId);
    if (!schedule) return res.status(404).json({ message: "Installment schedule not found." });
    if (Number(schedule.user_id) !== userId) {
      return res.status(403).json({ message: "This installment schedule is not linked to your account." });
    }
    if (schedule.status === "paid" || scheduleRemaining(schedule) <= 0) {
      return res.status(400).json({ message: "This installment schedule is already paid." });
    }
    if (schedule.application_status !== "approved" || schedule.downpayment_status !== "paid") {
      return res.status(400).json({ message: "Installment schedule is not active yet." });
    }

    const checkout = await createPaymongoScheduleCheckout(req, schedule, method);
    await dbQuery(req.db, `
      UPDATE installment_schedules
      SET payment_method=?, payment_provider=?, payment_reference=?, payment_checkout_id=?, payment_checkout_url=?,
          payment_status='pending_verification', payment_error=NULL, payment_last_checked_at=NULL
      WHERE id=?
    `, [
      checkout.payment_method,
      checkout.payment_provider,
      checkout.payment_reference,
      checkout.payment_checkout_id,
      checkout.payment_checkout_url,
      schedule.id
    ]);

    res.json({
      message: "Installment payment checkout created.",
      schedule_id: schedule.id,
      order_id: schedule.order_id,
      amount: scheduleRemaining(schedule),
      payment_status: "pending_verification",
      payment_checkout_url: checkout.payment_checkout_url
    });
  } catch (error) {
    res.status(502).json({ message: error.message || "Unable to create installment payment checkout." });
  }
});

router.get("/schedules/:id/status", async (req, res) => {
  const scheduleId = Number(req.params.id);
  const userId = Number(req.query.user_id || req.body?.user_id || 0);
  const auth = paymongoAuthHeader();

  if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
    return res.status(400).json({ message: "Valid installment schedule id is required." });
  }

  try {
    const schedule = await loadScheduleWithDetails(req.db, scheduleId);
    if (!schedule) return res.status(404).json({ message: "Installment schedule not found." });
    if (userId && Number(schedule.user_id) !== userId) {
      return res.status(403).json({ message: "This installment schedule is not linked to your account." });
    }
    if (schedule.status === "paid") {
      return res.json({ schedule_id: schedule.id, order_id: schedule.order_id, status: "paid", payment_status: "paid" });
    }
    if (!schedule.payment_checkout_id) {
      return res.json({
        schedule_id: schedule.id,
        order_id: schedule.order_id,
        status: schedule.status || "unpaid",
        payment_status: schedule.payment_status || "not_started",
        needs_checkout: true,
        message: "No monthly payment checkout link is linked to this installment yet."
      });
    }
    if (!auth) {
      return res.json({
        schedule_id: schedule.id,
        order_id: schedule.order_id,
        status: schedule.status || "unpaid",
        payment_status: schedule.payment_status || "pending_verification",
        message: "PayMongo sandbox key is not configured yet."
      });
    }

    const response = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${schedule.payment_checkout_id}`, {
      headers: { Authorization: auth }
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = data?.errors?.[0]?.detail || data?.errors?.[0]?.title || "Unable to retrieve installment payment status";
      await dbQuery(req.db, "UPDATE installment_schedules SET payment_last_checked_at=NOW(), payment_error=? WHERE id=?", [detail, schedule.id]);
      return res.status(502).json({ message: detail });
    }

    const checkout = data.data || {};
    const attributes = checkout.attributes || {};
    const sourceStatus = normalizePaymongoStatus(checkout);

    if (sourceStatus === "paid") {
      await markSchedulePaid(req.db, schedule, "online payment");
      return res.json({
        schedule_id: schedule.id,
        order_id: schedule.order_id,
        source_status: sourceStatus,
        status: "paid",
        payment_status: "paid",
        checked_at: new Date().toISOString()
      });
    }

    const paymentStatus = sourceStatus === "expired"
      ? "expired"
      : sourceStatus === "failed" || sourceStatus === "cancelled"
        ? sourceStatus
        : "pending_verification";

    await dbQuery(req.db, `
      UPDATE installment_schedules
      SET payment_status=?, payment_reference=COALESCE(?, payment_reference), payment_checkout_url=COALESCE(?, payment_checkout_url),
          payment_error=?, payment_last_checked_at=NOW()
      WHERE id=?
    `, [
      paymentStatus,
      attributes.reference_number || schedule.payment_reference,
      attributes.checkout_url || schedule.payment_checkout_url,
      ["failed", "expired", "cancelled"].includes(paymentStatus) ? paymentStatus : null,
      schedule.id
    ]);

    res.json({
      schedule_id: schedule.id,
      order_id: schedule.order_id,
      source_status: sourceStatus,
      status: schedule.status || "unpaid",
      payment_status: paymentStatus,
      payment_checkout_url: attributes.checkout_url || schedule.payment_checkout_url,
      checked_at: new Date().toISOString()
    });
  } catch (error) {
    res.status(502).json({ message: error.message || "Unable to refresh installment payment status." });
  }
});
router.post("/schedules/:id/pay", requireAdmin, (req, res) => {
  const amount = Number(req.body.amount_paid);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: "Valid payment amount is required." });
  }

  req.db.query("SELECT * FROM installment_schedules WHERE id=?", [req.params.id], (selectErr, rows) => {
    if (selectErr) return res.status(500).json({ message: selectErr.message });
    if (!rows.length) return res.status(404).json({ message: "Installment schedule not found." });

    const schedule = rows[0];
    if (schedule.status === "paid") {
      return res.status(400).json({ message: "This installment schedule is already paid." });
    }

    const previousPaid = Number(schedule.amount_paid || 0);
    const newPaid = Math.min(previousPaid + amount, Number(schedule.amount_due || 0));
    const appliedAmount = Math.max(newPaid - previousPaid, 0);
    const status = newPaid >= Number(schedule.amount_due || 0) ? "paid" : "partial";

    req.db.query(
      `UPDATE installment_schedules
       SET amount_paid=?, status=?, paid_at=IF(?='paid', COALESCE(paid_at, NOW()), paid_at),
           payment_status=IF(?='paid', 'paid', payment_status), payment_error=NULL
       WHERE id=?`,
      [newPaid, status, status, status, schedule.id],
      async (updateErr) => {
        if (updateErr) return res.status(500).json({ message: updateErr.message });
        try {
          await recordInstallmentLedger(req.db, schedule, appliedAmount);
          await syncOrderInstallmentCompletionAsync(req.db, schedule.order_id);
          createNotification(req.db, {
            user_id: schedule.user_id,
            title: "Installment payment recorded",
            message: `Payment for installment ${schedule.installment_no} on ${orderLabel(schedule.order_id)} was recorded.`,
            type: "payment",
            action_url: `/customer/order.html?order_id=${schedule.order_id}`
          });
          res.json({
            message: "Installment payment recorded.",
            schedule_id: schedule.id,
            amount_paid: newPaid,
            status
          });
        } catch (syncErr) {
          res.status(500).json({ message: syncErr.message });
        }
      }
    );
  });
});

function syncOrderInstallmentCompletion(db, orderId, callback) {
  syncOrderInstallmentCompletionAsync(db, orderId)
    .then(() => callback())
    .catch(callback);
}

module.exports = router;

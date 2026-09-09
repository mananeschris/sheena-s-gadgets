const express = require("express");
const router = express.Router();
const { requireAdmin, verifiedActor } = require("./roleGuard");
const { logAudit, auditActor } = require("./auditLogs");
const { createNotification } = require("./notifications");
const { logInventoryMovementAsync } = require("./inventoryMovements");
const LAYAWAY_TERM_MONTHS = 5;
const LAYAWAY_AUTO_CANCEL_REASON = "Auto-cancelled after 5-month layaway deadline.";
const SYSTEM_ACTOR = {
  actor_id: null,
  actor_name: "System",
  actor_role: "system"
};

function dbQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, result) => err ? reject(err) : resolve(result));
  });
}

function beginTransaction(db) {
  return new Promise((resolve, reject) => db.beginTransaction(err => err ? reject(err) : resolve()));
}

function commitTransaction(db) {
  return new Promise((resolve, reject) => db.commit(err => err ? reject(err) : resolve()));
}

function rollbackTransaction(db) {
  return new Promise(resolve => db.rollback(() => resolve()));
}

function duplicateColumn(error) {
  return error?.code === "ER_DUP_FIELDNAME" || /duplicate column/i.test(error?.message || "");
}

async function ensureColumn(db, table, column, definition) {
  const rows = await dbQuery(db, `SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  if (rows.length) return;
  try {
    await dbQuery(db, `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  } catch (error) {
    if (!duplicateColumn(error)) throw error;
  }
}

async function ensureLayawayTables(db) {
  await dbQuery(db, `
    CREATE TABLE IF NOT EXISTS layaways (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customer_id INT NULL,
      customer_name VARCHAR(255) NOT NULL,
      customer_phone VARCHAR(80) NULL,
      customer_email VARCHAR(255) NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      variant_index INT NULL,
      variant_name VARCHAR(255) NULL,
      quantity INT NOT NULL DEFAULT 1,
      unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
      balance DECIMAL(12,2) NOT NULL DEFAULT 0,
      payment_method VARCHAR(60) NULL,
      payment_reference VARCHAR(255) NULL,
      due_date DATE NULL,
      term_months INT NOT NULL DEFAULT 5,
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      note TEXT NULL,
      released_at DATETIME NULL,
      cancelled_at DATETIME NULL,
      cancel_reason TEXT NULL,
      created_by INT NULL,
      created_by_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_layaway_customer (customer_id),
      INDEX idx_layaway_product (product_id),
      INDEX idx_layaway_status (status),
      INDEX idx_layaway_due (due_date)
    )
  `);

  const columns = [
    ["customer_id", "INT NULL"],
    ["customer_name", "VARCHAR(255) NULL"],
    ["customer_phone", "VARCHAR(80) NULL"],
    ["customer_email", "VARCHAR(255) NULL"],
    ["product_id", "INT NULL"],
    ["product_name", "VARCHAR(255) NULL"],
    ["variant_index", "INT NULL"],
    ["variant_name", "VARCHAR(255) NULL"],
    ["quantity", "INT NOT NULL DEFAULT 1"],
    ["unit_price", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["total_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["amount_paid", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["balance", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["payment_method", "VARCHAR(60) NULL"],
    ["payment_reference", "VARCHAR(255) NULL"],
    ["due_date", "DATE NULL"],
    ["term_months", "INT NOT NULL DEFAULT 5"],
    ["status", "VARCHAR(30) NOT NULL DEFAULT 'active'"],
    ["note", "TEXT NULL"],
    ["released_at", "DATETIME NULL"],
    ["cancelled_at", "DATETIME NULL"],
    ["cancel_reason", "TEXT NULL"],
    ["created_by", "INT NULL"],
    ["created_by_name", "VARCHAR(255) NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"],
    ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
  ];
  for (const [column, definition] of columns) {
    await ensureColumn(db, "layaways", column, definition);
  }

  await dbQuery(db, `
    CREATE TABLE IF NOT EXISTS layaway_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      layaway_id INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      payment_method VARCHAR(60) NULL,
      payment_reference VARCHAR(255) NULL,
      note TEXT NULL,
      received_by INT NULL,
      received_by_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_layaway_payment_layaway (layaway_id),
      INDEX idx_layaway_payment_created (created_at)
    )
  `);

  const paymentColumns = [
    ["layaway_id", "INT NULL"],
    ["amount", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["payment_method", "VARCHAR(60) NULL"],
    ["payment_reference", "VARCHAR(255) NULL"],
    ["note", "TEXT NULL"],
    ["received_by", "INT NULL"],
    ["received_by_name", "VARCHAR(255) NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ];
  for (const [column, definition] of paymentColumns) {
    await ensureColumn(db, "layaway_payments", column, definition);
  }
  await backfillLayawayDeadlines(db);
}

async function backfillLayawayDeadlines(db) {
  await dbQuery(db, "UPDATE layaways SET term_months=? WHERE term_months IS NULL OR term_months <= 0", [LAYAWAY_TERM_MONTHS]);
  await dbQuery(db, `UPDATE layaways SET due_date=DATE_ADD(DATE(COALESCE(created_at, NOW())), INTERVAL ${LAYAWAY_TERM_MONTHS} MONTH) WHERE due_date IS NULL`);
}
function httpStatusForError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("not found")) return 404;
  if (/required|valid|select|cannot|must|only|already|greater|available|deadline/.test(message)) return 400;
  return 500;
}
function cleanText(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function cleanMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(number, 0) : 0;
}

function cleanQuantity(value) {
  const qty = Number(value || 1);
  return Number.isInteger(qty) && qty > 0 ? qty : 1;
}

function dateInputValue(date) {
  return date.toISOString().slice(0, 10);
}

function addMonths(date, months) {
  const result = new Date(date.getTime());
  const targetDay = result.getDate();
  result.setMonth(result.getMonth() + months);
  if (result.getDate() < targetDay) result.setDate(0);
  return result;
}

function layawayDeadlineDate() {
  return dateInputValue(addMonths(new Date(), LAYAWAY_TERM_MONTHS));
}
function cleanDate(value) {
  const text = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function parseVariants(value) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function variantLabel(variant, index) {
  return cleanText(variant?.name, 255) || `Variant ${index + 1}`;
}

function layawayStatus(balance, dueDate, currentStatus = "active") {
  const status = cleanText(currentStatus, 30).toLowerCase();
  if (["released", "cancelled"].includes(status)) return status;
  if (balance <= 0) return "paid";
  return "active";
}

function paymentStatusAmount(row) {
  return Math.max(Number(row.total_amount || 0) - Number(row.amount_paid || 0), 0);
}

function dateOnlyValue(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function daysUntilDeadline(row) {
  const dueDate = dateOnlyValue(row?.due_date);
  if (!dueDate) return null;
  return Math.ceil((dueDate.getTime() - todayStart().getTime()) / 86400000);
}

function isPastLayawayDeadline(row) {
  const days = daysUntilDeadline(row);
  return days !== null && days < 0;
}

function isDeadlineSoon(row) {
  const days = daysUntilDeadline(row);
  const status = cleanText(row?.status, 30).toLowerCase();
  return days !== null && days >= 0 && days <= 14 && paymentStatusAmount(row) > 0 && ["active", "overdue"].includes(status);
}

function isAutoCancelableLayaway(row) {
  const status = cleanText(row?.status, 30).toLowerCase();
  return ["active", "overdue"].includes(status) && paymentStatusAmount(row) > 0 && isPastLayawayDeadline(row);
}

async function autoCancelExpiredLayaways(db) {
  const expired = await dbQuery(db, `
    SELECT *
    FROM layaways
    WHERE status IN ('active', 'overdue')
      AND balance > 0
      AND due_date IS NOT NULL
      AND due_date < CURDATE()
    ORDER BY due_date ASC, id ASC
  `);

  const cancelled = [];
  for (const candidate of expired) {
    try {
      await beginTransaction(db);
      const rows = await dbQuery(db, "SELECT * FROM layaways WHERE id=? FOR UPDATE", [candidate.id]);
      const layaway = rows[0];
      if (!layaway || !isAutoCancelableLayaway(layaway)) {
        await rollbackTransaction(db);
        continue;
      }

      const restoreReport = await restoreStock(db, layaway, SYSTEM_ACTOR);
      await dbQuery(db, `
        UPDATE layaways
        SET status='cancelled',
            cancelled_at=COALESCE(cancelled_at, NOW()),
            cancel_reason=COALESCE(NULLIF(cancel_reason, ''), ?)
        WHERE id=?
      `, [LAYAWAY_AUTO_CANCEL_REASON, layaway.id]);
      await commitTransaction(db);

      logAudit(db, {
        ...SYSTEM_ACTOR,
        action: "auto_cancel_layaway",
        entity_type: "layaway",
        entity_id: layaway.id,
        details: `${layaway.customer_name || "Customer"} | ${layaway.product_name} | 5-month deadline reached | restored ${restoreReport.quantity || 0}`
      });
      notifyCustomer(db, layaway, `Layaway #${layaway.id} cancelled`, `Your layaway for ${layaway.product_name} was automatically cancelled because it was not fully paid within 5 months.`);
      cancelled.push({ id: layaway.id, restored_quantity: restoreReport.quantity || 0 });
    } catch (error) {
      await rollbackTransaction(db);
    }
  }
  return cancelled;
}

async function refreshLayawayStatuses(db) {
  await dbQuery(db, `
    UPDATE layaways
    SET status='paid', balance=0
    WHERE status IN ('active', 'overdue')
      AND balance <= 0
  `);
  await autoCancelExpiredLayaways(db);
}

async function loadLayaways(db) {
  await ensureLayawayTables(db);
  await refreshLayawayStatuses(db);
  const rows = await dbQuery(db, `
    SELECT
      l.*,
      u.name AS account_name,
      u.email AS account_email,
      p.stock AS current_product_stock
    FROM layaways l
    LEFT JOIN users u ON u.id = l.customer_id
    LEFT JOIN products p ON p.id = l.product_id
    ORDER BY
      CASE l.status
        WHEN 'active' THEN 0
        WHEN 'paid' THEN 1
        WHEN 'released' THEN 2
        WHEN 'cancelled' THEN 3
        ELSE 4
      END,
      l.due_date IS NULL,
      l.due_date ASC,
      l.id DESC
  `);

  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const payments = await dbQuery(db, `
    SELECT *
    FROM layaway_payments
    WHERE layaway_id IN (?)
    ORDER BY created_at DESC, id DESC
  `, [ids]);
  const byLayaway = payments.reduce((map, payment) => {
    if (!map[payment.layaway_id]) map[payment.layaway_id] = [];
    map[payment.layaway_id].push(payment);
    return map;
  }, {});

  return rows.map(row => {
    const balance = paymentStatusAmount(row);
    return {
      ...row,
      balance,
      status_label: layawayStatus(balance, row.due_date, row.status),
      days_left: daysUntilDeadline(row),
      deadline_soon: isDeadlineSoon(row),
      payments: byLayaway[row.id] || []
    };
  });
}

function buildSummary(items) {
  const active = items.filter(item => !["released", "cancelled"].includes(item.status_label));
  return {
    total_count: items.length,
    active_count: active.filter(item => item.status_label === "active").length,
    deadline_soon_count: active.filter(isDeadlineSoon).length,
    overdue_count: 0,
    paid_count: active.filter(item => item.status_label === "paid").length,
    released_count: items.filter(item => item.status_label === "released").length,
    cancelled_count: items.filter(item => item.status_label === "cancelled").length,
    outstanding_balance: active.reduce((sum, item) => sum + Number(item.balance || 0), 0),
    ready_release_count: active.filter(item => item.status_label === "paid").length,
    term_months: LAYAWAY_TERM_MONTHS
  };
}
function actorFor(req) {
  return verifiedActor(req, auditActor(req));
}

function notifyCustomer(db, layaway, title, message) {
  if (!layaway?.customer_id) return;
  createNotification(db, {
    user_id: layaway.customer_id,
    title,
    message,
    type: "payment",
    action_url: "/customer/profile.html"
  });
}

async function reserveStock(db, input, actor) {
  const productId = Number(input.product_id);
  const quantity = cleanQuantity(input.quantity);
  const variantIndex = input.variant_index === undefined || input.variant_index === null || input.variant_index === ""
    ? null
    : Number(input.variant_index);

  if (!productId) throw new Error("Product is required.");
  const rows = await dbQuery(db, "SELECT * FROM products WHERE id=? FOR UPDATE", [productId]);
  if (!rows.length) throw new Error("Product not found.");

  const product = rows[0];
  const variants = parseVariants(product.variants);
  let variant = null;
  if (variants.length) {
    if (!Number.isInteger(variantIndex) || !variants[variantIndex]) {
      throw new Error("Please select a valid product variant for this layaway.");
    }
    variant = variants[variantIndex];
  }

  const stockBefore = Number(variant ? variant.stock : product.stock || 0);
  const unitPrice = cleanMoney(variant ? variant.price : product.price);
  if (quantity > stockBefore) throw new Error(`Only ${stockBefore} item(s) available for ${product.name}.`);

  if (variant) {
    variants[variantIndex].stock = stockBefore - quantity;
    const updated = await dbQuery(
      db,
      "UPDATE products SET stock = stock - ?, variants = ? WHERE id = ? AND stock >= ?",
      [quantity, JSON.stringify(variants), productId, quantity]
    );
    if (!updated.affectedRows) throw new Error(`Not enough stock available for ${product.name}.`);
  } else {
    const updated = await dbQuery(
      db,
      "UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?",
      [quantity, productId, quantity]
    );
    if (!updated.affectedRows) throw new Error(`Not enough stock available for ${product.name}.`);
  }

  return {
    product_id: productId,
    product_name: product.name,
    variant_index: variant ? variantIndex : null,
    variant_name: variant ? variantLabel(variant, variantIndex) : null,
    quantity,
    unit_price: unitPrice,
    stock_before: stockBefore,
    stock_after: stockBefore - quantity,
    movement: {
      ...actor,
      product_id: productId,
      product_name: product.name,
      variant_index: variant ? variantIndex : null,
      variant_name: variant ? variantLabel(variant, variantIndex) : null,
      movement_type: "layaway_reserve",
      quantity_change: -quantity,
      quantity_before: stockBefore,
      quantity_after: stockBefore - quantity,
      source: "layaway",
      note: "Stock reserved for admin layaway."
    }
  };
}

async function restoreStock(db, layaway, actor) {
  const productId = Number(layaway.product_id);
  const quantity = cleanQuantity(layaway.quantity);
  const rows = await dbQuery(db, "SELECT * FROM products WHERE id=? FOR UPDATE", [productId]);
  if (!rows.length) return { restored: false, quantity: 0 };

  const product = rows[0];
  const variants = parseVariants(product.variants);
  const variantIndex = layaway.variant_index === null || layaway.variant_index === undefined ? null : Number(layaway.variant_index);
  const variant = Number.isInteger(variantIndex) ? variants[variantIndex] : null;
  const stockBefore = Number(variant ? variant.stock : product.stock || 0);
  const stockAfter = stockBefore + quantity;

  if (variant) {
    variants[variantIndex].stock = stockAfter;
    await dbQuery(db, "UPDATE products SET stock = stock + ?, variants = ? WHERE id = ?", [quantity, JSON.stringify(variants), productId]);
  } else {
    await dbQuery(db, "UPDATE products SET stock = stock + ? WHERE id = ?", [quantity, productId]);
  }

  await logInventoryMovementAsync(db, {
    ...actor,
    product_id: productId,
    product_name: layaway.product_name || product.name,
    variant_index: variant ? variantIndex : null,
    variant_name: variant ? variantLabel(variant, variantIndex) : layaway.variant_name,
    movement_type: "layaway_cancel_restore",
    quantity_change: quantity,
    quantity_before: stockBefore,
    quantity_after: stockAfter,
    source: "layaway",
    note: `Stock restored after cancelling Layaway #${layaway.id}.`
  });

  return { restored: true, quantity };
}

router.get("/", requireAdmin, async (req, res) => {
  try {
    const items = await loadLayaways(req.db);
    res.json({ summary: buildSummary(items), items });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load layaways." });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  const actor = actorFor(req);
  const customerId = Number(req.body.customer_id || 0) || null;
  const customerName = cleanText(req.body.customer_name, 255);
  const customerPhone = cleanText(req.body.customer_phone, 80);
  const customerEmail = cleanText(req.body.customer_email, 255);
  const downpayment = cleanMoney(req.body.downpayment_amount);
  const dueDate = layawayDeadlineDate();
  const note = cleanText(req.body.note, 1000);
  const paymentMethod = cleanText(req.body.payment_method, 60);
  const paymentReference = cleanText(req.body.payment_reference, 255);

  if (!customerId && !customerName) {
    return res.status(400).json({ message: "Customer name or linked customer account is required." });
  }

  try {
    await ensureLayawayTables(req.db);
    await beginTransaction(req.db);

    let account = null;
    if (customerId) {
      const accounts = await dbQuery(req.db, "SELECT id, name, email, phone FROM users WHERE id=? LIMIT 1", [customerId]);
      if (!accounts.length) throw new Error("Linked customer account not found.");
      account = accounts[0];
    }

    const reserved = await reserveStock(req.db, req.body, actor);
    const totalAmount = reserved.unit_price * reserved.quantity;
    if (downpayment > totalAmount) throw new Error("Downpayment cannot be greater than layaway total.");

    const amountPaid = downpayment;
    const balance = Math.max(totalAmount - amountPaid, 0);
    const status = layawayStatus(balance, dueDate);
    const insert = await dbQuery(req.db, `
      INSERT INTO layaways
      (customer_id, customer_name, customer_phone, customer_email, product_id, product_name, variant_index, variant_name,
       quantity, unit_price, total_amount, amount_paid, balance, payment_method, payment_reference, due_date, term_months, status, note, created_by, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      customerId,
      customerName || account?.name || "Customer",
      customerPhone || account?.phone || null,
      customerEmail || account?.email || null,
      reserved.product_id,
      reserved.product_name,
      reserved.variant_index,
      reserved.variant_name,
      reserved.quantity,
      reserved.unit_price,
      totalAmount,
      amountPaid,
      balance,
      paymentMethod || null,
      paymentReference || null,
      dueDate,
      LAYAWAY_TERM_MONTHS,
      status,
      note || null,
      actor.actor_id || null,
      actor.actor_name || null
    ]);

    if (downpayment > 0) {
      await dbQuery(req.db, `
        INSERT INTO layaway_payments
        (layaway_id, amount, payment_method, payment_reference, note, received_by, received_by_name)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        insert.insertId,
        downpayment,
        paymentMethod || "manual",
        paymentReference || null,
        "Initial layaway downpayment.",
        actor.actor_id || null,
        actor.actor_name || null
      ]);
    }

    await logInventoryMovementAsync(req.db, { ...reserved.movement, note: `Stock reserved for Layaway #${insert.insertId}.` });
    logAudit(req.db, {
      ...actor,
      action: "create_layaway",
      entity_type: "layaway",
      entity_id: insert.insertId,
      details: `${customerName || account?.name || "Customer"} | ${reserved.product_name} | qty ${reserved.quantity} | balance ${balance.toFixed(2)}`
    });

    await commitTransaction(req.db);

    notifyCustomer(req.db, {
      id: insert.insertId,
      customer_id: customerId
    }, `Layaway #${insert.insertId} created`, `Your layaway for ${reserved.product_name} has been recorded. Please complete payment within 5 months. Deadline: ${dueDate}. Remaining balance: PHP ${balance.toFixed(2)}.`);

    res.json({
      message: "Layaway created and stock reserved.",
      id: insert.insertId,
      total_amount: totalAmount,
      amount_paid: amountPaid,
      balance,
      status,
      term_months: LAYAWAY_TERM_MONTHS,
      due_date: dueDate
    });
  } catch (error) {
    await rollbackTransaction(req.db);
    res.status(httpStatusForError(error)).json({ message: error.message || "Unable to create layaway." });
  }
});

router.post("/:id/payments", requireAdmin, async (req, res) => {
  const amount = cleanMoney(req.body.amount);
  const paymentMethod = cleanText(req.body.payment_method, 60) || "manual";
  const paymentReference = cleanText(req.body.payment_reference, 255);
  const note = cleanText(req.body.note, 1000);
  const actor = actorFor(req);

  if (amount <= 0) return res.status(400).json({ message: "Payment amount is required." });

  try {
    await ensureLayawayTables(req.db);
    await autoCancelExpiredLayaways(req.db);
    await beginTransaction(req.db);
    const rows = await dbQuery(req.db, "SELECT * FROM layaways WHERE id=? FOR UPDATE", [req.params.id]);
    if (!rows.length) throw new Error("Layaway not found.");

    const layaway = rows[0];
    if (["released", "cancelled"].includes(layaway.status)) {
      throw new Error("This layaway is already closed.");
    }

    const currentBalance = paymentStatusAmount(layaway);
    const appliedAmount = Math.min(amount, currentBalance);
    if (appliedAmount <= 0) throw new Error("This layaway is already fully paid.");

    const nextPaid = Number(layaway.amount_paid || 0) + appliedAmount;
    const nextBalance = Math.max(Number(layaway.total_amount || 0) - nextPaid, 0);
    const nextStatus = layawayStatus(nextBalance, layaway.due_date, layaway.status);

    await dbQuery(req.db, `
      INSERT INTO layaway_payments
      (layaway_id, amount, payment_method, payment_reference, note, received_by, received_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      layaway.id,
      appliedAmount,
      paymentMethod,
      paymentReference || null,
      note || null,
      actor.actor_id || null,
      actor.actor_name || null
    ]);

    await dbQuery(req.db, `
      UPDATE layaways
      SET amount_paid=?, balance=?, status=?
      WHERE id=?
    `, [nextPaid, nextBalance, nextStatus, layaway.id]);

    logAudit(req.db, {
      ...actor,
      action: "record_layaway_payment",
      entity_type: "layaway",
      entity_id: layaway.id,
      details: `${layaway.customer_name || "Customer"} | payment ${appliedAmount.toFixed(2)} | balance ${nextBalance.toFixed(2)}`
    });

    await commitTransaction(req.db);

    notifyCustomer(req.db, layaway, `Layaway #${layaway.id} payment recorded`, `Payment received: PHP ${appliedAmount.toFixed(2)}. Remaining balance: PHP ${nextBalance.toFixed(2)}.`);
    res.json({ message: "Layaway payment recorded.", amount: appliedAmount, balance: nextBalance, status: nextStatus });
  } catch (error) {
    await rollbackTransaction(req.db);
    res.status(httpStatusForError(error)).json({ message: error.message || "Unable to record payment." });
  }
});

router.post("/:id/release", requireAdmin, async (req, res) => {
  const actor = actorFor(req);
  try {
    await ensureLayawayTables(req.db);
    await autoCancelExpiredLayaways(req.db);
    const rows = await dbQuery(req.db, "SELECT * FROM layaways WHERE id=?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: "Layaway not found." });

    const layaway = rows[0];
    const balance = paymentStatusAmount(layaway);
    if (layaway.status === "cancelled") return res.status(400).json({ message: "Cancelled layaway cannot be released." });
    if (layaway.status === "released") return res.json({ message: "Layaway already released.", status: "released" });
    if (balance > 0) return res.status(400).json({ message: "Layaway must be fully paid before item release." });

    await dbQuery(req.db, "UPDATE layaways SET status='released', released_at=NOW(), balance=0 WHERE id=?", [layaway.id]);
    logAudit(req.db, {
      ...actor,
      action: "release_layaway",
      entity_type: "layaway",
      entity_id: layaway.id,
      details: `${layaway.customer_name || "Customer"} | ${layaway.product_name} released`
    });
    notifyCustomer(req.db, layaway, `Layaway #${layaway.id} released`, `Your layaway item ${layaway.product_name} is now released.`);
    res.json({ message: "Layaway item released.", status: "released" });
  } catch (error) {
    res.status(httpStatusForError(error)).json({ message: error.message || "Unable to release layaway." });
  }
});

router.post("/:id/cancel", requireAdmin, async (req, res) => {
  const actor = actorFor(req);
  const reason = cleanText(req.body.reason, 1000) || "Cancelled by admin.";

  try {
    await ensureLayawayTables(req.db);
    await autoCancelExpiredLayaways(req.db);
    await beginTransaction(req.db);
    const rows = await dbQuery(req.db, "SELECT * FROM layaways WHERE id=? FOR UPDATE", [req.params.id]);
    if (!rows.length) throw new Error("Layaway not found.");

    const layaway = rows[0];
    if (layaway.status === "released") throw new Error("Released layaway cannot be cancelled.");
    if (layaway.status === "cancelled") throw new Error("Layaway is already cancelled.");

    const restoreReport = await restoreStock(req.db, layaway, actor);
    await dbQuery(req.db, `
      UPDATE layaways
      SET status='cancelled', cancelled_at=NOW(), cancel_reason=?
      WHERE id=?
    `, [reason, layaway.id]);

    logAudit(req.db, {
      ...actor,
      action: "cancel_layaway",
      entity_type: "layaway",
      entity_id: layaway.id,
      details: `${layaway.customer_name || "Customer"} | ${layaway.product_name} | restored ${restoreReport.quantity || 0} | ${reason}`
    });

    await commitTransaction(req.db);

    notifyCustomer(req.db, layaway, `Layaway #${layaway.id} cancelled`, `Your layaway for ${layaway.product_name} was cancelled. Please contact the shop for payment handling.`);
    res.json({ message: "Layaway cancelled and stock restored.", status: "cancelled", restored_quantity: restoreReport.quantity || 0 });
  } catch (error) {
    await rollbackTransaction(req.db);
    res.status(httpStatusForError(error)).json({ message: error.message || "Unable to cancel layaway." });
  }
});

module.exports = router;
module.exports.ensureLayawayTables = ensureLayawayTables;

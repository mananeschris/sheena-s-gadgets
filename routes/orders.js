
const express = require("express");
const router = express.Router();
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const uploadStorage = require('../services/uploadStorage');
const { createNotification } = require("./notifications");
const { logAudit, auditActor } = require("./auditLogs");
const { requireAdmin, requireAdminOrStaff } = require("./roleGuard");
const { customerSession, orderSession, customerIdentity } = require('./customerAccess');
const { ensureOrderCoreColumns } = require("./orderSchema");
const { orderLabel } = require("./orderReference");
const { attachOrderDeliveryDetails } = require("./orderDeliveryDetails");
const { restoreOrderStock } = require("./stockRestore");
const { logInventoryMovement, logInventoryMovementAsync } = require("./inventoryMovements");
const { ensureVoucherTables, validateVoucher, recordVoucherRedemption } = require("./voucherService");

const ORDER_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled"];
const ORDER_STATUS_LABELS = {
  pending: "Order Placed",
  processing: "Processing",
  shipped: "Ready",
  delivered: "Completed",
  cancelled: "Cancelled"
};
const ORDER_STATUS_TRANSITIONS = {
  pending: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: []
};
const ONLINE_PAYMENT_METHODS = ["gcash"];
const INSTALLMENT_PAYMENT_METHOD = "installment";
const INSTALLMENT_TERMS = [3, 6, 12];
const SHIPPING_RATES = {
  local: { label: "Local / Nearby Sogod-Bacacay", min: 0, mid: 0, max: 0 },
  luzon: { label: "Luzon", min: 180, mid: 200, max: 220 },
  visayas: { label: "Visayas", min: 190, mid: 230, max: 270 }
};
const FULFILLABLE_PAYMENT_STATUSES = new Set([
  "to_collect",
  "paid",
  "installment_downpayment_paid",
  "installment_active",
  "installment_completed"
]);

function inventoryActor(req, userId, fallbackName, fallbackRole = "customer") {
  if (req.actorUser) return { actor_id: req.actorUser.id, actor_name: req.actorUser.name, actor_role: req.actorUser.role };
  return {
    actor_id: req.body?.actor_id || req.query?.actor_id || userId || null,
    actor_name: req.body?.actor_name || req.query?.actor_name || fallbackName || "Customer",
    actor_role: req.body?.actor_role || req.query?.actor_role || fallbackRole
  };
}

function normalizePaymentMethod(method, options = {}) {
  const value = String(method || "").trim().toLowerCase();
  const allowOffline = options.allowOffline !== false;
  const allowInstallment = options.allowInstallment !== false;
  const allowCash = Boolean(options.allowCash);

  if (ONLINE_PAYMENT_METHODS.includes(value)) return "gcash";
  if (["online", "e-wallet", "ewallet"].includes(value)) return "gcash";
  if (allowInstallment && value === INSTALLMENT_PAYMENT_METHOD) return INSTALLMENT_PAYMENT_METHOD;
  if (allowOffline && value === "cod") return "cod";
  if (allowOffline && allowCash && value === "cash") return "cash";
  if (value && !["cod", "cash", INSTALLMENT_PAYMENT_METHOD, "manual", "pos"].includes(value)) return "gcash";
  return "";
}

function paymentReadyForFulfillment(order) {
  const method = String(order.payment_method || "cod").toLowerCase();
  const provider = String(order.payment_provider || "").toLowerCase();
  const status = String(order.payment_status || (method === "cod" ? "to_collect" : "")).toLowerCase();

  if (provider === "pos" || method === "cash") return true;
  if (method === "cod" || provider === "cod") return status === "to_collect" || status === "paid";
  return FULFILLABLE_PAYMENT_STATUSES.has(status);
}

function paymentBlockMessage(order) {
  const status = String(order.payment_status || "").toLowerCase();
  const method = String(order.payment_method || "").toLowerCase();

  if (method === "installment" && status === "installment_application_pending") {
    return "Installment application must be approved before this order can be processed.";
  }
  if (status === "for_verification") {
    return "Check the submitted GCash proof before processing this order.";
  }
  if (status === "pending_payment") {
    return "Wait for the customer to submit GCash payment proof before processing this order.";
  }
  if (status === "rejected") {
    return "Customer needs to upload GCash proof before this order can be processed.";
  }
  return "Payment must be verified before this order can be processed.";
}

function inventoryMovementFromOrderLine(item, orderId, actor, source, movementType) {
  return {
    ...actor,
    product_id: item.product_id,
    product_name: item.product_name,
    variant_index: item.variant_index,
    variant_name: item.variant_name,
    order_id: orderId,
    movement_type: movementType,
    quantity_change: -Math.abs(Number(item.quantity || 0)),
    quantity_before: item.stock_before,
    quantity_after: item.stock_after,
    source,
    note: `${source === "pos" ? "POS sale" : "Checkout order"} ${orderLabel(orderId)}`
  };
}

function recordInventoryMovements(db, movements, callback) {
  let index = 0;
  function next(err) {
    if (err) return callback(err);
    const movement = movements[index];
    index += 1;
    if (!movement) return callback();
    logInventoryMovement(db, movement, next);
  }
  next();
}

async function recordInventoryMovementsAsync(db, movements) {
  for (const movement of movements) {
    await logInventoryMovementAsync(db, movement);
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (file.fieldname === "payment_proof") {
        const directory = uploadStorage.paymentProofs;
        fs.mkdirSync(directory, { recursive: true });
        return cb(null, directory);
      }
      fs.mkdirSync(uploadStorage.orderDocuments, { recursive: true });
      cb(null, uploadStorage.orderDocuments);
    },
    filename: (req, file, cb) => {
      const extension = path.extname(file.originalname || "").toLowerCase();
      const safeExtension = [".jpg", ".jpeg", ".png", ".webp"].includes(extension) ? extension : ".jpg";
      const prefix = file.fieldname === "payment_proof" ? "gcash-" : "";
      cb(null, `${prefix}${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExtension}`);
    }
  }),
  limits: { files: 3, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      return cb(new Error("Payment proof must be JPG, PNG, or WEBP."));
    }
    cb(null, true);
  }
});

function uploadedFilePath(req, fieldName) {
  const file = req.files?.[fieldName]?.[0];
  if (!file) return null;
  return fieldName === "payment_proof"
    ? `/uploads/payments/${file.filename}`
    : `/uploads/order-documents/${file.filename}`;
}

function parseInstallmentApplication(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function baseUrl(req) {
  return process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
}

function cleanText(value, maxLength = 1000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeShippingRegion(value) {
  const region = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["local", "nearby", "sogod", "bacacay", "sogod_bacacay"].includes(region)) return "local";
  if (region === "luzon") return "luzon";
  if (region === "visayas") return "visayas";
  return "";
}

function inferShippingRegion(regionValue, deliveryAddress) {
  const normalized = normalizeShippingRegion(regionValue);
  if (normalized) return normalized;
  const address = String(deliveryAddress || "").toLowerCase();
  if (address.includes("sogod") || address.includes("bacacay")) return "local";
  return "";
}

function computeShippingFee(regionValue, subtotal = 0, quantity = 1, isPos = false) {
  if (isPos) return { region: "local", label: "In-store / Local", fee: 0 };
  const region = normalizeShippingRegion(regionValue);
  const rate = SHIPPING_RATES[region];
  if (!rate) return { region: "", label: "", fee: 0 };
  if (region === "local") return { region, label: rate.label, fee: 0 };

  const qty = Math.max(Number(quantity || 1), 1);
  const amount = Number(subtotal || 0);
  const fee = qty >= 4 || amount >= 10000
    ? rate.max
    : qty >= 2 || amount >= 5000
      ? rate.mid
      : rate.min;

  return { region, label: rate.label, fee };
}

function requireShipping(regionValue, subtotal, quantity, isPos = false) {
  const shipping = computeShippingFee(regionValue, subtotal, quantity, isPos);
  if (!shipping.region) {
    throw new Error("Please select delivery area: Local Sogod/Bacacay, Luzon, or Visayas.");
  }
  return shipping;
}

function ensureOrderColumns(db, callback) {
  ensureOrderCoreColumns(db)
    .then(() => ensureInstallmentOrderColumns(db, (err) => {
      if (err) return callback(err);
      ensureOrderItemsTable(db, callback);
    }))
    .catch(callback);
}

function ensureInstallmentOrderColumns(db, callback) {
  const columns = [
    ["installment_terms", "ADD COLUMN installment_terms INT NULL"],
    ["installment_downpayment", "ADD COLUMN installment_downpayment DECIMAL(12,2) NULL"],
    ["installment_monthly", "ADD COLUMN installment_monthly DECIMAL(12,2) NULL"],
    ["installment_balance", "ADD COLUMN installment_balance DECIMAL(12,2) NULL"],
    ["installment_application_id", "ADD COLUMN installment_application_id INT NULL"]
  ];

  let index = 0;
  function next() {
    const item = columns[index];
    index += 1;
    if (!item) return ensureCancellationOrderColumns(db, callback);

    db.query(`SHOW COLUMNS FROM orders LIKE '${item[0]}'`, (checkErr, rows) => {
      if (checkErr) return callback(checkErr);
      if (rows.length) return next();

      db.query(`ALTER TABLE orders ${item[1]}`, (alterErr) => {
        if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") return callback(alterErr);
        next();
      });
    });
  }

  next();
}

function ensureCancellationOrderColumns(db, callback) {
  const columns = [
    ["cancellation_request_status", "ADD COLUMN cancellation_request_status VARCHAR(30) NULL"],
    ["cancellation_reason", "ADD COLUMN cancellation_reason TEXT NULL"],
    ["cancellation_admin_note", "ADD COLUMN cancellation_admin_note TEXT NULL"],
    ["cancellation_requested_at", "ADD COLUMN cancellation_requested_at DATETIME NULL"],
    ["cancellation_reviewed_at", "ADD COLUMN cancellation_reviewed_at DATETIME NULL"]
  ];

  let index = 0;
  function next() {
    const item = columns[index];
    index += 1;
    if (!item) return ensureRepairOrderColumns(db, callback);

    db.query(`SHOW COLUMNS FROM orders LIKE '${item[0]}'`, (checkErr, rows) => {
      if (checkErr) return callback(checkErr);
      if (rows.length) return next();

      db.query(`ALTER TABLE orders ${item[1]}`, (alterErr) => {
        if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") return callback(alterErr);
        next();
      });
    });
  }

  next();
}

function ensureRepairOrderColumns(db, callback) {
  const columns = [
    ["repair_request_status", "ADD COLUMN repair_request_status VARCHAR(30) NULL"],
    ["repair_service_status", "ADD COLUMN repair_service_status VARCHAR(40) NULL"],
    ["repair_issue", "ADD COLUMN repair_issue TEXT NULL"],
    ["repair_admin_note", "ADD COLUMN repair_admin_note TEXT NULL"],
    ["repair_requested_at", "ADD COLUMN repair_requested_at DATETIME NULL"],
    ["repair_reviewed_at", "ADD COLUMN repair_reviewed_at DATETIME NULL"],
    ["delivered_at", "ADD COLUMN delivered_at DATETIME NULL"],
    ["warranty_expires_at", "ADD COLUMN warranty_expires_at DATETIME NULL"]
  ];

  let index = 0;
  function next() {
    const item = columns[index];
    index += 1;
    if (!item) return backfillWarrantyColumns(db, (warrantyErr) => warrantyErr ? callback(warrantyErr) : ensureOrderStatusHistoryTable(db, callback));

    db.query(`SHOW COLUMNS FROM orders LIKE '${item[0]}'`, (checkErr, rows) => {
      if (checkErr) return callback(checkErr);
      if (rows.length) return next();

      db.query(`ALTER TABLE orders ${item[1]}`, (alterErr) => {
        if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") return callback(alterErr);
        next();
      });
    });
  }

  next();
}

function backfillWarrantyColumns(db, callback) {
  const sql = `
    UPDATE orders
    SET delivered_at = COALESCE(delivered_at, created_at),
        warranty_expires_at = COALESCE(warranty_expires_at, DATE_ADD(COALESCE(delivered_at, created_at), INTERVAL 7 DAY))
    WHERE status = 'delivered'
      AND (delivered_at IS NULL OR warranty_expires_at IS NULL)
  `;

  db.query(sql, (err) => {
    if (err && err.code !== "ER_BAD_FIELD_ERROR") return callback(err);
    callback();
  });
}

function ensureOrderStatusHistoryTable(db, callback) {
  const sql = `
    CREATE TABLE IF NOT EXISTS order_status_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      status VARCHAR(40) NOT NULL,
      note TEXT NULL,
      actor_role VARCHAR(40) NULL,
      actor_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_order_status_history_order (order_id),
      INDEX idx_order_status_history_status (status),
      INDEX idx_order_status_history_created (created_at)
    )
  `;

  db.query(sql, (err) => {
    if (err) return callback(err);
    backfillOrderStatusHistory(db, callback);
  });
}

function backfillOrderStatusHistory(db, callback) {
  const queries = [
    `
      INSERT INTO order_status_history (order_id, status, note, actor_role, actor_name, created_at)
      SELECT o.id, 'pending', 'Order placed.', 'system', 'System', COALESCE(o.created_at, NOW())
      FROM orders o
      WHERE NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id AND h.status = 'pending')
    `,
    `
      INSERT INTO order_status_history (order_id, status, note, actor_role, actor_name, created_at)
      SELECT o.id, 'processing', 'Order moved to processing.', 'system', 'System', COALESCE(o.processing_at, o.created_at, NOW())
      FROM orders o
      WHERE (o.processing_at IS NOT NULL OR COALESCE(o.status, 'pending') IN ('processing', 'shipped', 'delivered'))
        AND NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id AND h.status = 'processing')
    `,
    `
      INSERT INTO order_status_history (order_id, status, note, actor_role, actor_name, created_at)
      SELECT o.id, 'shipped', 'Order marked as ready.', 'system', 'System', COALESCE(o.shipped_at, o.processing_at, o.created_at, NOW())
      FROM orders o
      WHERE (o.shipped_at IS NOT NULL OR COALESCE(o.status, 'pending') IN ('shipped', 'delivered'))
        AND NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id AND h.status = 'shipped')
    `,
    `
      INSERT INTO order_status_history (order_id, status, note, actor_role, actor_name, created_at)
      SELECT o.id, 'delivered', 'Order completed.', 'system', 'System', COALESCE(o.delivered_at, o.shipped_at, o.created_at, NOW())
      FROM orders o
      WHERE (o.delivered_at IS NOT NULL OR COALESCE(o.status, 'pending') = 'delivered')
        AND NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id AND h.status = 'delivered')
    `,
    `
      INSERT INTO order_status_history (order_id, status, note, actor_role, actor_name, created_at)
      SELECT o.id, 'cancelled', COALESCE(o.cancellation_admin_note, 'Order cancelled.'), 'system', 'System', COALESCE(o.cancellation_reviewed_at, o.cancellation_requested_at, o.created_at, NOW())
      FROM orders o
      WHERE COALESCE(o.status, 'pending') = 'cancelled'
        AND NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = o.id AND h.status = 'cancelled')
    `
  ];

  let index = 0;
  function next() {
    const sql = queries[index];
    index += 1;
    if (!sql) return callback();

    db.query(sql, (err) => {
      if (err && err.code !== "ER_BAD_FIELD_ERROR") return callback(err);
      next();
    });
  }

  next();
}

function insertOrderStatusHistory(db, payload, callback = () => {}) {
  db.query(
    `INSERT INTO order_status_history (order_id, status, note, actor_role, actor_name)
     VALUES (?, ?, ?, ?, ?)`,
    [payload.order_id, payload.status, payload.note || null, payload.actor_role || "system", payload.actor_name || "System"],
    callback
  );
}

function attachOrderStatusHistory(db, orders, callback) {
  if (!orders.length) return callback(null, orders);

  ensureOrderStatusHistoryTable(db, (tableErr) => {
    if (tableErr) return callback(tableErr);

    const ids = orders.map(order => order.id).filter(Boolean);
    if (!ids.length) return callback(null, orders);

    db.query(
      "SELECT * FROM order_status_history WHERE order_id IN (?) ORDER BY created_at ASC, id ASC",
      [ids],
      (err, rows) => {
        if (err) return callback(err);
        const byOrder = rows.reduce((map, row) => {
          if (!map[row.order_id]) map[row.order_id] = [];
          map[row.order_id].push(row);
          return map;
        }, {});

        attachOrderDeliveryDetails(db, orders.map(order => ({
          ...order,
          status_history: byOrder[order.id] || []
        })), callback);
      }
    );
  });
}

function canTransitionOrderStatus(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) return true;
  return (ORDER_STATUS_TRANSITIONS[currentStatus] || []).includes(nextStatus);
}

function statusTransitionMessage(currentStatus, nextStatus) {
  const currentLabel = ORDER_STATUS_LABELS[currentStatus] || currentStatus;
  const nextLabel = ORDER_STATUS_LABELS[nextStatus] || nextStatus;
  if (currentStatus === "delivered") return "Completed orders are already final and cannot be moved to another status.";
  if (currentStatus === "cancelled") return "Cancelled orders cannot be moved to another status.";
  return `Invalid status movement: ${currentLabel} cannot be changed directly to ${nextLabel}.`;
}

function orderStatusNotificationMessage(status) {
  const messages = {
    processing: "Your order is now being prepared by the shop.",
    shipped: "Your order is ready. Please monitor your order details.",
    delivered: "Your order has been completed. Thank you for shopping with us.",
    cancelled: "Your order has been cancelled."
  };
  return messages[status] || `Your order status is now ${ORDER_STATUS_LABELS[status] || status}.`;
}
function ensureOrderItemsTable(db, callback) {
  const sql = `
    CREATE TABLE IF NOT EXISTS order_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      variant_index INT NULL,
      variant_name VARCHAR(255) NULL,
      quantity INT NOT NULL DEFAULT 1,
      unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
      product_image TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_order_items_order (order_id),
      INDEX idx_order_items_product (product_id)
    )
  `;

  db.query(sql, (err) => {
    if (err) return callback(err);
    backfillOrderItems(db, callback);
  });
}

function backfillOrderItems(db, callback) {
  const sql = `
    INSERT INTO order_items
    (order_id, product_id, product_name, variant_name, quantity, unit_price, subtotal, product_image)
    SELECT o.id, o.product_id, COALESCE(p.name, 'Product'), o.variant_name, o.quantity,
           COALESCE(o.variant_price, o.total_price / NULLIF(o.quantity, 0), o.total_price), o.total_price,
           COALESCE(p.image, p.images)
    FROM orders o
    LEFT JOIN products p ON o.product_id = p.id
    WHERE o.product_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id)
  `;

  db.query(sql, (err) => {
    if (err && err.code !== "ER_BAD_FIELD_ERROR") return callback(err);
    callback();
  });
}

function attachOrderItems(db, orders, callback) {
  if (!orders.length) return callback(null, orders);
  ensureOrderItemsTable(db, (tableErr) => {
    if (tableErr) return callback(tableErr);

    const ids = orders.map(order => order.id);
    db.query(
      "SELECT * FROM order_items WHERE order_id IN (?) ORDER BY id ASC",
      [ids],
      (err, items) => {
        if (err) return callback(err);
        const byOrder = items.reduce((map, item) => {
          if (!map[item.order_id]) map[item.order_id] = [];
          map[item.order_id].push(item);
          return map;
        }, {});

        const ordersWithItems = orders.map(order => {
          const orderItems = byOrder[order.id] || [];
          if (orderItems.length > 1) {
            return {
              ...order,
              items: orderItems,
              item_count: orderItems.length,
              product_name: `${orderItems.length} items`,
              product_image: orderItems[0]?.product_image || order.product_image,
              quantity: orderItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
              variant_name: "Multiple items"
            };
          }

          return {
            ...order,
            items: orderItems,
            item_count: orderItems.length || 1
          };
        });

        attachOrderStatusHistory(db, ordersWithItems, callback);
      }
    );
  });
}

function manualGcashPaymentInfo() {
  return {
    payment_status: "pending_payment",
    payment_provider: "manual_gcash"
  };
}

function validateInstallmentApplicationFields(application, total) {
  if (!application) return "Installment application details are required.";

  const requiredFields = [
    "full_name",
    "birthday",
    "phone",
    "address",
    "valid_id_number",
    "national_id_image",
    "selfie_with_id_image",
    "terms",
    "downpayment_method"
  ];
  const missing = requiredFields.some(field => !application[field]);
  if (missing) return "Complete installment application details are required.";

  const terms = Number(application.terms);
  const method = String(application.downpayment_method || "");
  const orderTotal = Number(total || 0);
  const minDownpayment = orderTotal * 0.2;

  if (!INSTALLMENT_TERMS.includes(terms)) return "Installment terms must be 3, 6, or 12 months.";
  if (!ONLINE_PAYMENT_METHODS.includes(method)) return "Downpayment must use GCash proof upload.";

  const requestedDownpayment = Number(application.downpayment_amount);
  application.downpayment_amount = Number.isFinite(requestedDownpayment) && requestedDownpayment >= minDownpayment && requestedDownpayment < orderTotal
    ? requestedDownpayment
    : minDownpayment;

  return null;
}

function createInstallmentApplication(db, orderId, userId, application, total, callback) {
  const terms = Number(application.terms);
  const downpayment = Number(application.downpayment_amount);
  const orderTotal = Number(total || 0);
  const financedAmount = Math.max(orderTotal - downpayment, 0);
  const monthlyAmount = financedAmount / terms;

  ensureInstallmentApplicationTable(db, (tableErr) => {
    if (tableErr) return callback(tableErr);

    const sql = `
      INSERT INTO installment_applications
      (user_id, order_id, full_name, birthday, phone, address, employment_status, employer_name, monthly_income,
       valid_id_type, valid_id_number, preferred_terms, requested_limit, order_total, downpayment_amount,
       downpayment_method, downpayment_status, financed_amount, monthly_amount, national_id_image, selfie_with_id_image, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [
      userId,
      orderId,
      cleanText(application.full_name, 255),
      application.birthday,
      cleanText(application.phone, 50),
      cleanText(application.address, 1000),
      cleanText(application.employment_status || "National ID verification", 80),
      cleanText(application.employer_name, 255) || null,
      Number(application.monthly_income || 0),
      "National ID",
      cleanText(application.valid_id_number, 120),
      terms,
      orderTotal,
      orderTotal,
      downpayment,
      application.downpayment_method,
      "pending",
      financedAmount,
      monthlyAmount,
      application.national_id_image,
      application.selfie_with_id_image,
      "pending"
    ], (err, result) => {
      if (err) return callback(err);
      callback(null, {
        id: result.insertId,
        terms,
        downpayment_amount: downpayment,
        financed_amount: financedAmount,
        monthly_amount: monthlyAmount,
        downpayment_method: application.downpayment_method
      });
    });
  });
}

function ensureInstallmentApplicationTable(db, callback) {
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
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `;

  db.query(sql, (err) => {
    if (err) return callback(err);
    ensureInstallmentApplicationColumns(db, callback);
  });
}

function ensureInstallmentApplicationColumns(db, callback) {
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

function dbQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, result) => err ? reject(err) : resolve(result));
  });
}

function gcashCommitDetails(req, paymentMethod) {
  if (paymentMethod !== "gcash") return null;
  const reference = String(req.body.gcash_reference || "").trim().replace(/\s+/g, "");
  const file = req.files?.payment_proof?.[0];
  if (!/^[A-Za-z0-9-]{8,50}$/.test(reference)) {
    throw Object.assign(new Error("Enter a valid GCash reference number."), { status: 400 });
  }
  if (!file) {
    throw Object.assign(new Error("Upload your GCash payment proof before submitting the order."), { status: 400 });
  }
  return { reference, proofPath: uploadedFilePath(req, "payment_proof") };
}

async function assertUniqueGcashReference(db, reference) {
  const rows = await dbQuery(db, "SELECT id FROM orders WHERE gcash_reference=? LIMIT 1", [reference]);
  if (rows.length) {
    throw Object.assign(new Error("This GCash reference number is already used by another order."), { status: 409 });
  }
}

function notifyGcashSubmitted(db, userId, orderId) {
  createNotification(db, {
    user_id: userId,
    title: "Payment proof submitted",
    message: `${orderLabel(orderId)} is waiting for admin payment approval. The order will be placed after approval.`,
    type: "payment",
    action_url: `/customer/order.html?order_id=${orderId}`
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

function ensureOrderInfrastructure(db) {
  return new Promise((resolve, reject) => {
    ensureOrderColumns(db, (columnErr) => {
      if (columnErr) return reject(columnErr);
      ensureOrderItemsTable(db, (itemErr) => itemErr ? reject(itemErr) : resolve());
    });
  });
}

router.post("/cart", orderSession, upload.fields([{ name: "payment_proof", maxCount: 1 }]), uploadStorage.validateUploadedMedia, (req, res, next) => {
  if (req.body?.source === 'pos') return requireAdminOrStaff(req, res, next);
  if (req.actorUser.role !== 'customer') return res.status(403).json({ message: 'Use the POS checkout for store orders.' });
  customerIdentity()(req, res, next);
}, async (req, res) => {
  let items = Array.isArray(req.body.items) ? req.body.items : [];
  if (typeof req.body.items === "string") {
    try {
      const parsed = JSON.parse(req.body.items);
      items = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return res.status(400).json({ message: "Cart items are invalid." });
    }
  }
  const cleanVoucherCode = req.body.voucher_code ? String(req.body.voucher_code).trim() : "";
  const userId = Number(req.body.user_id || 1);
  const isPos = req.body.source === "pos";
  const paymentMethod = normalizePaymentMethod(req.body.payment_method, {
    allowOffline: true,
    allowCash: isPos,
    allowInstallment: false
  });
  let requestedShippingRegion = cleanText(req.body.shipping_region, 40);
  const delivery = {
    recipient_name: cleanText(req.body.recipient_name, 255),
    delivery_contact: cleanText(req.body.delivery_contact, 50),
    delivery_address: cleanText(req.body.delivery_address, 1000),
    delivery_landmark: cleanText(req.body.delivery_landmark, 500),
    delivery_latitude: req.body.delivery_latitude === "" || req.body.delivery_latitude == null ? null : Number(req.body.delivery_latitude),
    delivery_longitude: req.body.delivery_longitude === "" || req.body.delivery_longitude == null ? null : Number(req.body.delivery_longitude),
    delivery_note: cleanText(req.body.delivery_note, 1000)
  };

  if (isPos) {
    delivery.recipient_name = delivery.recipient_name || "Walk-in Customer";
    delivery.delivery_contact = delivery.delivery_contact || "POS";
    delivery.delivery_address = delivery.delivery_address || "In-store purchase";
    requestedShippingRegion = "local";
  }

  if (!userId || !items.length) return res.status(400).json({ message: "Cart items are required." });
  if (!paymentMethod) return res.status(400).json({ message: isPos ? "Invalid POS payment method." : "Choose Cash on Delivery or GCash." });
  if (!delivery.recipient_name || !delivery.delivery_contact || !delivery.delivery_address) {
    return res.status(400).json({ message: "Complete delivery details are required" });
  }
  if (!isPos && (!Number.isFinite(delivery.delivery_latitude) || delivery.delivery_latitude < -90 || delivery.delivery_latitude > 90 ||
      !Number.isFinite(delivery.delivery_longitude) || delivery.delivery_longitude < -180 || delivery.delivery_longitude > 180)) {
    return res.status(400).json({ message: "Confirm your saved delivery location before placing this order." });
  }

  let gcashCommit;
  try {
    if (!isPos) gcashCommit = gcashCommitDetails(req, paymentMethod);
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }

  try {
    await ensureOrderInfrastructure(req.db);
    await ensureVoucherTables(req.db);
    await beginTransaction(req.db);
    if (gcashCommit) await assertUniqueGcashReference(req.db, gcashCommit.reference);

    const orderLines = [];
    for (const rawItem of items) {
      const productId = Number(rawItem.product_id);
      const qty = Number(rawItem.quantity || 1);
      if (!productId || !Number.isInteger(qty) || qty <= 0) {
        throw new Error("Invalid cart item quantity.");
      }

      const products = await dbQuery(req.db, "SELECT * FROM products WHERE id=? FOR UPDATE", [productId]);
      if (!products.length) throw new Error("Product not found.");

      const product = products[0];
      let productVariants = [];
      try {
        productVariants = product.variants ? JSON.parse(product.variants) : [];
        productVariants = Array.isArray(productVariants) ? productVariants : [];
      } catch (error) {
        productVariants = [];
      }

      const requestedVariantIndex = rawItem.variant_index === undefined || rawItem.variant_index === null || rawItem.variant_index === ""
        ? null
        : Number(rawItem.variant_index);
      const selectedVariant = requestedVariantIndex !== null ? productVariants[requestedVariantIndex] : null;
      const stock = Number(selectedVariant ? selectedVariant.stock : product.stock || 0);
      const unitPrice = Number(selectedVariant ? selectedVariant.price : product.price || 0);
      const subtotal = unitPrice * qty;

      if (qty > stock) throw new Error(`Only ${stock} item(s) available for ${product.name}.`);

      if (selectedVariant) {
        productVariants[requestedVariantIndex].stock = stock - qty;
        const update = await dbQuery(
          req.db,
          "UPDATE products SET stock = stock - ?, variants = ? WHERE id = ? AND stock >= ?",
          [qty, JSON.stringify(productVariants), productId, qty]
        );
        if (!update.affectedRows) throw new Error(`Not enough stock available for ${product.name}.`);
      } else {
        const update = await dbQuery(
          req.db,
          "UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?",
          [qty, productId, qty]
        );
        if (!update.affectedRows) throw new Error(`Not enough stock available for ${product.name}.`);
      }

      let image = product.image || null;
      try {
        const images = product.images ? JSON.parse(product.images) : [];
        if (Array.isArray(images) && images.length) image = images[0];
      } catch (error) {
      }

      orderLines.push({
        product_id: productId,
        product_name: product.name,
        variant_index: requestedVariantIndex,
        variant_name: selectedVariant ? selectedVariant.name || "Selected Variant" : null,
        quantity: qty,
        unit_price: unitPrice,
        subtotal,
        product_image: image,
        stock_before: stock,
        stock_after: stock - qty
      });
    }

    const total = orderLines.reduce((sum, item) => sum + item.subtotal, 0);
    const voucherResult = cleanVoucherCode
      ? await validateVoucher(req.db, {
        code: cleanVoucherCode,
        customer_id: userId,
        checkout_type: "regular",
        items: orderLines
      })
      : null;
    const discount = Number(voucherResult?.discount || 0);
    const productTotal = Math.max(total - discount, 0);
    const totalQuantity = orderLines.reduce((sum, item) => sum + item.quantity, 0);
    const selectedShippingRegion = inferShippingRegion(requestedShippingRegion, delivery.delivery_address);
    const shipping = requireShipping(selectedShippingRegion, total, totalQuantity, isPos);
    const grandTotal = productTotal + shipping.fee;
    const first = orderLines[0];
    const insertOrder = await dbQuery(req.db, `
      INSERT INTO orders
      (product_id, quantity, total_price, user_id, payment_method, variant_name, variant_price, recipient_name, delivery_contact, delivery_address, delivery_landmark, delivery_latitude, delivery_longitude, delivery_note, shipping_region, shipping_fee, voucher_id, voucher_code, voucher_discount, product_subtotal, final_product_total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      first.product_id,
      totalQuantity,
      grandTotal,
      userId,
      paymentMethod,
      orderLines.length > 1 ? "Multiple items" : first.variant_name,
      orderLines.length > 1 ? null : first.unit_price,
      delivery.recipient_name,
      delivery.delivery_contact,
      delivery.delivery_address,
      delivery.delivery_landmark,
      delivery.delivery_latitude,
      delivery.delivery_longitude,
      delivery.delivery_note,
      shipping.region,
      shipping.fee,
      voucherResult?.voucher_id || null,
      voucherResult?.voucher_code || null,
      discount,
      total,
      productTotal
    ]);

    const orderId = insertOrder.insertId;
    for (const item of orderLines) {
      await dbQuery(req.db, `
        INSERT INTO order_items
        (order_id, product_id, product_name, variant_index, variant_name, quantity, unit_price, subtotal, product_image)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        orderId,
        item.product_id,
        item.product_name,
        item.variant_index,
        item.variant_name,
        item.quantity,
        item.unit_price,
        item.subtotal,
        item.product_image
      ]);
    }

    const movementActor = inventoryActor(
      req,
      userId,
      isPos ? req.body.actor_name || "POS Staff" : delivery.recipient_name,
      isPos ? req.body.actor_role || "staff" : "customer"
    );
    await recordInventoryMovementsAsync(
      req.db,
      orderLines.map(item => inventoryMovementFromOrderLine(
        item,
        orderId,
        movementActor,
        isPos ? "pos" : "checkout",
        isPos ? "pos_sale" : "customer_order"
      ))
    );

    let paymentInfo = null;
    if (isPos) {
      await dbQuery(req.db, "UPDATE orders SET payment_status=?, payment_provider=?, payment_completed_at=COALESCE(payment_completed_at, NOW()), status=?, processing_at=COALESCE(processing_at, NOW()), shipped_at=COALESCE(shipped_at, NOW()), delivered_at=NOW(), warranty_expires_at=DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE id=?", ["paid", "pos", "delivered", orderId]);
      await recordVoucherRedemption(req.db, { id: orderId, user_id: userId, voucher_id: voucherResult?.voucher_id, voucher_code: voucherResult?.voucher_code, voucher_discount: discount, product_subtotal: total }, "regular", { skipEnsure: true });
    } else if (paymentMethod === "cod") {
      await dbQuery(req.db, "UPDATE orders SET payment_status=?, payment_provider=? WHERE id=?", ["to_collect", "cod", orderId]);
    } else if (ONLINE_PAYMENT_METHODS.includes(paymentMethod)) {
      paymentInfo = manualGcashPaymentInfo();
      if (gcashCommit) {
        paymentInfo = {
          payment_status: "for_verification",
          payment_provider: "manual_gcash",
          payment_reference: gcashCommit.reference,
          gcash_reference: gcashCommit.reference,
          payment_proof_image: gcashCommit.proofPath
        };
        await dbQuery(req.db, `
          UPDATE orders
          SET payment_status=?, payment_provider=?, payment_reference=?, gcash_reference=?,
              payment_proof_image=?, payment_submitted_at=NOW(), payment_error=NULL
          WHERE id=?
        `, [paymentInfo.payment_status, paymentInfo.payment_provider, gcashCommit.reference, gcashCommit.reference, gcashCommit.proofPath, orderId]);
      } else {
        await dbQuery(req.db, "UPDATE orders SET payment_status=?, payment_provider=?, payment_reference=NULL, payment_checkout_id=NULL, payment_checkout_url=NULL, payment_error=NULL WHERE id=?", [paymentInfo.payment_status, paymentInfo.payment_provider, orderId]);
      }
    }
    await commitTransaction(req.db);
    if (gcashCommit) notifyGcashSubmitted(req.db, userId, orderId);

    res.json({
      message: isPos ? "POS sale completed" : gcashCommit ? "Payment submitted. Waiting for admin approval before the order is placed." : "Cart order created",
      order_id: orderId,
      subtotal: total,
      discount,
      shipping_region: shipping.region,
      shipping_label: shipping.label,
      shipping_fee: shipping.fee,
      total: grandTotal,
      voucher_applied: voucherResult?.voucher_code || null,
      payment_method: paymentMethod,
      payment_status: paymentInfo?.payment_status || (isPos ? "paid" : paymentMethod === "cod" ? "to_collect" : "pending_payment"),
      payment_provider: paymentInfo?.payment_provider || (isPos ? "pos" : paymentMethod === "cod" ? "cod" : "manual_gcash"),
      payment_reference: paymentInfo?.payment_reference || null,
      requires_payment_proof: ONLINE_PAYMENT_METHODS.includes(paymentMethod),
      payment_error: paymentInfo?.payment_error || null,
      payment_message: paymentInfo?.message || null,
      delivery,
      items: orderLines,
      item_count: orderLines.length
    });  } catch (error) {
    await rollbackTransaction(req.db);
    res.status(400).json({ message: error.message });
  }
});
router.post("/", customerSession, upload.fields([
  { name: "national_id_image", maxCount: 1 },
  { name: "selfie_with_id_image", maxCount: 1 },
  { name: "payment_proof", maxCount: 1 }
]), uploadStorage.validateUploadedMedia, customerIdentity(), (req, res) => {

  const {
    product_id,
    quantity,
    user_id,
    voucher_code,
    payment_method,
    variant_index,
    recipient_name,
    delivery_contact,
    delivery_address,
    delivery_note,
    delivery_landmark,
    delivery_latitude,
    delivery_longitude,
    shipping_region,
    installment_application
  } = req.body;
  const installmentApplication = parseInstallmentApplication(installment_application);
  if (installmentApplication) {
    installmentApplication.national_id_image = uploadedFilePath(req, "national_id_image");
    installmentApplication.selfie_with_id_image = uploadedFilePath(req, "selfie_with_id_image");
  }

  const qty = Number(quantity);
  const userId = Number(user_id);
  const cleanVoucherCode = voucher_code ? String(voucher_code).trim() : "";
  const paymentMethod = normalizePaymentMethod(payment_method, {
    allowOffline: true,
    allowCash: false,
    allowInstallment: true
  }) || "cod";
  let gcashCommit;
  try {
    gcashCommit = gcashCommitDetails(req, paymentMethod);
  } catch (error) {
    return res.status(error.status || 400).json({ message: error.message });
  }
  const delivery = {
    recipient_name: cleanText(recipient_name, 255),
    delivery_contact: cleanText(delivery_contact, 50),
    delivery_address: cleanText(delivery_address, 1000),
    delivery_landmark: cleanText(delivery_landmark, 500),
    delivery_latitude: delivery_latitude === "" || delivery_latitude == null ? null : Number(delivery_latitude),
    delivery_longitude: delivery_longitude === "" || delivery_longitude == null ? null : Number(delivery_longitude),
    delivery_note: cleanText(delivery_note, 1000)
  };
  const requestedShippingRegion = cleanText(shipping_region, 40);

  if (!product_id || !qty || !userId) {
    return res.status(400).json({ message: "Missing fields" });
  }

  if (!Number.isInteger(qty) || qty <= 0) {
    return res.status(400).json({ message: "Quantity must be at least 1" });
  }

  if (!delivery.recipient_name || !delivery.delivery_contact || !delivery.delivery_address) {
    return res.status(400).json({ message: "Complete delivery details are required" });
  }
  if (!Number.isFinite(delivery.delivery_latitude) || delivery.delivery_latitude < -90 || delivery.delivery_latitude > 90 ||
      !Number.isFinite(delivery.delivery_longitude) || delivery.delivery_longitude < -180 || delivery.delivery_longitude > 180) {
    return res.status(400).json({ message: "Confirm your saved delivery location before placing this order." });
  }

  ensureOrderColumns(req.db, (columnErr) => {
    if (columnErr) return res.status(500).json({ message: columnErr.message });
    loadProductAndCreateOrder();
  });

  function loadProductAndCreateOrder() {

  const getProduct = "SELECT * FROM products WHERE id=?";

  req.db.query(getProduct, [product_id], async (err, result) => {

    if (err) return res.status(500).json({ message: err.message });

    if (result.length === 0) {
      return res.status(404).json({ message: "Product not found" });
    }

    const product = result[0];
    let variants = [];

    try {
      variants = product.variants ? JSON.parse(product.variants) : [];
      variants = Array.isArray(variants) ? variants : [];
    } catch (e) {
      variants = [];
    }

    const requestedVariantIndex =
      variant_index === undefined || variant_index === null || variant_index === ""
        ? null
        : Number(variant_index);
    const selectedVariant =
      requestedVariantIndex !== null && variants[requestedVariantIndex]
        ? variants[requestedVariantIndex]
        : null;
    const stock = selectedVariant
      ? Number(selectedVariant.stock) || 0
      : Number(product.stock) || 0;
    const unitPrice = selectedVariant
      ? Number(selectedVariant.price) || Number(product.price)
      : Number(product.price);
    const variantName = selectedVariant ? selectedVariant.name || "Selected Variant" : null;

    if (gcashCommit) {
      try {
        await assertUniqueGcashReference(req.db, gcashCommit.reference);
      } catch (referenceError) {
        return res.status(referenceError.status || 500).json({ message: referenceError.message });
      }
    }

    if (qty > stock) {
      return res.status(400).json({
        message: `Only ${stock} item(s) available in stock`
      });
    }

    const subtotal = unitPrice * qty;
    let discount = 0;
    let voucherApplied = null;
    let voucherId = null;

    let finalTotal = subtotal;

    try {
      await ensureVoucherTables(req.db);
      const voucherResult = cleanVoucherCode
        ? await validateVoucher(req.db, {
          code: cleanVoucherCode,
          customer_id: userId,
          checkout_type: paymentMethod === INSTALLMENT_PAYMENT_METHOD ? "installment" : "regular",
          items: [{ product_id, quantity: qty, variant_index: requestedVariantIndex }]
        })
        : null;
      discount = Number(voucherResult?.discount || 0);
      finalTotal = Math.max(subtotal - discount, 0);
      voucherApplied = voucherResult?.voucher_code || null;
      voucherId = voucherResult?.voucher_id || null;
      createOrder();
    } catch (voucherErr) {
      return res.status(400).json({ message: voucherErr.message });
    }

    function createOrder() {
      const selectedShippingRegion = inferShippingRegion(requestedShippingRegion, delivery.delivery_address);
      let shipping;
      const productTotal = finalTotal;
      try {
        shipping = requireShipping(selectedShippingRegion, subtotal, qty, false);
      } catch (shippingErr) {
        return res.status(400).json({ message: shippingErr.message });
      }
      finalTotal = productTotal + shipping.fee;

      const installmentValidationMessage = paymentMethod === INSTALLMENT_PAYMENT_METHOD
        ? validateInstallmentApplicationFields(installmentApplication, finalTotal)
        : null;

      if (installmentValidationMessage) {
        return res.status(400).json({ message: installmentValidationMessage });
      }

      const beginOrderTransaction = () => {
      req.db.beginTransaction((txErr) => {
        if (txErr) return res.status(500).json({ message: txErr.message });

        if (selectedVariant) {
          variants[requestedVariantIndex].stock = stock - qty;
        }

        const updateStock = selectedVariant
          ? `
          UPDATE products
          SET stock = stock - ?, variants = ?
          WHERE id = ? AND stock >= ?
        `
          : `
          UPDATE products
          SET stock = stock - ?
          WHERE id = ? AND stock >= ?
        `;

        const stockParams = selectedVariant
          ? [qty, JSON.stringify(variants), product_id, qty]
          : [qty, product_id, qty];

        req.db.query(updateStock, stockParams, (stockErr, stockResult) => {
          if (stockErr) {
            return req.db.rollback(() => {
              res.status(500).json({ message: stockErr.message });
            });
          }

          if (stockResult.affectedRows === 0) {
            return req.db.rollback(() => {
              res.status(400).json({ message: "Not enough stock available" });
            });
          }

          const insertWithPaymentMethod = `
            INSERT INTO orders
            (product_id, quantity, total_price, user_id, payment_method, variant_name, variant_price, recipient_name, delivery_contact, delivery_address, delivery_landmark, delivery_latitude, delivery_longitude, delivery_note, shipping_region, shipping_fee, voucher_id, voucher_code, voucher_discount, product_subtotal, final_product_total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

          const sendCreatedOrder = (result3, paymentInfo = {}) => {
            res.json({
              message: "Order created",
              order_id: result3.insertId,
              subtotal,
              discount,
              product_total: productTotal,
              shipping_region: shipping.region,
              shipping_label: shipping.label,
              shipping_fee: shipping.fee,
              total: finalTotal,
              voucher_applied: voucherApplied,
              payment_method: paymentMethod,
              payment_status: paymentInfo.payment_status || (paymentMethod === "cod" ? "to_collect" : "pending_payment"),
              payment_provider: paymentInfo.payment_provider || (ONLINE_PAYMENT_METHODS.includes(paymentMethod) ? "manual_gcash" : "cod"),
              payment_reference: paymentInfo.payment_reference || null,
              requires_payment_proof: ONLINE_PAYMENT_METHODS.includes(paymentMethod),
              payment_error: paymentInfo.payment_error || null,
              payment_message: paymentInfo.message || null,
              variant_name: variantName,
              variant_price: selectedVariant ? unitPrice : null,
              delivery
            });
          };

          const finishOrder = (err3, result3) => {
              if (err3) {
                return req.db.rollback(() => {
                  res.status(500).json({ message: err3.message });
                });
              }

              const orderLine = {
                product_id,
                product_name: product.name,
                variant_index: selectedVariant ? requestedVariantIndex : null,
                variant_name: variantName,
                quantity: qty,
                unit_price: unitPrice,
                subtotal,
                product_image: product.image || product.images,
                stock_before: stock,
                stock_after: stock - qty
              };

              req.db.query(
                `INSERT INTO order_items
                 (order_id, product_id, product_name, variant_index, variant_name, quantity, unit_price, subtotal, product_image)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                  result3.insertId,
                  orderLine.product_id,
                  orderLine.product_name,
                  orderLine.variant_index,
                  orderLine.variant_name,
                  orderLine.quantity,
                  orderLine.unit_price,
                  orderLine.subtotal,
                  orderLine.product_image
                ],
                (itemErr) => {
                  if (itemErr) {
                    return req.db.rollback(() => {
                      res.status(500).json({ message: itemErr.message });
                    });
                  }

              const movementActor = inventoryActor(req, userId, delivery.recipient_name, "customer");
              const stockMovement = inventoryMovementFromOrderLine(orderLine, result3.insertId, movementActor, "checkout", "customer_order");

              recordInventoryMovements(req.db, [stockMovement], (movementErr) => {
                if (movementErr) {
                  return req.db.rollback(() => {
                    res.status(500).json({ message: movementErr.message });
                  });
                }

                req.db.commit((commitErr) => {
                  if (commitErr) {
                    return req.db.rollback(() => {
                      res.status(500).json({ message: commitErr.message });
                    });
                  }

                  if (!ONLINE_PAYMENT_METHODS.includes(paymentMethod)) {
                  if (paymentMethod === INSTALLMENT_PAYMENT_METHOD) {
                    return createInstallmentApplication(req.db, result3.insertId, userId, installmentApplication, finalTotal, (applicationErr, applicationInfo) => {
                      if (applicationErr) {
                        return sendCreatedOrder(result3, {
                          payment_status: "installment_application_failed",
                          payment_provider: "in_house_installment",
                          message: applicationErr.message
                        });
                      }

                      const updateSql = `
                        UPDATE orders
                        SET payment_status=?, payment_provider=?, payment_error=NULL, installment_terms=?, installment_downpayment=?,
                            installment_monthly=?, installment_balance=?, installment_application_id=?,
                            payment_reference=NULL, payment_checkout_id=NULL, payment_checkout_url=NULL
                        WHERE id=?
                      `;

                      req.db.query(updateSql, [
                        "installment_application_pending",
                        "in_house_installment",
                        applicationInfo.terms,
                        applicationInfo.downpayment_amount,
                        applicationInfo.monthly_amount,
                        applicationInfo.financed_amount,
                        applicationInfo.id,
                        result3.insertId
                      ], () => sendCreatedOrder(result3, {
                        payment_status: "installment_application_pending",
                        payment_provider: "in_house_installment",
                        message: "Installment application submitted. Wait for admin approval before paying the downpayment."
                      }));
                      createNotification(req.db, {
                        user_id: userId,
                        title: "Installment application submitted",
                        message: `Your installment application for ${orderLabel(result3.insertId)} is now pending admin review.`,
                        type: "installment",
                        action_url: `/customer/order.html?order_id=${result3.insertId}`
                      });
                    });
                  }

                  return req.db.query(
                    "UPDATE orders SET payment_status=?, payment_provider=? WHERE id=?",
                    ["to_collect", "cod", result3.insertId],
                    () => sendCreatedOrder(result3, {
                      payment_status: "to_collect",
                      payment_provider: "cod"
                    })
                  );
                }

                if (gcashCommit) {
                  const submitted = {
                    payment_status: "for_verification",
                    payment_provider: "manual_gcash",
                    payment_reference: gcashCommit.reference,
                    message: "Payment proof submitted. Waiting for admin approval before the order is placed."
                  };
                  notifyGcashSubmitted(req.db, userId, result3.insertId);
                  return sendCreatedOrder(result3, submitted);
                }

                const gcashInfo = manualGcashPaymentInfo();
                req.db.query(
                  "UPDATE orders SET payment_status=?, payment_provider=?, payment_reference=NULL, payment_checkout_id=NULL, payment_checkout_url=NULL, payment_error=NULL WHERE id=?",
                  [gcashInfo.payment_status, gcashInfo.payment_provider, result3.insertId],
                  (paymentErr) => sendCreatedOrder(result3, paymentErr ? {
                    payment_status: "pending_payment",
                    payment_provider: "manual_gcash",
                    message: paymentErr.message
                  } : gcashInfo)
                );
                });
              });
                }
              );
          };

          const finishOrderWithGcashProof = (err3, result3) => {
            if (err3 || !gcashCommit) return finishOrder(err3, result3);
            req.db.query(`
              UPDATE orders
              SET payment_status='for_verification', payment_provider='manual_gcash',
                  payment_reference=?, gcash_reference=?, payment_proof_image=?,
                  payment_submitted_at=NOW(), payment_error=NULL
              WHERE id=?
            `, [gcashCommit.reference, gcashCommit.reference, gcashCommit.proofPath, result3.insertId], (paymentErr) => {
              if (paymentErr) return req.db.rollback(() => res.status(500).json({ message: paymentErr.message }));
              finishOrder(null, result3);
            });
          };

          req.db.query(
            insertWithPaymentMethod,
            [
              product_id,
              qty,
              finalTotal,
              userId,
              paymentMethod,
              variantName,
              selectedVariant ? unitPrice : null,
              delivery.recipient_name,
              delivery.delivery_contact,
              delivery.delivery_address,
              delivery.delivery_landmark,
              delivery.delivery_latitude,
              delivery.delivery_longitude,
              delivery.delivery_note,
              shipping.region,
              shipping.fee,
              voucherId,
              voucherApplied,
              discount,
              subtotal,
              productTotal
            ],
            finishOrderWithGcashProof
          );
        });
      });
      };

      beginOrderTransaction();
    }
  });
  }
});

router.get("/", requireAdminOrStaff, (req, res) => {
  ensureOrderColumns(req.db, (columnErr) => {
    if (columnErr) return res.status(500).json({ message: columnErr.message });
    loadOrders();
  });

  function loadOrders() {
  const sql = `
    SELECT
      o.id,
      o.product_id,
      o.quantity,
      o.total_price,
      o.shipping_region,
      o.shipping_fee,
      o.user_id,
      o.payment_method,
      o.payment_status,
      o.payment_provider,
      o.payment_reference,
      o.gcash_reference,
      o.payment_proof_image,
      o.payment_submitted_at,
      o.payment_verified_at,
      o.payment_verified_by,
      o.payment_verified_by_name,
      o.payment_rejection_reason,
      o.payment_checkout_id,
      o.payment_checkout_url,
      o.payment_error,
      o.payment_last_checked_at,
      o.payment_completed_at,
      o.payment_failed_at,
      o.installment_terms,
      o.installment_downpayment,
      o.installment_monthly,
      o.installment_balance,
      o.installment_application_id,
      ia.status AS installment_application_status,
      ia.downpayment_status AS installment_downpayment_status,
      o.variant_name,
      o.variant_price,
      o.status,
      o.processing_at,
      o.shipped_at,
      o.recipient_name,
      o.delivery_contact,
      o.delivery_address,
      o.delivery_note,
      o.cancellation_request_status,
      o.cancellation_reason,
      o.cancellation_admin_note,
      o.cancellation_requested_at,
      o.cancellation_reviewed_at,
      o.repair_request_status,
      o.repair_service_status,
      o.repair_issue,
      o.repair_admin_note,
      o.repair_requested_at,
      o.repair_reviewed_at,
      o.delivered_at,
      o.warranty_expires_at,
      o.stock_restored_at,
      o.created_at,
      p.name AS product_name,
      p.image AS product_image,
      p.images AS product_images,
      u.name AS customer_name,
      u.email AS customer_email,
      u.phone AS customer_phone,
      u.address AS customer_address,
      u.city AS customer_city,
      u.province AS customer_province,
      u.postal_code AS customer_postal_code
    FROM orders o
    LEFT JOIN products p ON o.product_id = p.id
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN installment_applications ia ON o.installment_application_id = ia.id
    WHERE NOT (
      LOWER(COALESCE(o.payment_method, '')) = 'gcash'
      AND LOWER(COALESCE(o.payment_provider, '')) = 'manual_gcash'
      AND LOWER(COALESCE(o.payment_status, '')) = 'pending_payment'
      AND (o.payment_proof_image IS NULL OR o.payment_proof_image = '')
      AND COALESCE(o.status, 'pending') <> 'cancelled'
    )
    ORDER BY o.created_at DESC
  `;

  const fallbackSql = `
    SELECT
      o.id,
      o.product_id,
      o.quantity,
      o.total_price,
      o.shipping_region,
      o.shipping_fee,
      o.user_id,
      o.payment_method,
      o.payment_status,
      o.payment_provider,
      o.payment_reference,
      o.gcash_reference,
      o.payment_proof_image,
      o.payment_submitted_at,
      o.payment_verified_at,
      o.payment_verified_by,
      o.payment_verified_by_name,
      o.payment_rejection_reason,
      o.payment_checkout_id,
      o.payment_checkout_url,
      o.payment_error,
      o.payment_last_checked_at,
      o.payment_completed_at,
      o.payment_failed_at,
      o.installment_terms,
      o.installment_downpayment,
      o.installment_monthly,
      o.installment_balance,
      o.installment_application_id,
      ia.status AS installment_application_status,
      ia.downpayment_status AS installment_downpayment_status,
      o.variant_name,
      o.variant_price,
      o.status,
      o.processing_at,
      o.shipped_at,
      o.cancellation_request_status,
      o.cancellation_reason,
      o.cancellation_admin_note,
      o.cancellation_requested_at,
      o.cancellation_reviewed_at,
      o.repair_request_status,
      o.repair_service_status,
      o.repair_issue,
      o.repair_admin_note,
      o.repair_requested_at,
      o.repair_reviewed_at,
      o.delivered_at,
      o.warranty_expires_at,
      o.stock_restored_at,
      o.created_at,
      p.name AS product_name,
      p.image AS product_image,
      p.images AS product_images,
      u.name AS customer_name,
      u.email AS customer_email
    FROM orders o
    LEFT JOIN products p ON o.product_id = p.id
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN installment_applications ia ON o.installment_application_id = ia.id
    WHERE NOT (
      LOWER(COALESCE(o.payment_method, '')) = 'gcash'
      AND LOWER(COALESCE(o.payment_provider, '')) = 'manual_gcash'
      AND LOWER(COALESCE(o.payment_status, '')) = 'pending_payment'
      AND (o.payment_proof_image IS NULL OR o.payment_proof_image = '')
      AND COALESCE(o.status, 'pending') <> 'cancelled'
    )
    ORDER BY o.created_at DESC
  `;

  req.db.query(sql, (err, result) => {
    if (err && err.code === "ER_BAD_FIELD_ERROR") {
      return req.db.query(fallbackSql, (fallbackErr, fallbackResult) => {
        if (fallbackErr) return res.status(500).json({ message: fallbackErr.message });
        attachOrderItems(req.db, fallbackResult, (itemErr, ordersWithItems) => {
          if (itemErr) return res.status(500).json({ message: itemErr.message });
          res.json(ordersWithItems);
        });
      });
    }

    if (err) return res.status(500).json({ message: err.message });
    attachOrderItems(req.db, result, (itemErr, ordersWithItems) => {
      if (itemErr) return res.status(500).json({ message: itemErr.message });
      res.json(ordersWithItems);
    });
  });
  }
});

router.get("/customer/:user_id", customerSession, customerIdentity(), (req, res) => {
  ensureOrderColumns(req.db, (columnErr) => {
    if (columnErr) return res.status(500).json({ message: columnErr.message });
    loadCustomerOrders();
  });

  function loadCustomerOrders() {
  const sql = `
    SELECT
      o.id,
      o.product_id,
      o.quantity,
      o.total_price,
      o.shipping_region,
      o.shipping_fee,
      o.payment_method,
      o.payment_status,
      o.payment_provider,
      o.payment_reference,
      o.gcash_reference,
      o.payment_proof_image,
      o.payment_submitted_at,
      o.payment_verified_at,
      o.payment_verified_by,
      o.payment_verified_by_name,
      o.payment_rejection_reason,
      o.payment_checkout_id,
      o.payment_checkout_url,
      o.payment_error,
      o.payment_last_checked_at,
      o.payment_completed_at,
      o.payment_failed_at,
      o.installment_terms,
      o.installment_downpayment,
      o.installment_monthly,
      o.installment_balance,
      o.installment_application_id,
      ia.status AS installment_application_status,
      ia.downpayment_status AS installment_downpayment_status,
      o.variant_name,
      o.variant_price,
      o.status,
      o.processing_at,
      o.shipped_at,
      o.recipient_name,
      o.delivery_contact,
      o.delivery_address,
      o.delivery_note,
      o.cancellation_request_status,
      o.cancellation_reason,
      o.cancellation_admin_note,
      o.cancellation_requested_at,
      o.cancellation_reviewed_at,
      o.repair_request_status,
      o.repair_service_status,
      o.repair_issue,
      o.repair_admin_note,
      o.repair_requested_at,
      o.repair_reviewed_at,
      o.delivered_at,
      o.warranty_expires_at,
      o.stock_restored_at,
      o.created_at,
      p.name AS product_name,
      p.image AS product_image,
      p.images AS product_images
    FROM orders o
    LEFT JOIN products p ON o.product_id = p.id
    LEFT JOIN installment_applications ia ON o.installment_application_id = ia.id
    WHERE o.user_id = ?
    ORDER BY o.created_at DESC
  `;

  const fallbackSql = `
    SELECT
      o.id,
      o.product_id,
      o.quantity,
      o.total_price,
      o.shipping_region,
      o.shipping_fee,
      o.payment_method,
      o.payment_status,
      o.payment_provider,
      o.payment_reference,
      o.gcash_reference,
      o.payment_proof_image,
      o.payment_submitted_at,
      o.payment_verified_at,
      o.payment_verified_by,
      o.payment_verified_by_name,
      o.payment_rejection_reason,
      o.payment_checkout_id,
      o.payment_checkout_url,
      o.payment_error,
      o.payment_last_checked_at,
      o.payment_completed_at,
      o.payment_failed_at,
      o.installment_terms,
      o.installment_downpayment,
      o.installment_monthly,
      o.installment_balance,
      o.installment_application_id,
      ia.status AS installment_application_status,
      ia.downpayment_status AS installment_downpayment_status,
      o.variant_name,
      o.variant_price,
      o.status,
      o.processing_at,
      o.shipped_at,
      o.cancellation_request_status,
      o.cancellation_reason,
      o.cancellation_admin_note,
      o.cancellation_requested_at,
      o.cancellation_reviewed_at,
      o.repair_request_status,
      o.repair_service_status,
      o.repair_issue,
      o.repair_admin_note,
      o.repair_requested_at,
      o.repair_reviewed_at,
      o.delivered_at,
      o.warranty_expires_at,
      o.stock_restored_at,
      o.created_at,
      p.name AS product_name,
      p.image AS product_image,
      p.images AS product_images
    FROM orders o
    LEFT JOIN products p ON o.product_id = p.id
    LEFT JOIN installment_applications ia ON o.installment_application_id = ia.id
    WHERE o.user_id = ?
    ORDER BY o.created_at DESC
  `;

  req.db.query(sql, [req.params.user_id], (err, result) => {
    if (err && err.code === "ER_BAD_FIELD_ERROR") {
      return req.db.query(fallbackSql, [req.params.user_id], (fallbackErr, fallbackResult) => {
        if (fallbackErr) return res.status(500).json({ message: fallbackErr.message });
        attachOrderItems(req.db, fallbackResult, (itemErr, ordersWithItems) => {
          if (itemErr) return res.status(500).json({ message: itemErr.message });
          res.json(ordersWithItems);
        });
      });
    }

    if (err) return res.status(500).json({ message: err.message });
    attachOrderItems(req.db, result, (itemErr, ordersWithItems) => {
      if (itemErr) return res.status(500).json({ message: itemErr.message });
      res.json(ordersWithItems);
    });
  });
  }
});

router.post("/:id/cancellation-request", customerSession, customerIdentity(), (req, res) => {
  const orderId = req.params.id;
  const userId = Number(req.body.user_id);
  const reason = cleanText(req.body.reason, 1000);

  if (!userId) return res.status(400).json({ message: "Customer is required." });
  if (!reason) return res.status(400).json({ message: "Cancellation reason is required." });

  ensureOrderColumns(req.db, (columnErr) => {
    if (columnErr) return res.status(500).json({ message: columnErr.message });

    req.db.query(
      "SELECT id, user_id, status, cancellation_request_status FROM orders WHERE id=?",
      [orderId],
      (selectErr, rows) => {
        if (selectErr) return res.status(500).json({ message: selectErr.message });
        if (!rows.length) return res.status(404).json({ message: "Order not found." });

        const order = rows[0];
        if (Number(order.user_id) !== userId) {
          return res.status(403).json({ message: "You can only cancel your own order." });
        }

        if (!["pending", "processing"].includes(order.status || "pending")) {
          return res.status(400).json({ message: "Only pending or processing orders can be requested for cancellation." });
        }

        if (order.cancellation_request_status === "pending") {
          return res.status(400).json({ message: "Cancellation request is already pending." });
        }

        req.db.query(
          `UPDATE orders
           SET cancellation_request_status='pending',
               cancellation_reason=?,
               cancellation_admin_note=NULL,
               cancellation_requested_at=NOW(),
               cancellation_reviewed_at=NULL
           WHERE id=?`,
          [reason, orderId],
          (updateErr) => {
            if (updateErr) return res.status(500).json({ message: updateErr.message });
            res.json({ message: "Cancellation request submitted.", status: "pending" });
          }
        );
      }
    );
  });
});

router.put("/:id/cancellation-request", requireAdmin, (req, res) => {
  const orderId = req.params.id;
  const decision = String(req.body.decision || "").toLowerCase();
  const adminNote = cleanText(req.body.admin_note, 1000);

  if (!["approved", "rejected"].includes(decision)) {
    return res.status(400).json({ message: "Decision must be approved or rejected." });
  }

  ensureOrderColumns(req.db, (columnErr) => {
    if (columnErr) return res.status(500).json({ message: columnErr.message });

    req.db.beginTransaction((txErr) => {
      if (txErr) return res.status(500).json({ message: txErr.message });

      req.db.query(
        "SELECT id, user_id, status, cancellation_request_status FROM orders WHERE id=? FOR UPDATE",
        [orderId],
        (selectErr, rows) => {
          if (selectErr) return req.db.rollback(() => res.status(500).json({ message: selectErr.message }));
          if (!rows.length) return req.db.rollback(() => res.status(404).json({ message: "Order not found." }));

          const order = rows[0];
          if (order.cancellation_request_status !== "pending") {
            return req.db.rollback(() => res.status(400).json({ message: "No pending cancellation request for this order." }));
          }

          const nextStatus = decision === "approved" ? "cancelled" : order.status;
          req.db.query(
            `UPDATE orders
             SET status=?,
                 cancellation_request_status=?,
                 cancellation_admin_note=?,
                 cancellation_reviewed_at=NOW()
             WHERE id=?`,
            [nextStatus, decision, adminNote || null, orderId],
            (updateErr) => {
              if (updateErr) return req.db.rollback(() => res.status(500).json({ message: updateErr.message }));

              const actor = auditActor(req);
              const finishStockRestore = (next) => {
                if (decision !== "approved") return next(null, { restored: false });
                restoreOrderStock(req.db, orderId, {
                  skipDelivered: true,
                  actor,
                  source: "cancellation_approval",
                  note: `Stock returned after cancellation approval for ${orderLabel(orderId)}`
                }, next);
              };

              finishStockRestore((restoreErr, restoreReport) => {
                if (restoreErr) return req.db.rollback(() => res.status(500).json({ message: restoreErr.message }));

                req.db.commit((commitErr) => {
                  if (commitErr) return req.db.rollback(() => res.status(500).json({ message: commitErr.message }));

                  if (order.user_id) {
                    createNotification(req.db, {
                      user_id: order.user_id,
                      title: `Cancellation ${decision} for ${orderLabel(order.id)}`,
                      message: decision === "approved"
                        ? "Your cancellation request was approved. The order has been cancelled. Reserved stock was returned to inventory."
                        : "Your cancellation request was rejected. Please check your order details.",
                      type: "order",
                      action_url: `/customer/order.html?order_id=${order.id}`
                    });
                  }

                  res.json({
                    message: `Cancellation request ${decision}.`,
                    decision,
                    status: nextStatus,
                    stock_restored: Boolean(restoreReport?.restored),
                    restored_quantity: restoreReport?.restored_quantity || 0
                  });
                });
              });
            }
          );
        }
      );
    });
  });
});
router.post("/:id/repair-request", customerSession, customerIdentity(), (req, res) => {
  const orderId = req.params.id;
  const userId = Number(req.body.user_id);
  const issue = cleanText(req.body.issue || req.body.reason, 1000);

  if (!userId) return res.status(400).json({ message: "Customer is required." });
  if (!issue) return res.status(400).json({ message: "Repair issue details are required." });

  ensureOrderColumns(req.db, (columnErr) => {
    if (columnErr) return res.status(500).json({ message: columnErr.message });

    req.db.query(
      "SELECT id, user_id, status, repair_request_status, warranty_expires_at FROM orders WHERE id=?",
      [orderId],
      (selectErr, rows) => {
        if (selectErr) return res.status(500).json({ message: selectErr.message });
        if (!rows.length) return res.status(404).json({ message: "Order not found." });

        const order = rows[0];
        if (Number(order.user_id) !== userId) {
          return res.status(403).json({ message: "You can only request repair for your own order." });
        }

        if (order.status !== "delivered") {
          return res.status(400).json({ message: "Only delivered orders can be requested for repair." });
        }

        if (order.warranty_expires_at && new Date(order.warranty_expires_at).getTime() < Date.now()) {
          return res.status(400).json({ message: "Warranty period has already expired for this order." });
        }

        if (order.repair_request_status === "pending") {
          return res.status(400).json({ message: "Repair request is already pending." });
        }

        req.db.query(
          `UPDATE orders
           SET repair_request_status='pending',
               repair_issue=?,
               repair_admin_note=NULL,
               repair_requested_at=NOW(),
               repair_reviewed_at=NULL
           WHERE id=?`,
          [issue, orderId],
          (updateErr) => {
            if (updateErr) return res.status(500).json({ message: updateErr.message });
            res.json({ message: "Repair request submitted.", status: "pending" });
          }
        );
      }
    );
  });
});

router.put("/:id/repair-request", requireAdmin, (req, res) => {
  const orderId = req.params.id;
  const decision = String(req.body.decision || "").toLowerCase();
  const adminNote = cleanText(req.body.admin_note, 1000);

  if (!["approved", "rejected"].includes(decision)) {
    return res.status(400).json({ message: "Decision must be approved or rejected." });
  }

  ensureOrderColumns(req.db, (columnErr) => {
    if (columnErr) return res.status(500).json({ message: columnErr.message });

    req.db.query(
      "SELECT id, user_id, repair_request_status FROM orders WHERE id=?",
      [orderId],
      (selectErr, rows) => {
        if (selectErr) return res.status(500).json({ message: selectErr.message });
        if (!rows.length) return res.status(404).json({ message: "Order not found." });

        const order = rows[0];
        if (order.repair_request_status !== "pending") {
          return res.status(400).json({ message: "No pending repair request for this order." });
        }

        req.db.query(
          `UPDATE orders
           SET repair_request_status=?,
               repair_service_status=?,
               repair_admin_note=?,
               repair_reviewed_at=NOW()
           WHERE id=?`,
          [decision, decision === "approved" ? "approved" : null, adminNote || null, orderId],
          (updateErr) => {
            if (updateErr) return res.status(500).json({ message: updateErr.message });

            if (order.user_id) {
              createNotification(req.db, {
                user_id: order.user_id,
                title: `Repair request ${decision} for ${orderLabel(order.id)}`,
                message: decision === "approved"
                  ? "Your repair request was approved. Please follow the admin repair instructions."
                  : "Your repair request was rejected. Please check the admin note.",
                type: "order",
                action_url: `/customer/order.html?order_id=${order.id}`
              });
            }

            res.json({ message: `Repair request ${decision}.`, decision });
          }
        );
      }
    );
  });
});

router.put("/:id/repair-status", requireAdminOrStaff, (req, res) => {
  const orderId = req.params.id;
  const status = String(req.body.status || "").toLowerCase();
  const adminNote = cleanText(req.body.admin_note, 1000);
  const allowedStatuses = ["approved", "item_received", "diagnosing", "repairing", "ready_for_pickup", "completed"];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ message: "Invalid repair service status." });
  }

  ensureOrderColumns(req.db, (columnErr) => {
    if (columnErr) return res.status(500).json({ message: columnErr.message });

    req.db.query(
      "SELECT id, user_id, repair_request_status, repair_service_status FROM orders WHERE id=?",
      [orderId],
      (selectErr, rows) => {
        if (selectErr) return res.status(500).json({ message: selectErr.message });
        if (!rows.length) return res.status(404).json({ message: "Order not found." });

        const order = rows[0];
        if (order.repair_request_status !== "approved") {
          return res.status(400).json({ message: "Repair request must be approved before updating service status." });
        }
        const current = order.repair_service_status || 'approved';
        const steps = ['approved', 'item_received', 'diagnosing', 'repairing', 'ready_for_pickup', 'completed'];
        if (req.actorUser.role === 'staff' && status !== current && steps.indexOf(status) !== steps.indexOf(current) + 1) {
          return res.status(403).json({ message: 'Follow the approved repair progress in order.' });
        }

        req.db.query(
          `UPDATE orders
           SET repair_service_status=?,
               repair_admin_note=COALESCE(NULLIF(?, ''), repair_admin_note),
               repair_reviewed_at=NOW()
           WHERE id=?`,
          [status, adminNote, orderId],
          (updateErr) => {
            if (updateErr) return res.status(500).json({ message: updateErr.message });

            if (order.user_id) {
              createNotification(req.db, {
                user_id: order.user_id,
                title: `Repair update for ${orderLabel(order.id)}`,
                message: `Repair status is now ${status.replace(/_/g, " ")}.`,
                type: "order",
                action_url: `/customer/order.html?order_id=${order.id}`
              });
            }

            res.json({ message: "Repair service status updated.", status });
          }
        );
      }
    );
  });
});

router.delete("/:id", requireAdmin, (req, res) => {
  const orderId = req.params.id;

  ensureOrderColumns(req.db, (columnErr) => {
    if (columnErr) return res.status(500).json({ message: columnErr.message });

    req.db.beginTransaction((txErr) => {
      if (txErr) return res.status(500).json({ message: txErr.message });

      req.db.query(`
        SELECT o.id, o.total_price, o.status, o.payment_provider, o.stock_restored_at, u.name AS customer_name
        FROM orders o
        LEFT JOIN users u ON o.user_id = u.id
        WHERE o.id=?
        FOR UPDATE
      `, [orderId], (selectErr, rows) => {
        if (selectErr) return req.db.rollback(() => res.status(500).json({ message: selectErr.message }));
        if (!rows.length) return req.db.rollback(() => res.status(404).json({ message: "Order not found." }));

        const order = rows[0];
        const cleanupQueries = [
          ["DELETE FROM product_reviews WHERE order_id=?", [orderId]],
          ["DELETE FROM installment_schedules WHERE order_id=?", [orderId]],
          ["DELETE FROM installment_applications WHERE order_id=?", [orderId]],
          ["DELETE FROM payments WHERE order_id=?", [orderId]],
          ["DELETE FROM order_items WHERE order_id=?", [orderId]],
          ["DELETE FROM orders WHERE id=?", [orderId]]
        ];

        const actor = auditActor(req);
        const restoreBeforeDelete = (next) => {
          if (String(order.status || "") === "delivered") return next(null, { restored: false, reason: "delivered_order" });
          if (String(order.payment_provider || "").toLowerCase() === "pos") return next(null, { restored: false, reason: "pos_order" });
          restoreOrderStock(req.db, orderId, {
            skipDelivered: true,
            actor,
            source: "order_delete",
            note: `Stock returned before deleting ${orderLabel(orderId)}`
          }, next);
        };

        restoreBeforeDelete((restoreErr, restoreReport) => {
          if (restoreErr) return req.db.rollback(() => res.status(500).json({ message: restoreErr.message }));

          let index = 0;
          function runCleanup() {
            const nextQuery = cleanupQueries[index];
            index += 1;
            if (!nextQuery) {
              const actor = auditActor(req);
              logAudit(req.db, {
                ...actor,
                action: "delete_order",
                entity_type: "order",
                entity_id: orderId,
                details: `${orderLabel(orderId)} deleted | ${order.customer_name || "Customer"} | ${order.total_price || 0} | stock restored ${restoreReport?.restored_quantity || 0}`
              });

              return req.db.commit((commitErr) => {
                if (commitErr) return req.db.rollback(() => res.status(500).json({ message: commitErr.message }));
                res.json({
                  message: "Order deleted.",
                  stock_restored: Boolean(restoreReport?.restored),
                  restored_quantity: restoreReport?.restored_quantity || 0
                });
              });
            }

            req.db.query(nextQuery[0], nextQuery[1], (cleanupErr) => {
              if (cleanupErr && cleanupErr.code !== "ER_NO_SUCH_TABLE") {
                return req.db.rollback(() => res.status(500).json({ message: cleanupErr.message }));
              }
              runCleanup();
            });
          }

          runCleanup();
        });
      });
    });
  });
});
router.put("/:id/status", requireAdminOrStaff, (req, res) => {
  const { status } = req.body;
  if (req.actorUser.role === 'staff' && !['processing', 'shipped'].includes(status)) {
    return res.status(403).json({ message: 'Staff can prepare orders and mark them ready. Only admin can cancel or complete deliveries.' });
  }
  const orderId = req.params.id;
  const adminNote = cleanText(req.body.admin_note, 1000);

  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).json({ message: "Invalid order status" });
  }

  ensureOrderColumns(req.db, (columnErr) => {
    if (columnErr) return res.status(500).json({ message: columnErr.message });

    req.db.query(
      "SELECT id, user_id, status, payment_method, payment_status, payment_provider, cancellation_request_status, delivered_at, warranty_expires_at FROM orders WHERE id=?",
      [orderId],
      (selectErr, rows) => {
        if (selectErr) return res.status(500).json({ message: selectErr.message });
        if (!rows.length) return res.status(404).json({ message: "Order not found" });

        const order = rows[0];
        const currentStatus = order.status || "pending";
        const nextStatus = status;

        if (req.actorUser.role === 'staff' && !paymentReadyForFulfillment(order)) {
          return res.status(400).json({ message: paymentBlockMessage(order) });
        }
        if (['processing', 'shipped'].includes(nextStatus) && order.cancellation_request_status === 'pending') {
          return res.status(400).json({ message: 'Admin must review the pending cancellation request before processing this order.' });
        }

        if (currentStatus === nextStatus) {
          return res.json({
            message: `${orderLabel(order.id)} is already ${ORDER_STATUS_LABELS[nextStatus] || nextStatus}.`,
            status: nextStatus
          });
        }

        if (!canTransitionOrderStatus(currentStatus, nextStatus)) {
          return res.status(400).json({ message: statusTransitionMessage(currentStatus, nextStatus) });
        }

        if (nextStatus === "processing" && !paymentReadyForFulfillment(order)) {
          return res.status(400).json({ message: paymentBlockMessage(order) });
        }

        const updateSqlByStatus = {
          processing: "UPDATE orders SET status=?, processing_at=COALESCE(processing_at, NOW()) WHERE id=?",
          shipped: "UPDATE orders SET status=?, processing_at=COALESCE(processing_at, NOW()), shipped_at=COALESCE(shipped_at, NOW()) WHERE id=?",
          delivered: "UPDATE orders SET status=?, processing_at=COALESCE(processing_at, NOW()), shipped_at=COALESCE(shipped_at, NOW()), delivered_at=COALESCE(delivered_at, NOW()), warranty_expires_at=COALESCE(warranty_expires_at, DATE_ADD(NOW(), INTERVAL 7 DAY)) WHERE id=?",
          cancelled: "UPDATE orders SET status=? WHERE id=?"
        };
        const updateSql = updateSqlByStatus[nextStatus];
        const actor = auditActor(req);
        const statusLabel = ORDER_STATUS_LABELS[nextStatus] || nextStatus;
        const previousLabel = ORDER_STATUS_LABELS[currentStatus] || currentStatus;
        const historyNote = adminNote || `Status changed from ${previousLabel} to ${statusLabel}.`;
        const notificationMessage = adminNote
          ? `${orderStatusNotificationMessage(nextStatus)} Note: ${adminNote}`
          : orderStatusNotificationMessage(nextStatus);

        req.db.beginTransaction((txErr) => {
          if (txErr) return res.status(500).json({ message: txErr.message });

          req.db.query(updateSql, [nextStatus, orderId], (updateErr, result) => {
            if (updateErr) {
              return req.db.rollback(() => res.status(500).json({ message: updateErr.message }));
            }

            if (result.affectedRows === 0) {
              return req.db.rollback(() => res.status(404).json({ message: "Order not found" }));
            }

            insertOrderStatusHistory(req.db, {
              order_id: orderId,
              status: nextStatus,
              note: historyNote,
              actor_role: actor.actor_role,
              actor_name: actor.actor_name
            }, (historyErr) => {
              if (historyErr) {
                return req.db.rollback(() => res.status(500).json({ message: historyErr.message }));
              }

              const finishStockRestore = (next) => {
                if (nextStatus !== "cancelled") return next(null, { restored: false, restored_quantity: 0 });
                restoreOrderStock(req.db, orderId, {
                  skipDelivered: true,
                  actor,
                  source: "status_cancelled",
                  note: `Stock returned after status change to cancelled for ${orderLabel(orderId)}`
                }, next);
              };

              finishStockRestore((restoreErr, restoreReport) => {
                if (restoreErr) {
                  return req.db.rollback(() => res.status(500).json({ message: restoreErr.message }));
                }

                req.db.commit((commitErr) => {
                  if (commitErr) {
                    return req.db.rollback(() => res.status(500).json({ message: commitErr.message }));
                  }

                  if (order.user_id) {
                    createNotification(req.db, {
                      user_id: order.user_id,
                      title: `${orderLabel(order.id)}: ${statusLabel}`,
                      message: restoreReport?.restored
                        ? `${notificationMessage} Reserved stock was returned to inventory.`
                        : notificationMessage,
                      type: "order",
                      action_url: `/customer/order.html?order_id=${order.id}`
                    });
                  }

                  logAudit(req.db, {
                    ...actor,
                    action: "update_order_status",
                    entity_type: "order",
                    entity_id: orderId,
                    details: adminNote
                      ? `${orderLabel(orderId)}: ${previousLabel} to ${statusLabel} | ${adminNote} | stock restored ${restoreReport?.restored_quantity || 0}`
                      : `${orderLabel(orderId)}: ${previousLabel} to ${statusLabel} | stock restored ${restoreReport?.restored_quantity || 0}`
                  });

                  res.json({
                    message: `Order status updated to ${statusLabel}.`,
                    status: nextStatus,
                    status_label: statusLabel,
                    note: historyNote,
                    stock_restored: Boolean(restoreReport?.restored),
                    restored_quantity: restoreReport?.restored_quantity || 0
                  });
                });
              });
            });
          });
        });
      }
    );
  });
});
module.exports = router;

const express = require("express");
const bcrypt = require("bcrypt");
const adminRouter = express.Router();
const riderRouter = express.Router();
const { requireAdmin, requireRider, verifiedActor } = require("./roleGuard");
const { logAudit, auditActor } = require("./auditLogs");
const { createNotification } = require("./notifications");
const { orderLabel } = require("./orderReference");

const ACTIVE_ASSIGNMENT_STATUSES = ["assigned", "picked_up", "out_for_delivery", "failed_attempt"];
const DELIVERY_STATUS_LABELS = {
  assigned: "Assigned",
  picked_up: "Picked Up",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  failed_attempt: "Failed Attempt",
  cancelled: "Cancelled"
};
const STATUS_TRANSITIONS = {
  assigned: ["picked_up", "out_for_delivery", "failed_attempt"],
  picked_up: ["out_for_delivery", "failed_attempt", "delivered"],
  out_for_delivery: ["delivered", "failed_attempt"],
  failed_attempt: ["out_for_delivery", "cancelled"],
  delivered: [],
  cancelled: []
};
const STATUS_TIME_COLUMNS = {
  picked_up: "picked_up_at",
  out_for_delivery: "out_for_delivery_at",
  delivered: "delivered_at",
  failed_attempt: "failed_at",
  cancelled: "cancelled_at"
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

async function ensureDeliveryAssignmentsTable(db) {
  await dbQuery(db, `
    CREATE TABLE IF NOT EXISTS delivery_assignments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      rider_id INT NOT NULL,
      rider_name VARCHAR(255) NULL,
      rider_phone VARCHAR(80) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'assigned',
      pickup_note TEXT NULL,
      delivery_note TEXT NULL,
      failed_reason TEXT NULL,
      assigned_by INT NULL,
      assigned_by_name VARCHAR(255) NULL,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      picked_up_at DATETIME NULL,
      out_for_delivery_at DATETIME NULL,
      delivered_at DATETIME NULL,
      failed_at DATETIME NULL,
      cancelled_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_delivery_order (order_id),
      INDEX idx_delivery_rider (rider_id),
      INDEX idx_delivery_status (status),
      INDEX idx_delivery_assigned (assigned_at)
    )
  `);

  const columns = [
    ["order_id", "INT NULL"],
    ["rider_id", "INT NULL"],
    ["rider_name", "VARCHAR(255) NULL"],
    ["rider_phone", "VARCHAR(80) NULL"],
    ["status", "VARCHAR(40) NOT NULL DEFAULT 'assigned'"],
    ["pickup_note", "TEXT NULL"],
    ["delivery_note", "TEXT NULL"],
    ["failed_reason", "TEXT NULL"],
    ["assigned_by", "INT NULL"],
    ["assigned_by_name", "VARCHAR(255) NULL"],
    ["assigned_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"],
    ["picked_up_at", "DATETIME NULL"],
    ["out_for_delivery_at", "DATETIME NULL"],
    ["delivered_at", "DATETIME NULL"],
    ["failed_at", "DATETIME NULL"],
    ["cancelled_at", "DATETIME NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"],
    ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
  ];

  for (const [column, definition] of columns) {
    await ensureColumn(db, "delivery_assignments", column, definition);
  }
}

function cleanText(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function normalizeEmail(value) {
  return cleanText(value, 255).toLowerCase();
}

function cleanPassword(value) {
  return String(value || "").trim();
}

function isValidPassword(password) {
  return /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/.test(String(password || ""));
}

function httpStatusForError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("not found")) return 404;
  if (/required|valid|invalid|cannot|must|only|already|assigned|delivered|cancelled|cancelled/.test(message)) return 400;
  return 500;
}

function actorFor(req) {
  return verifiedActor(req, auditActor(req));
}

function deliveryStatusLabel(status) {
  return DELIVERY_STATUS_LABELS[status] || cleanText(status, 40).replace(/_/g, " ") || "Assigned";
}

function customerName(order) {
  return order.recipient_name || order.customer_name || "Customer";
}

function customerPhone(order) {
  return order.delivery_contact || order.customer_phone || "";
}

function orderAddress(order) {
  return order.delivery_address || [order.customer_address, order.customer_city, order.customer_province, order.customer_postal_code].filter(Boolean).join(", ");
}

function notifyOrderCustomer(db, order, title, message) {
  if (!order?.user_id) return;
  const orderId = order.id || order.order_id;
  createNotification(db, {
    user_id: order.user_id,
    title,
    message,
    type: "order",
    action_url: `/customer/order.html?order_id=${orderId}`
  });
}

async function insertOrderStatusHistory(db, payload) {
  await dbQuery(db, `
    CREATE TABLE IF NOT EXISTS order_status_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      status VARCHAR(40) NOT NULL,
      note TEXT NULL,
      actor_role VARCHAR(40) NULL,
      actor_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await dbQuery(db, `
    INSERT INTO order_status_history (order_id, status, note, actor_role, actor_name)
    VALUES (?, ?, ?, ?, ?)
  `, [
    payload.order_id,
    payload.status,
    payload.note || null,
    payload.actor_role || "system",
    payload.actor_name || "System"
  ]);
}

async function loadAssignments(db, options = {}) {
  await ensureDeliveryAssignmentsTable(db);
  const where = [];
  const params = [];
  if (options.rider_id) {
    where.push("da.rider_id=?");
    params.push(options.rider_id);
  }
  if (options.active_only) {
    where.push("da.status IN (?)");
    params.push(ACTIVE_ASSIGNMENT_STATUSES);
  }

  const rows = await dbQuery(db, `
    SELECT
      da.*,
      o.id AS order_id,
      o.total_price,
      o.status AS order_status,
      o.payment_method,
      o.payment_status,
      o.recipient_name,
      o.delivery_contact,
      o.delivery_address,
      o.delivery_note,
      o.shipping_region,
      o.shipping_fee,
      o.created_at AS order_created_at,
      u.name AS customer_name,
      u.email AS customer_email,
      u.phone AS customer_phone,
      u.address AS customer_address,
      u.city AS customer_city,
      u.province AS customer_province,
      u.postal_code AS customer_postal_code,
      p.name AS fallback_product_name,
      p.image AS fallback_product_image,
      o.quantity AS fallback_quantity,
      o.variant_name AS fallback_variant_name,
      COALESCE(o.variant_price, o.total_price / NULLIF(o.quantity, 0), o.total_price) AS fallback_unit_price
    FROM delivery_assignments da
    JOIN orders o ON o.id = da.order_id
    LEFT JOIN users u ON u.id = o.user_id
    LEFT JOIN products p ON p.id = o.product_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY
      CASE da.status
        WHEN 'out_for_delivery' THEN 0
        WHEN 'picked_up' THEN 1
        WHEN 'assigned' THEN 2
        WHEN 'failed_attempt' THEN 3
        WHEN 'delivered' THEN 4
        ELSE 5
      END,
      da.assigned_at DESC,
      da.id DESC
  `, params);

  if (!rows.length) return [];
  const orderIds = [...new Set(rows.map(row => row.order_id).filter(Boolean))];
  let itemRows = [];
  if (orderIds.length) {
    itemRows = await dbQuery(db, "SELECT * FROM order_items WHERE order_id IN (?) ORDER BY id ASC", [orderIds]);
  }
  const itemsByOrder = itemRows.reduce((map, item) => {
    if (!map[item.order_id]) map[item.order_id] = [];
    map[item.order_id].push(item);
    return map;
  }, {});

  return rows.map(row => {
    const items = itemsByOrder[row.order_id] || [];
    const fallbackItem = row.fallback_product_name ? [{
      product_name: row.fallback_product_name,
      product_image: row.fallback_product_image,
      quantity: row.fallback_quantity || 1,
      variant_name: row.fallback_variant_name,
      unit_price: row.fallback_unit_price || 0,
      subtotal: row.total_price || 0
    }] : [];
    return {
      ...row,
      customer_display_name: customerName(row),
      customer_display_phone: customerPhone(row),
      delivery_display_address: orderAddress(row),
      status_label: deliveryStatusLabel(row.status),
      items: items.length ? items : fallbackItem
    };
  });
}

function buildAssignmentSummary(items) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    total_count: items.length,
    active_count: items.filter(item => ACTIVE_ASSIGNMENT_STATUSES.includes(item.status)).length,
    assigned_count: items.filter(item => item.status === "assigned").length,
    picked_up_count: items.filter(item => item.status === "picked_up").length,
    out_for_delivery_count: items.filter(item => item.status === "out_for_delivery").length,
    failed_attempt_count: items.filter(item => item.status === "failed_attempt").length,
    delivered_today_count: items.filter(item => item.status === "delivered" && String(item.delivered_at || "").slice(0, 10) === today).length
  };
}

async function loadOrderForAssignment(db, orderId, lock = false) {
  const suffix = lock ? " FOR UPDATE" : "";
  const rows = await dbQuery(db, `
    SELECT
      o.*,
      u.name AS customer_name,
      u.email AS customer_email,
      u.phone AS customer_phone,
      u.address AS customer_address,
      u.city AS customer_city,
      u.province AS customer_province,
      u.postal_code AS customer_postal_code
    FROM orders o
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.id=?
    ${suffix}
  `, [orderId]);
  return rows[0] || null;
}

async function loadRider(db, riderId) {
  const rows = await dbQuery(db, "SELECT id, name, email, phone, role FROM users WHERE id=? AND role='rider' LIMIT 1", [riderId]);
  return rows[0] || null;
}

adminRouter.get("/", requireAdmin, async (req, res) => {
  try {
    const riders = await dbQuery(req.db, "SELECT id, name, email, phone, role FROM users WHERE role='rider' ORDER BY id DESC");
    res.json(riders);
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load riders." });
  }
});

adminRouter.post("/", requireAdmin, async (req, res) => {
  const name = cleanText(req.body.name, 255);
  const email = normalizeEmail(req.body.email);
  const phone = cleanText(req.body.phone, 80);
  const password = cleanPassword(req.body.password);

  if (!name || !email || !phone || !password) {
    return res.status(400).json({ message: "Name, email, phone, and password are required." });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ message: "Password must have 8 characters, uppercase letter, number, and special character." });
  }

  try {
    const existing = await dbQuery(req.db, "SELECT id FROM users WHERE LOWER(TRIM(email))=? LIMIT 1", [email]);
    if (existing.length) return res.status(400).json({ message: "Email already exists." });
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await dbQuery(req.db, "INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, 'rider', ?)", [name, email, hashedPassword, phone]);
    const actor = actorFor(req);
    logAudit(req.db, {
      ...actor,
      action: "create_rider",
      entity_type: "rider",
      entity_id: result.insertId,
      details: `${name} | ${email} | ${phone}`
    });
    res.json({ message: "Rider account created.", rider: { id: result.insertId, name, email, phone, role: "rider" } });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to create rider account." });
  }
});

adminRouter.delete("/:id", requireAdmin, async (req, res) => {
  try {
    await ensureDeliveryAssignmentsTable(req.db);
    const active = await dbQuery(req.db, "SELECT COUNT(*) AS count FROM delivery_assignments WHERE rider_id=? AND status IN (?)", [req.params.id, ACTIVE_ASSIGNMENT_STATUSES]);
    if (Number(active[0]?.count || 0) > 0) {
      return res.status(400).json({ message: "This rider still has active delivery assignments." });
    }
    const result = await dbQuery(req.db, "DELETE FROM users WHERE id=? AND role='rider'", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: "Rider account not found." });
    const actor = actorFor(req);
    logAudit(req.db, {
      ...actor,
      action: "delete_rider",
      entity_type: "rider",
      entity_id: req.params.id,
      details: `Rider #${req.params.id} deleted`
    });
    res.json({ message: "Rider account deleted." });
  } catch (error) {
    res.status(httpStatusForError(error)).json({ message: error.message || "Unable to delete rider account." });
  }
});

adminRouter.get("/assignments", requireAdmin, async (req, res) => {
  try {
    const items = await loadAssignments(req.db);
    res.json({ summary: buildAssignmentSummary(items), items });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load delivery assignments." });
  }
});

adminRouter.post("/assignments", requireAdmin, async (req, res) => {
  const orderId = Number(req.body.order_id);
  const riderId = Number(req.body.rider_id);
  const note = cleanText(req.body.note, 1000);
  const actor = actorFor(req);

  if (!orderId || !riderId) {
    return res.status(400).json({ message: "Order and rider are required." });
  }

  try {
    await ensureDeliveryAssignmentsTable(req.db);
    await beginTransaction(req.db);

    const order = await loadOrderForAssignment(req.db, orderId, true);
    if (!order) throw new Error("Order not found.");
    if (["cancelled", "delivered"].includes(String(order.status || "").toLowerCase())) {
      throw new Error("Cancelled or completed orders cannot be assigned to a rider.");
    }

    const rider = await loadRider(req.db, riderId);
    if (!rider) throw new Error("Rider account not found.");

    const existing = await dbQuery(req.db, "SELECT * FROM delivery_assignments WHERE order_id=? AND status IN (?) FOR UPDATE", [orderId, ACTIVE_ASSIGNMENT_STATUSES]);
    let assignmentId;
    if (existing.length) {
      assignmentId = existing[0].id;
      await dbQuery(req.db, `
        UPDATE delivery_assignments
        SET rider_id=?, rider_name=?, rider_phone=?, status='assigned', pickup_note=NULL, delivery_note=?, failed_reason=NULL,
            assigned_by=?, assigned_by_name=?, assigned_at=NOW(), picked_up_at=NULL, out_for_delivery_at=NULL, failed_at=NULL, cancelled_at=NULL
        WHERE id=?
      `, [rider.id, rider.name, rider.phone || null, note || null, actor.actor_id || null, actor.actor_name || null, assignmentId]);
    } else {
      const result = await dbQuery(req.db, `
        INSERT INTO delivery_assignments
        (order_id, rider_id, rider_name, rider_phone, status, delivery_note, assigned_by, assigned_by_name, assigned_at)
        VALUES (?, ?, ?, ?, 'assigned', ?, ?, ?, NOW())
      `, [orderId, rider.id, rider.name, rider.phone || null, note || null, actor.actor_id || null, actor.actor_name || null]);
      assignmentId = result.insertId;
    }

    await insertOrderStatusHistory(req.db, {
      order_id: orderId,
      status: order.status || "pending",
      note: `Assigned to rider ${rider.name}. ${note}`.trim(),
      actor_role: actor.actor_role,
      actor_name: actor.actor_name
    });

    await commitTransaction(req.db);

    logAudit(req.db, {
      ...actor,
      action: "assign_rider",
      entity_type: "delivery_assignment",
      entity_id: assignmentId,
      details: `${orderLabel(orderId)} | ${rider.name} | ${customerName(order)}`
    });
    notifyOrderCustomer(req.db, order, `${orderLabel(orderId)} assigned to rider`, `${rider.name} will handle your delivery. Please keep your phone available.`);
    res.json({ message: "Rider assigned to order.", assignment_id: assignmentId });
  } catch (error) {
    await rollbackTransaction(req.db);
    res.status(httpStatusForError(error)).json({ message: error.message || "Unable to assign rider." });
  }
});

adminRouter.post("/assignments/:id/cancel", requireAdmin, async (req, res) => {
  const reason = cleanText(req.body.reason, 1000) || "Delivery assignment cancelled by admin.";
  const actor = actorFor(req);

  try {
    await ensureDeliveryAssignmentsTable(req.db);
    const rows = await dbQuery(req.db, "SELECT da.*, o.user_id, o.id AS order_id, o.recipient_name, o.delivery_contact, u.name AS customer_name FROM delivery_assignments da JOIN orders o ON o.id=da.order_id LEFT JOIN users u ON u.id=o.user_id WHERE da.id=? LIMIT 1", [req.params.id]);
    const assignment = rows[0];
    if (!assignment) return res.status(404).json({ message: "Delivery assignment not found." });
    if (["delivered", "cancelled"].includes(assignment.status)) return res.status(400).json({ message: "This delivery assignment is already closed." });

    await dbQuery(req.db, "UPDATE delivery_assignments SET status='cancelled', failed_reason=?, cancelled_at=NOW() WHERE id=?", [reason, assignment.id]);
    logAudit(req.db, {
      ...actor,
      action: "cancel_delivery_assignment",
      entity_type: "delivery_assignment",
      entity_id: assignment.id,
      details: `${orderLabel(assignment.order_id)} | ${assignment.rider_name || "Rider"} | ${reason}`
    });
    notifyOrderCustomer(req.db, assignment, `${orderLabel(assignment.order_id)} delivery update`, "Your delivery assignment was updated by the shop.");
    res.json({ message: "Delivery assignment cancelled.", status: "cancelled" });
  } catch (error) {
    res.status(httpStatusForError(error)).json({ message: error.message || "Unable to cancel assignment." });
  }
});

riderRouter.get("/assignments", requireRider, async (req, res) => {
  try {
    const items = await loadAssignments(req.db, { rider_id: req.actorUser.id });
    res.json({ summary: buildAssignmentSummary(items), items });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load rider deliveries." });
  }
});

riderRouter.put("/assignments/:id/status", requireRider, async (req, res) => {
  const nextStatus = cleanText(req.body.status, 40).toLowerCase();
  const note = cleanText(req.body.note, 1000);
  const actor = actorFor(req);

  if (!DELIVERY_STATUS_LABELS[nextStatus] || nextStatus === "cancelled") {
    return res.status(400).json({ message: "Invalid delivery status." });
  }

  try {
    await ensureDeliveryAssignmentsTable(req.db);
    await beginTransaction(req.db);

    const rows = await dbQuery(req.db, `
      SELECT da.*, o.status AS order_status, o.user_id, o.recipient_name, o.delivery_contact, o.delivery_address, u.name AS customer_name
      FROM delivery_assignments da
      JOIN orders o ON o.id=da.order_id
      LEFT JOIN users u ON u.id=o.user_id
      WHERE da.id=? AND da.rider_id=?
      FOR UPDATE
    `, [req.params.id, req.actorUser.id]);
    const assignment = rows[0];
    if (!assignment) throw new Error("Delivery assignment not found.");
    if (["delivered", "cancelled"].includes(assignment.status)) throw new Error("This delivery assignment is already closed.");

    const allowedNext = STATUS_TRANSITIONS[assignment.status] || [];
    if (!allowedNext.includes(nextStatus)) {
      throw new Error(`${deliveryStatusLabel(assignment.status)} cannot move directly to ${deliveryStatusLabel(nextStatus)}.`);
    }

    const timeColumn = STATUS_TIME_COLUMNS[nextStatus];
    const noteColumn = nextStatus === "failed_attempt" ? "failed_reason" : nextStatus === "picked_up" ? "pickup_note" : "delivery_note";
    await dbQuery(req.db, `
      UPDATE delivery_assignments
      SET status=?, ${noteColumn}=COALESCE(NULLIF(?, ''), ${noteColumn}), ${timeColumn}=NOW()
      WHERE id=?
    `, [nextStatus, note, assignment.id]);

    if (["picked_up", "out_for_delivery"].includes(nextStatus) && !["shipped", "delivered"].includes(assignment.order_status)) {
      await dbQuery(req.db, "UPDATE orders SET status='shipped', processing_at=COALESCE(processing_at, NOW()), shipped_at=COALESCE(shipped_at, NOW()) WHERE id=?", [assignment.order_id]);
      await insertOrderStatusHistory(req.db, {
        order_id: assignment.order_id,
        status: "shipped",
        note: note || `Rider marked delivery as ${deliveryStatusLabel(nextStatus)}.`,
        actor_role: "rider",
        actor_name: actor.actor_name
      });
    }

    if (nextStatus === "delivered") {
      await dbQuery(req.db, "UPDATE orders SET status='delivered', processing_at=COALESCE(processing_at, NOW()), shipped_at=COALESCE(shipped_at, NOW()), delivered_at=COALESCE(delivered_at, NOW()), warranty_expires_at=COALESCE(warranty_expires_at, DATE_ADD(NOW(), INTERVAL 7 DAY)) WHERE id=?", [assignment.order_id]);
      await insertOrderStatusHistory(req.db, {
        order_id: assignment.order_id,
        status: "delivered",
        note: note || "Order delivered by rider.",
        actor_role: "rider",
        actor_name: actor.actor_name
      });
    }

    if (nextStatus === "failed_attempt") {
      await insertOrderStatusHistory(req.db, {
        order_id: assignment.order_id,
        status: assignment.order_status || "shipped",
        note: note || "Delivery attempt failed.",
        actor_role: "rider",
        actor_name: actor.actor_name
      });
    }

    await commitTransaction(req.db);

    logAudit(req.db, {
      ...actor,
      action: "update_delivery_status",
      entity_type: "delivery_assignment",
      entity_id: assignment.id,
      details: `${orderLabel(assignment.order_id)} | ${deliveryStatusLabel(nextStatus)} | ${note || "No note"}`
    });

    const customerMessage = nextStatus === "delivered"
      ? "Your order has been delivered. Thank you for shopping with us."
      : nextStatus === "failed_attempt"
        ? "Delivery attempt was not completed. The rider or shop may contact you for the next attempt."
        : `Your order delivery is now ${deliveryStatusLabel(nextStatus)}.`;
    notifyOrderCustomer(req.db, assignment, `${orderLabel(assignment.order_id)} delivery update`, customerMessage);
    res.json({ message: "Delivery status updated.", status: nextStatus, status_label: deliveryStatusLabel(nextStatus) });
  } catch (error) {
    await rollbackTransaction(req.db);
    res.status(httpStatusForError(error)).json({ message: error.message || "Unable to update delivery status." });
  }
});

module.exports = adminRouter;
module.exports.riderRouter = riderRouter;
module.exports.ensureDeliveryAssignmentsTable = ensureDeliveryAssignmentsTable;

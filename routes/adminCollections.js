const express = require("express");
const router = express.Router();
const { requireAdmin, verifiedActor } = require("./roleGuard");
const { createNotification, ensureNotificationsTable } = require("./notifications");
const { logAudit, auditActor } = require("./auditLogs");
const { orderLabel } = require("./orderReference");

function dbQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function scheduleBalance(schedule) {
  return Math.max(toNumber(schedule.amount_due) - toNumber(schedule.amount_paid), 0);
}

function collectionStatus(schedule) {
  const balance = scheduleBalance(schedule);
  if ((schedule.status || "") === "paid" || balance <= 0) return "paid";
  if (Number(schedule.days_overdue || 0) > 0) return "overdue";
  if (Number(schedule.days_until_due || 999) === 0) return "due_today";
  if (Number(schedule.days_until_due || 999) <= 7) return "due_soon";
  if ((schedule.status || "") === "partial") return "partial";
  return "current";
}

function collectionStatusLabel(status) {
  const labels = {
    overdue: "Overdue",
    due_today: "Due today",
    due_soon: "Due soon",
    partial: "Partial",
    current: "Current",
    paid: "Paid"
  };
  return labels[status] || status || "Current";
}

function reminderTitle(schedule) {
  return `Installment ${schedule.installment_no} ${collectionStatusLabel(collectionStatus(schedule))}`;
}

function reminderMessage(schedule) {
  const status = collectionStatus(schedule);
  const balance = scheduleBalance(schedule).toFixed(2);
  const dueDate = String(schedule.due_date || "").slice(0, 10);
  if (status === "overdue") {
    return `Your installment ${schedule.installment_no} for ${orderLabel(schedule.order_id)} is overdue. Remaining balance: PHP ${balance}. Please settle it as soon as possible.`;
  }
  if (status === "due_today") {
    return `Your installment ${schedule.installment_no} for ${orderLabel(schedule.order_id)} is due today. Amount to pay: PHP ${balance}.`;
  }
  return `Reminder: installment ${schedule.installment_no} for ${orderLabel(schedule.order_id)} is due on ${dueDate}. Amount to pay: PHP ${balance}.`;
}

async function ensureInstallmentScheduleTable(db) {
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
}

async function refreshOverdueSchedules(db) {
  await ensureInstallmentScheduleTable(db);
  await dbQuery(db, `
    UPDATE installment_schedules
    SET status='overdue'
    WHERE status != 'paid'
      AND due_date < CURDATE()
      AND amount_paid < amount_due
  `);
}

async function loadCollectionItems(db) {
  await refreshOverdueSchedules(db);
  const rows = await dbQuery(db, `
    SELECT
      s.*,
      GREATEST(s.amount_due - s.amount_paid, 0) AS balance,
      DATEDIFF(CURDATE(), s.due_date) AS days_overdue,
      DATEDIFF(s.due_date, CURDATE()) AS days_until_due,
      ia.full_name,
      ia.phone,
      ia.downpayment_status,
      ia.status AS application_status,
      u.name AS customer_name,
      u.email AS customer_email,
      p.name AS product_name,
      o.payment_status AS order_payment_status,
      o.status AS order_status
    FROM installment_schedules s
    LEFT JOIN installment_applications ia ON s.application_id = ia.id
    LEFT JOIN users u ON s.user_id = u.id
    LEFT JOIN orders o ON s.order_id = o.id
    LEFT JOIN products p ON o.product_id = p.id
    WHERE s.status != 'paid'
      AND s.amount_paid < s.amount_due
    ORDER BY
      CASE
        WHEN s.due_date < CURDATE() THEN 0
        WHEN s.due_date = CURDATE() THEN 1
        WHEN s.due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 2
        ELSE 3
      END,
      s.due_date ASC,
      s.id ASC
  `);

  return rows.map(row => {
    const status = collectionStatus(row);
    const balance = scheduleBalance(row);
    return {
      ...row,
      balance,
      collection_status: status,
      collection_status_label: collectionStatusLabel(status),
      order_reference: orderLabel(row.order_id),
      reminder_title: reminderTitle(row),
      reminder_message: reminderMessage(row)
    };
  });
}

function buildSummary(items) {
  const active = items.filter(item => item.collection_status !== "paid");
  const statusAmount = (status) => active
    .filter(item => item.collection_status === status)
    .reduce((sum, item) => sum + toNumber(item.balance), 0);
  return {
    total_count: active.length,
    total_balance: active.reduce((sum, item) => sum + toNumber(item.balance), 0),
    overdue_count: active.filter(item => item.collection_status === "overdue").length,
    overdue_amount: statusAmount("overdue"),
    due_today_count: active.filter(item => item.collection_status === "due_today").length,
    due_today_amount: statusAmount("due_today"),
    due_soon_count: active.filter(item => item.collection_status === "due_soon").length,
    due_soon_amount: statusAmount("due_soon"),
    current_count: active.filter(item => ["current", "partial"].includes(item.collection_status)).length,
    current_amount: active
      .filter(item => ["current", "partial"].includes(item.collection_status))
      .reduce((sum, item) => sum + toNumber(item.balance), 0)
  };
}

async function loadSchedule(db, scheduleId) {
  const items = await loadCollectionItems(db);
  return items.find(item => Number(item.id) === Number(scheduleId)) || null;
}

function ensureNotificationsAsync(db) {
  return new Promise((resolve, reject) => {
    ensureNotificationsTable(db, (err) => err ? reject(err) : resolve());
  });
}

function createNotificationAsync(db, payload) {
  return new Promise((resolve, reject) => {
    createNotification(db, payload, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

async function hasReminderToday(db, schedule) {
  const title = reminderTitle(schedule);
  const actionUrl = `/customer/order.html?order_id=${schedule.order_id}`;
  const rows = await dbQuery(db, `
    SELECT id
    FROM notifications
    WHERE user_id=?
      AND title=?
      AND action_url=?
      AND DATE(created_at)=CURDATE()
    LIMIT 1
  `, [schedule.user_id, title, actionUrl]);
  return rows.length > 0;
}

async function sendScheduleReminder(db, schedule, req) {
  if (!schedule) throw new Error("Installment schedule not found.");
  if (schedule.collection_status === "paid" || scheduleBalance(schedule) <= 0) {
    throw new Error("This installment schedule is already paid.");
  }

  await ensureNotificationsAsync(db);
  const duplicate = await hasReminderToday(db, schedule);
  if (duplicate) {
    return { sent: false, duplicate: true, message: "Reminder was already sent today." };
  }

  const payload = {
    user_id: schedule.user_id,
    title: reminderTitle(schedule),
    message: reminderMessage(schedule),
    type: "payment",
    action_url: `/customer/order.html?order_id=${schedule.order_id}`
  };
  await createNotificationAsync(db, payload);

  const actor = verifiedActor(req, auditActor(req));
  logAudit(db, {
    ...actor,
    action: "send_installment_reminder",
    entity_type: "installment_schedule",
    entity_id: schedule.id,
    details: `${schedule.order_reference} | ${schedule.collection_status_label} | ${schedule.customer_email || schedule.full_name || "Customer"}`
  });

  return { sent: true, duplicate: false, message: "Reminder sent.", notification: payload };
}

router.get("/", requireAdmin, async (req, res) => {
  try {
    const items = await loadCollectionItems(req.db);
    res.json({ summary: buildSummary(items), items });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load collections." });
  }
});

router.post("/schedules/:id/notify", requireAdmin, async (req, res) => {
  try {
    const schedule = await loadSchedule(req.db, req.params.id);
    if (!schedule) return res.status(404).json({ message: "Installment schedule not found." });
    const result = await sendScheduleReminder(req.db, schedule, req);
    res.json({ schedule_id: schedule.id, order_id: schedule.order_id, ...result });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to send reminder." });
  }
});

router.post("/notify-due", requireAdmin, async (req, res) => {
  try {
    const rawStatus = String(req.body.status || "actionable").toLowerCase();
    const allowed = ["overdue", "due_today", "due_soon", "actionable", "all"];
    const filter = allowed.includes(rawStatus) ? rawStatus : "actionable";
    const items = await loadCollectionItems(req.db);
    const targets = items.filter(item => {
      if (filter === "all") return item.collection_status !== "paid";
      if (filter === "actionable") return ["overdue", "due_today", "due_soon"].includes(item.collection_status);
      return item.collection_status === filter;
    });

    const results = [];
    for (const item of targets) {
      try {
        results.push({ schedule_id: item.id, ...(await sendScheduleReminder(req.db, item, req)) });
      } catch (error) {
        results.push({ schedule_id: item.id, sent: false, error: error.message });
      }
    }

    res.json({
      message: "Reminder run complete.",
      filter,
      total: targets.length,
      sent: results.filter(item => item.sent).length,
      skipped: results.filter(item => item.duplicate).length,
      failed: results.filter(item => item.error).length,
      results
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to send reminders." });
  }
});

module.exports = router;
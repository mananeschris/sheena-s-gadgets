const express = require("express");
const router = express.Router();
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

function dateKey(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function isPaidOrder(order) {
  return ["paid", "installment_completed"].includes(String(order.payment_status || "").toLowerCase());
}

function scheduleStatus(schedule, todayKey) {
  const status = String(schedule.status || "unpaid").toLowerCase();
  const remaining = Math.max(toNumber(schedule.amount_due) - toNumber(schedule.amount_paid), 0);
  const dueDate = dateKey(schedule.due_date);
  if (status === "paid" || remaining <= 0) return "paid";
  if (dueDate && dueDate < todayKey) return "overdue";
  if (dueDate && dueDate <= dateKey(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))) return "due_soon";
  return status === "partial" ? "partial" : "current";
}

function paymentRowsByOrder(payments) {
  return payments.reduce((map, payment) => {
    const key = Number(payment.order_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(payment);
    return map;
  }, new Map());
}

function scheduleRowsByOrder(schedules) {
  return schedules.reduce((map, schedule) => {
    const key = Number(schedule.order_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(schedule);
    return map;
  }, new Map());
}

function buildStatement(order, paymentRows = [], scheduleRows = []) {
  const todayKey = dateKey(new Date());
  const schedules = scheduleRows.map(schedule => {
    const amountDue = toNumber(schedule.amount_due);
    const amountPaid = toNumber(schedule.amount_paid);
    const balance = Math.max(amountDue - amountPaid, 0);
    const status = scheduleStatus(schedule, todayKey);
    return {
      id: schedule.id,
      installment_no: schedule.installment_no,
      due_date: schedule.due_date,
      amount_due: amountDue,
      amount_paid: amountPaid,
      balance,
      status,
      raw_status: schedule.status || "unpaid",
      paid_at: schedule.paid_at,
      payment_method: schedule.payment_method,
      payment_provider: schedule.payment_provider,
      payment_reference: schedule.payment_reference,
      payment_checkout_id: schedule.payment_checkout_id,
      payment_checkout_url: schedule.payment_checkout_url,
      payment_status: schedule.payment_status,
      payment_error: schedule.payment_error,
      payment_last_checked_at: schedule.payment_last_checked_at
    };
  });

  const payments = paymentRows.map((payment, index) => ({
    id: payment.id,
    entry_no: index + 1,
    amount_paid: toNumber(payment.amount_paid),
    balance: toNumber(payment.balance),
    status: payment.status || "recorded",
    due_date: payment.due_date,
    paid_at: payment.paid_at,
    created_at: payment.created_at
  }));

  const scheduleTotalDue = schedules.reduce((sum, schedule) => sum + toNumber(schedule.amount_due), 0);
  const schedulePaid = schedules.reduce((sum, schedule) => sum + toNumber(schedule.amount_paid), 0);
  const ledgerPaid = payments.reduce((sum, payment) => sum + toNumber(payment.amount_paid), 0);
  const paidFromOrderStatus = !schedules.length && isPaidOrder(order) ? toNumber(order.total_price) : 0;
  const totalPaid = Math.max(schedulePaid + Math.max(ledgerPaid - schedulePaid, 0), paidFromOrderStatus);
  const scheduledBalance = schedules.reduce((sum, schedule) => sum + toNumber(schedule.balance), 0);
  const fallbackBalance = Math.max(toNumber(order.total_price) - totalPaid, 0);
  const balance = schedules.length ? scheduledBalance : toNumber(order.installment_balance || fallbackBalance);
  const unpaidSchedules = schedules.filter(schedule => schedule.status !== "paid" && toNumber(schedule.balance) > 0);
  const overdueSchedules = schedules.filter(schedule => schedule.status === "overdue");
  const nextDue = unpaidSchedules
    .slice()
    .sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")))[0] || null;

  return {
    order_id: order.id,
    order_reference: orderLabel(order.id),
    user_id: order.user_id,
    customer_name: order.customer_name || order.recipient_name || "Customer",
    customer_email: order.customer_email || "",
    product_name: order.product_name || "Order items",
    payment_method: order.payment_method || "cod",
    payment_status: order.payment_status || null,
    order_status: order.status || "pending",
    total_price: toNumber(order.total_price),
    installment_terms: order.installment_terms,
    installment_downpayment: toNumber(order.installment_downpayment),
    installment_monthly: toNumber(order.installment_monthly),
    installment_balance: balance,
    created_at: order.created_at,
    total_paid: totalPaid,
    ledger_paid: ledgerPaid,
    schedule_paid: schedulePaid,
    schedule_total_due: scheduleTotalDue,
    balance,
    overdue_count: overdueSchedules.length,
    overdue_amount: overdueSchedules.reduce((sum, schedule) => sum + toNumber(schedule.balance), 0),
    next_due_date: nextDue?.due_date || null,
    next_due_amount: nextDue ? toNumber(nextDue.balance) : 0,
    schedules,
    payments
  };
}

async function loadStatementsForOrders(db, orders) {
  if (!orders.length) return [];
  const ids = orders.map(order => Number(order.id)).filter(Boolean);
  const placeholders = ids.map(() => "?").join(",");
  const [payments, schedules] = await Promise.all([
    dbQuery(db, `SELECT * FROM payments WHERE order_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`, ids),
    dbQuery(db, `SELECT * FROM installment_schedules WHERE order_id IN (${placeholders}) ORDER BY due_date ASC, installment_no ASC`, ids)
  ]);
  const paymentsMap = paymentRowsByOrder(payments);
  const schedulesMap = scheduleRowsByOrder(schedules);
  return orders.map(order => buildStatement(order, paymentsMap.get(Number(order.id)) || [], schedulesMap.get(Number(order.id)) || []));
}

function statementSummary(statements) {
  const installmentStatements = statements.filter(statement =>
    statement.payment_method === "installment" || statement.schedules.length || Number(statement.installment_terms || 0) > 0
  );
  const nextDue = installmentStatements
    .filter(statement => statement.next_due_date)
    .sort((a, b) => String(a.next_due_date).localeCompare(String(b.next_due_date)))[0] || null;

  return {
    total_orders: statements.length,
    installment_orders: installmentStatements.length,
    total_billed: statements.reduce((sum, item) => sum + toNumber(item.total_price), 0),
    total_paid: statements.reduce((sum, item) => sum + toNumber(item.total_paid), 0),
    total_balance: statements.reduce((sum, item) => sum + toNumber(item.balance), 0),
    overdue_count: installmentStatements.reduce((sum, item) => sum + Number(item.overdue_count || 0), 0),
    overdue_amount: installmentStatements.reduce((sum, item) => sum + toNumber(item.overdue_amount), 0),
    next_due_date: nextDue?.next_due_date || null,
    next_due_amount: nextDue?.next_due_amount || 0,
    generated_at: new Date().toISOString()
  };
}

router.get("/order/:order_id", async (req, res) => {
  const orderId = Number(req.params.order_id);
  const userId = Number(req.query.user_id || 0);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({ message: "Valid order id is required." });
  }

  try {
    const orders = await dbQuery(req.db, `
      SELECT
        o.*,
        u.name AS customer_name,
        u.email AS customer_email,
        p.name AS product_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.id=?
      LIMIT 1
    `, [orderId]);

    if (!orders.length) return res.status(404).json({ message: "Order not found." });
    if (userId && Number(orders[0].user_id) !== userId) {
      return res.status(403).json({ message: "This statement is not linked to your account." });
    }

    const statements = await loadStatementsForOrders(req.db, orders);
    res.json({
      message: "Statement of Account",
      order_id: orderId,
      statement: statements[0],
      summary: statementSummary(statements)
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load statement of account." });
  }
});

router.get("/:user_id", async (req, res) => {
  const userId = Number(req.params.user_id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Valid user id is required." });
  }

  try {
    const orders = await dbQuery(req.db, `
      SELECT
        o.*,
        u.name AS customer_name,
        u.email AS customer_email,
        p.name AS product_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.user_id=?
      ORDER BY o.created_at DESC, o.id DESC
    `, [userId]);

    const statements = await loadStatementsForOrders(req.db, orders);
    res.json({
      message: "Statement of Account",
      user_id: userId,
      summary: statementSummary(statements),
      soa: statements
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load statement of account." });
  }
});

module.exports = router;
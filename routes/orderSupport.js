const express = require("express");
const crypto = require("crypto");
const { query, sameOrigin } = require("./chatSession");
const { storeSession } = require("./adminSessions");

const router = express.Router();
const schemaPromises = new WeakMap();
const validId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;

function ensureSupportSchema(db) {
  if (!schemaPromises.has(db)) {
    const promise = (async () => {
      await query(db, `CREATE TABLE IF NOT EXISTS order_support_threads (
        id INT AUTO_INCREMENT PRIMARY KEY, order_id INT NOT NULL, customer_id INT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY idx_support_order_customer (order_id, customer_id),
        INDEX idx_support_customer (customer_id), INDEX idx_support_updated (updated_at)
      )`);
      await query(db, `CREATE TABLE IF NOT EXISTS order_support_messages (
        id INT AUTO_INCREMENT PRIMARY KEY, thread_id INT NOT NULL, sender_id INT NOT NULL,
        client_id CHAR(36) NOT NULL, body TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        read_at DATETIME NULL, UNIQUE KEY idx_support_retry (thread_id, sender_id, client_id),
        INDEX idx_support_messages (thread_id, id)
      )`);
    })().catch(error => { schemaPromises.delete(db); throw error; });
    schemaPromises.set(db, promise);
  }
  return schemaPromises.get(db);
}

async function requireSupportUser(req, res, next) {
  try {
    const session = await storeSession(req);
    if (!session) return res.status(401).json({ message: "Sign in again to use seller support." });
    if (!["customer", "admin", "staff"].includes(String(session.role).toLowerCase())) return res.status(403).json({ message: "Seller support is unavailable for this account." });
    req.supportUser = { ...session, role: String(session.role).toLowerCase() };
    res.set("Cache-Control", "no-store");
    await ensureSupportSchema(req.db);
    next();
  } catch (_) { res.status(503).json({ message: "Seller support is temporarily unavailable." }); }
}

function customerAccess(user) { return user.role === "customer" ? "t.customer_id=? AND o.user_id=t.customer_id" : "1=1"; }
const threadSelect = `SELECT t.id, t.order_id, t.customer_id, t.status, t.created_at, t.updated_at,
  c.name AS customer_name, c.email AS customer_email,
  COALESCE((SELECT oi.product_name FROM order_items oi WHERE oi.order_id=t.order_id ORDER BY oi.id LIMIT 1), p.name, 'Order') AS product_name,
  COALESCE((SELECT oi.product_image FROM order_items oi WHERE oi.order_id=t.order_id ORDER BY oi.id LIMIT 1), p.image) AS product_image,
  o.status AS order_status
  FROM order_support_threads t JOIN orders o ON o.id=t.order_id JOIN users c ON c.id=t.customer_id
  LEFT JOIN products p ON p.id=o.product_id`;

router.use(sameOrigin, requireSupportUser);

router.get("/threads", async (req, res) => {
  try {
    const params = req.supportUser.role === "customer" ? [req.supportUser.id] : [];
    const threads = await query(req.db, `${threadSelect} WHERE ${customerAccess(req.supportUser)} ORDER BY t.updated_at DESC, t.id DESC`, params);
    const ids = threads.map(item => item.id);
    if (!ids.length) return res.json({ threads: [], unread_count: 0 });
    const summaries = await query(req.db, `SELECT m.thread_id, SUM(m.sender_id<>? AND m.read_at IS NULL) unread_count,
      MAX(m.id) last_id FROM order_support_messages m WHERE m.thread_id IN (?) GROUP BY m.thread_id`, [req.supportUser.id, ids]);
    const lastIds = summaries.map(item => item.last_id);
    const latest = lastIds.length ? await query(req.db, "SELECT id, body, created_at FROM order_support_messages WHERE id IN (?)", [lastIds]) : [];
    const bySummary = new Map(summaries.map(item => [item.thread_id, item]));
    const byLast = new Map(latest.map(item => [item.id, item]));
    const result = threads.map(thread => {
      const summary = bySummary.get(thread.id); const last = byLast.get(summary?.last_id);
      return { ...thread, unread_count: Number(summary?.unread_count || 0), last_message: last?.body || "", last_message_at: last?.created_at || thread.updated_at };
    });
    res.json({ threads: result, unread_count: result.reduce((total, item) => total + item.unread_count, 0) });
  } catch (_) { res.status(500).json({ message: "Unable to load seller support conversations." }); }
});

router.post("/threads", async (req, res) => {
  const orderId = Number(req.body.order_id);
  if (!validId(orderId) || req.supportUser.role !== "customer") return res.status(400).json({ message: "Choose a valid order." });
  try {
    const orders = await query(req.db, "SELECT id, user_id FROM orders WHERE id=? AND user_id=? LIMIT 1", [orderId, req.supportUser.id]);
    if (!orders.length) return res.status(404).json({ message: "Order not found on your account." });
    await query(req.db, "INSERT IGNORE INTO order_support_threads (order_id, customer_id) VALUES (?,?)", [orderId, req.supportUser.id]);
    const rows = await query(req.db, `${threadSelect} WHERE t.order_id=? AND t.customer_id=? LIMIT 1`, [orderId, req.supportUser.id]);
    res.status(201).json({ thread: rows[0] });
  } catch (_) { res.status(500).json({ message: "Unable to open seller support." }); }
});

async function getThread(req, res) {
  if (!validId(req.params.id)) { res.status(400).json({ message: "Invalid support conversation." }); return null; }
  const params = [Number(req.params.id)];
  let where = "t.id=?";
  if (req.supportUser.role === "customer") { where += " AND t.customer_id=? AND o.user_id=t.customer_id"; params.push(req.supportUser.id); }
  const rows = await query(req.db, `${threadSelect} WHERE ${where} LIMIT 1`, params);
  if (!rows.length) { res.status(404).json({ message: "This support conversation is unavailable." }); return null; }
  return rows[0];
}

router.get("/threads/:id/messages", async (req, res) => {
  try {
    const thread = await getThread(req, res); if (!thread) return;
    const after = req.query.after_id; const before = req.query.before_id;
    if ((after && !validId(after)) || (before && !validId(before)) || (after && before)) return res.status(400).json({ message: "Invalid message cursor." });
    const cursor = after ? "AND id>?" : before ? "AND id<?" : ""; const params = [thread.id];
    if (after || before) params.push(Number(after || before));
    let messages = await query(req.db, `SELECT id, sender_id, body, created_at, read_at FROM order_support_messages WHERE thread_id=? ${cursor} ORDER BY id ${after ? "ASC" : "DESC"} LIMIT 101`, params);
    const hasMore = messages.length > 100; messages = messages.slice(0, 100); if (!after) messages.reverse();
    const read = await query(req.db, "SELECT MAX(id) peer_read_id FROM order_support_messages WHERE thread_id=? AND sender_id=? AND read_at IS NOT NULL", [thread.id, req.supportUser.id]);
    res.json({ thread, messages, has_more: hasMore, peer_read_id: Number(read[0]?.peer_read_id || 0) });
  } catch (_) { res.status(500).json({ message: "Unable to load support messages." }); }
});

router.post("/threads/:id/messages", async (req, res) => {
  const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
  const clientId = req.body.client_id;
  if (!body || body.length > 1000 || typeof clientId !== "string" || !/^[a-f0-9-]{36}$/i.test(clientId)) return res.status(400).json({ message: "Enter a message of 1 to 1,000 characters." });
  try {
    const thread = await getThread(req, res); if (!thread || thread.status !== "open") return;
    const duplicate = await query(req.db, "SELECT id, sender_id, body, created_at, read_at FROM order_support_messages WHERE thread_id=? AND sender_id=? AND client_id=?", [thread.id, req.supportUser.id, clientId]);
    if (duplicate.length) return res.json({ message: duplicate[0] });
    const recent = await query(req.db, "SELECT COUNT(*) count FROM order_support_messages WHERE sender_id=? AND created_at>DATE_SUB(NOW(), INTERVAL 1 MINUTE)", [req.supportUser.id]);
    if (Number(recent[0]?.count) >= 30) return res.status(429).json({ message: "Please wait before sending more messages." });
    const result = await query(req.db, "INSERT INTO order_support_messages (thread_id, sender_id, client_id, body) VALUES (?,?,?,?)", [thread.id, req.supportUser.id, clientId, body]);
    const saved = await query(req.db, "SELECT id, sender_id, body, created_at, read_at FROM order_support_messages WHERE id=?", [result.insertId]);
    res.status(201).json({ message: saved[0] });
  } catch (_) { res.status(500).json({ message: "Unable to send your message." }); }
});

router.post("/threads/:id/read", async (req, res) => {
  if (!validId(req.body.last_id)) return res.status(400).json({ message: "Invalid message." });
  try {
    const thread = await getThread(req, res); if (!thread) return;
    await query(req.db, "UPDATE order_support_messages SET read_at=COALESCE(read_at,NOW()) WHERE thread_id=? AND sender_id<>? AND id<=?", [thread.id, req.supportUser.id, Number(req.body.last_id)]);
    res.json({ success: true });
  } catch (_) { res.status(500).json({ message: "Unable to update message status." }); }
});

module.exports = router;
module.exports.ensureSupportSchema = ensureSupportSchema;

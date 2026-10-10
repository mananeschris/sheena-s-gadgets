const express = require("express");
const router = express.Router();
const { query, requireChatUser, sameOrigin } = require("./chatSession");
const { ensureDeliveryAssignmentsTable } = require("./riders");
const schemaPromises = new WeakMap();
const active = "da.status IN ('assigned','picked_up','out_for_delivery','failed_attempt') AND o.status NOT IN ('delivered','cancelled')";
const current = "t.generation=da.chat_generation AND t.rider_id=da.rider_id";

function ensureChatSchema(db) {
  if (!schemaPromises.has(db)) {
    const promise = (async () => {
      await ensureDeliveryAssignmentsTable(db);
      await query(db, `CREATE TABLE IF NOT EXISTS delivery_chat_threads (
        id INT AUTO_INCREMENT PRIMARY KEY, assignment_id INT NOT NULL, generation INT NOT NULL,
        order_id INT NOT NULL, customer_id INT NOT NULL, rider_id INT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY idx_chat_assignment (assignment_id, generation),
        INDEX idx_chat_customer (customer_id), INDEX idx_chat_rider (rider_id)
      )`);
      await query(db, `CREATE TABLE IF NOT EXISTS delivery_chat_messages (
        id INT AUTO_INCREMENT PRIMARY KEY, thread_id INT NOT NULL, sender_id INT NOT NULL,
        client_id CHAR(36) NOT NULL, body TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, read_at DATETIME NULL,
        UNIQUE KEY idx_chat_retry (thread_id, sender_id, client_id),
        INDEX idx_chat_messages (thread_id, id)
      )`);
    })().catch(error => { schemaPromises.delete(db); throw error; });
    schemaPromises.set(db, promise);
  }
  return schemaPromises.get(db);
}

function access(user) {
  return user.role === "customer" ? "t.customer_id=? AND o.user_id=t.customer_id" : `t.rider_id=? AND ${current}`;
}

const threadSelect = `SELECT t.id, t.order_id, t.assignment_id, t.generation,
  t.customer_id, t.rider_id, t.created_at, da.status AS delivery_status, o.status AS order_status,
  c.name AS customer_name, r.name AS rider_name,
  COALESCE((SELECT oi.product_name FROM order_items oi WHERE oi.order_id=t.order_id ORDER BY oi.id LIMIT 1), p.name, 'Product') AS product_name,
  COALESCE((SELECT oi.product_image FROM order_items oi WHERE oi.order_id=t.order_id ORDER BY oi.id LIMIT 1), p.image) AS product_image,
  (${current} AND ${active}) AS can_send,
  (${current}) AS is_current
  FROM delivery_chat_threads t JOIN delivery_assignments da ON da.id=t.assignment_id
  JOIN orders o ON o.id=t.order_id LEFT JOIN users c ON c.id=t.customer_id
  LEFT JOIN users r ON r.id=t.rider_id LEFT JOIN products p ON p.id=o.product_id`;

const validId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;

async function getThread(req, res) {
  if (!validId(req.params.id)) { res.status(400).json({ message: "Invalid conversation." }); return null; }
  const rows = await query(req.db, `${threadSelect} WHERE t.id=? AND ${access(req.chatUser)} LIMIT 1`, [Number(req.params.id), req.chatUser.id]);
  if (!rows.length) { res.status(404).json({ message: "Conversation is no longer available to this account." }); return null; }
  return { ...rows[0], can_send: Boolean(Number(rows[0].can_send)), is_current: Boolean(Number(rows[0].is_current)) };
}

router.use(sameOrigin, requireChatUser, async (req, res, next) => {
  try { await ensureChatSchema(req.db); next(); }
  catch { res.status(503).json({ message: "Delivery messages are temporarily unavailable." }); }
});

router.get("/threads", async (req, res) => {
  try {
    // Snapshot each assignment generation so rider changes never expose old conversations.
    await query(req.db, `INSERT IGNORE INTO delivery_chat_threads (assignment_id, generation, order_id, customer_id, rider_id)
      SELECT da.id, da.chat_generation, da.order_id, o.user_id, da.rider_id FROM delivery_assignments da
      JOIN orders o ON o.id=da.order_id WHERE ${req.chatUser.role === "customer" ? "o.user_id" : "da.rider_id"}=?`, [req.chatUser.id]);
    const threads = await query(req.db, `${threadSelect}
      WHERE ${access(req.chatUser)} ORDER BY t.id DESC`, [req.chatUser.id]);
    if (!threads.length) return res.json({ threads: [], unread_count: 0 });
    const ids = threads.map(item => item.id);
    const summaries = await query(req.db, `SELECT m.thread_id,
      SUM(m.sender_id<>? AND m.read_at IS NULL) AS unread_count, MAX(m.id) AS last_id
      FROM delivery_chat_messages m WHERE m.thread_id IN (?) GROUP BY m.thread_id`, [req.chatUser.id, ids]);
    const latestIds = summaries.map(item => item.last_id);
    const latest = latestIds.length ? await query(req.db, "SELECT id, body, created_at FROM delivery_chat_messages WHERE id IN (?)", [latestIds]) : [];
    const byThread = new Map(summaries.map(item => [item.thread_id, item]));
    const byMessage = new Map(latest.map(item => [item.id, item]));
    const result = threads.map(item => {
      const summary = byThread.get(item.id);
      const last = byMessage.get(summary?.last_id);
      return { ...item, can_send: Boolean(Number(item.can_send)), is_current: Boolean(Number(item.is_current)), unread_count: Number(summary?.unread_count || 0), last_message: last?.body || "", last_message_at: last?.created_at || item.created_at };
    }).sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at) || b.id - a.id);
    res.json({ threads: result, unread_count: result.reduce((sum, item) => sum + item.unread_count, 0) });
  } catch { res.status(500).json({ message: "Unable to load your conversations." }); }
});

router.get("/threads/:id/messages", async (req, res) => {
  try {
    const thread = await getThread(req, res);
    if (!thread) return;
    const after = req.query.after_id;
    const before = req.query.before_id;
    if ((after && !validId(after)) || (before && !validId(before)) || (after && before)) return res.status(400).json({ message: "Invalid message cursor." });
    const cursor = after ? "AND id>?" : before ? "AND id<?" : "";
    const params = [thread.id];
    if (after || before) params.push(Number(after || before));
    let messages = await query(req.db, `SELECT id, sender_id, body, created_at, read_at FROM delivery_chat_messages
      WHERE thread_id=? ${cursor} ORDER BY id ${after ? "ASC" : "DESC"} LIMIT 101`, params);
    const hasMore = messages.length > 100;
    messages = messages.slice(0, 100);
    if (!after) messages.reverse();
    const read = await query(req.db, "SELECT MAX(id) AS peer_read_id FROM delivery_chat_messages WHERE thread_id=? AND sender_id=? AND read_at IS NOT NULL", [thread.id, req.chatUser.id]);
    res.json({ thread, messages, has_more: hasMore, peer_read_id: Number(read[0]?.peer_read_id || 0) });
  } catch { res.status(500).json({ message: "Unable to load delivery messages." }); }
});

router.post("/threads/:id/messages", async (req, res) => {
  const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
  const clientId = req.body.client_id;
  if (!body || body.length > 1000 || typeof clientId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(clientId)) return res.status(400).json({ message: "Enter a message of 1 to 1,000 characters." });
  try {
    const thread = await getThread(req, res);
    if (!thread) return;
    const duplicate = await query(req.db, "SELECT id, sender_id, body, created_at, read_at FROM delivery_chat_messages WHERE thread_id=? AND sender_id=? AND client_id=?", [thread.id, req.chatUser.id, clientId]);
    if (duplicate.length) return res.json({ message: duplicate[0] });
    if (!thread.can_send) return res.status(409).json({ message: "This delivery conversation is read-only." });
    const recent = await query(req.db, "SELECT COUNT(*) AS count FROM delivery_chat_messages WHERE sender_id=? AND created_at>DATE_SUB(NOW(), INTERVAL 1 MINUTE)", [req.chatUser.id]);
    if (Number(recent[0]?.count) >= 30) return res.status(429).json({ message: "Please wait a moment before sending more messages." });
    // Ownership and delivery state are rechecked atomically during insertion.
    const result = await query(req.db, `INSERT IGNORE INTO delivery_chat_messages (thread_id, sender_id, client_id, body)
      SELECT t.id, ?, ?, ? FROM delivery_chat_threads t JOIN delivery_assignments da ON da.id=t.assignment_id
      JOIN orders o ON o.id=t.order_id WHERE t.id=? AND ${access(req.chatUser)} AND ${current} AND ${active}`, [req.chatUser.id, clientId, body, thread.id, req.chatUser.id]);
    const saved = await query(req.db, "SELECT id, sender_id, body, created_at, read_at FROM delivery_chat_messages WHERE thread_id=? AND sender_id=? AND client_id=?", [thread.id, req.chatUser.id, clientId]);
    if (!saved.length) return res.status(result.affectedRows ? 500 : 409).json({ message: "Message not sent. Delivery access may have changed, or you are sending too quickly. Refresh and retry." });
    res.status(result.affectedRows ? 201 : 200).json({ message: saved[0] });
  } catch { res.status(500).json({ message: "Unable to send message. Please retry." }); }
});

router.post("/threads/:id/read", async (req, res) => {
  if (!validId(req.body.last_id)) return res.status(400).json({ message: "Invalid message." });
  try {
    const thread = await getThread(req, res);
    if (!thread) return;
    await query(req.db, `UPDATE delivery_chat_messages m JOIN delivery_chat_threads t ON t.id=m.thread_id
      JOIN delivery_assignments da ON da.id=t.assignment_id JOIN orders o ON o.id=t.order_id
      SET m.read_at=COALESCE(m.read_at,NOW()) WHERE t.id=? AND ${access(req.chatUser)}
      AND m.sender_id<>? AND m.id<=?`, [thread.id, req.chatUser.id, req.chatUser.id, Number(req.body.last_id)]);
    res.json({ success: true });
  } catch { res.status(500).json({ message: "Unable to update read status." }); }
});

module.exports = router;
module.exports.ensureChatSchema = ensureChatSchema;

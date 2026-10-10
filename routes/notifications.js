const express = require("express");
const router = express.Router();

function ensureNotificationsTable(db, callback) {
  const sql = `
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      type VARCHAR(50) NOT NULL DEFAULT 'info',
      action_url TEXT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notification_user (user_id),
      INDEX idx_notification_read (is_read)
    )
  `;

  db.query(sql, (tableErr) => {
    if (tableErr) return callback(tableErr);
    ensureNotificationColumns(db, callback);
  });
}


function isDuplicateColumnError(error) {
  return error && (error.code === "ER_DUP_FIELDNAME" || /Duplicate column/i.test(error.message || ""));
}

function ensureNotificationColumns(db, callback) {
  const columns = [
    "ADD COLUMN type VARCHAR(50) NOT NULL DEFAULT 'info'",
    "ADD COLUMN action_url TEXT NULL",
    "ADD COLUMN is_read TINYINT(1) NOT NULL DEFAULT 0",
    "ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
  ];
  let index = 0;

  function next(err) {
    if (err && !isDuplicateColumnError(err)) return callback(err);
    if (index >= columns.length) return callback();
    const sql = `ALTER TABLE notifications ${columns[index++]}`;
    db.query(sql, next);
  }

  next();
}
function createNotification(db, payload, callback = () => {}) {
  ensureNotificationsTable(db, (tableErr) => {
    if (tableErr) return callback(tableErr);

    const sql = `
      INSERT INTO notifications (user_id, title, message, type, action_url)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.query(sql, [
      payload.user_id,
      String(payload.title || "Notification").slice(0, 255),
      String(payload.message || ""),
      String(payload.type || "info").slice(0, 50),
      payload.action_url || null
    ], callback);
  });
}

router.use((req, res, next) => {
  ensureNotificationsTable(req.db, (err) => {
    if (err) return res.status(500).json({ message: err.message });
    next();
  });
});

router.get("/customer/:user_id", require('./customerAccess').customerSession, require('./customerAccess').customerIdentity(), (req, res) => {
  const sql = `
    SELECT *
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 30
  `;

  req.db.query(sql, [req.params.user_id], (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    const getOrderId = (row) => {
      try {
        const url = new URL(row.action_url || "", "http://localhost");
        const fromUrl = Number(url.searchParams.get("order_id") || url.searchParams.get("order"));
        if (fromUrl > 0) return fromUrl;
        const pathReference = url.pathname.match(/\/(?:orders?|order-details)\/(\d+)(?:\/|$)/i);
        if (Number(pathReference?.[1]) > 0) return Number(pathReference[1]);
      } catch (_) {}
      const text = `${row.title || ""} ${row.message || ""}`;
      const reference = text.match(/\b(?:order(?:\s*(?:id|#|number))?\s*[:#-]?|order[_ ]?id\s*[:=#-]?|ord[-#]?)\s*#?\s*(\d{1,10})\b/i);
      return Number(reference?.[1] || 0);
    };
    const replaceOrderReferences = (value, productName) => String(value || "").replace(
      /\b(?:order(?:\s*(?:id|#|number))?\s*[:#-]?|order_id\s*[:=#-]?|orderid\s*[:=#-]?|ord[-#]?)\s*#?\s*\d{1,10}\b/gi,
      () => productName || "your order"
    );
    const orderIds = new Set();
    rows.forEach((row) => {
      const id = getOrderId(row);
      if (id > 0) orderIds.add(id);
    });

    if (!orderIds.size) return res.json(rows);
    req.db.query(
      "SELECT order_id, product_name, product_image FROM order_items WHERE order_id IN (?) ORDER BY id ASC",
      [[...orderIds]],
      (itemsErr, items) => {
        if (itemsErr) return res.status(500).json({ message: itemsErr.message });
        const productsByOrder = new Map();
        items.forEach((item) => {
          if (!productsByOrder.has(Number(item.order_id))) productsByOrder.set(Number(item.order_id), []);
          productsByOrder.get(Number(item.order_id)).push(item);
        });
        res.json(rows.map((row) => {
          const products = productsByOrder.get(getOrderId(row)) || [];
          let image = products[0]?.product_image || "";
          try {
            const parsed = JSON.parse(image);
            image = Array.isArray(parsed) ? parsed[0] || "" : typeof parsed === "string" ? parsed : image;
          } catch (_) {}
          const orderProductName = products.length === 1 ? products[0].product_name : products.length > 1 ? `${products[0].product_name} and ${products.length - 1} more` : "";
          return {
            ...row,
            title: replaceOrderReferences(row.title, orderProductName),
            message: replaceOrderReferences(row.message, orderProductName),
            order_product_name: orderProductName,
            order_product_image: image
          };
        }));
      }
    );
  });
});

router.get("/customer/:user_id/unread-count", require('./customerAccess').customerSession, require('./customerAccess').customerIdentity(), (req, res) => {
  req.db.query(
    "SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND is_read=0",
    [req.params.user_id],
    (err, rows) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json({ count: rows[0]?.count || 0 });
    }
  );
});

router.put("/:id/read", require('./customerAccess').customerSession, (req, res) => {
  req.db.query(
    "UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?",
    [req.params.id, req.actorUser.id],
    (err, result) => {
      if (err) return res.status(500).json({ message: err.message });
      if (result.affectedRows === 0) return res.status(404).json({ message: "Notification not found." });
      res.json({ message: "Notification marked as read." });
    }
  );
});

router.put("/customer/:user_id/read-all", require('./customerAccess').customerSession, require('./customerAccess').customerIdentity(), (req, res) => {
  req.db.query(
    "UPDATE notifications SET is_read=1 WHERE user_id=?",
    [req.params.user_id],
    (err) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json({ message: "Notifications marked as read." });
    }
  );
});

router.delete("/customer/:user_id/read", require('./customerAccess').customerSession, require('./customerAccess').customerIdentity(), (req, res) => {
  req.db.query(
    "DELETE FROM notifications WHERE user_id=? AND is_read=1",
    [req.params.user_id],
    (err, result) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json({ message: "Read notifications cleared.", deleted: result.affectedRows || 0 });
    }
  );
});

router.delete("/:id", require('./customerAccess').customerSession, (req, res) => {
  req.db.query(
    "DELETE FROM notifications WHERE id=? AND user_id=?",
    [req.params.id, req.actorUser.id],
    (err, result) => {
      if (err) return res.status(500).json({ message: err.message });
      if (result.affectedRows === 0) return res.status(404).json({ message: "Notification not found." });
      res.json({ message: "Notification deleted." });
    }
  );
});
module.exports = router;
module.exports.createNotification = createNotification;
module.exports.ensureNotificationsTable = ensureNotificationsTable;

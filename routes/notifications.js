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

router.get("/customer/:user_id", (req, res) => {
  const sql = `
    SELECT *
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 30
  `;

  req.db.query(sql, [req.params.user_id], (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(rows);
  });
});

router.get("/customer/:user_id/unread-count", (req, res) => {
  req.db.query(
    "SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND is_read=0",
    [req.params.user_id],
    (err, rows) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json({ count: rows[0]?.count || 0 });
    }
  );
});

router.put("/:id/read", (req, res) => {
  req.db.query(
    "UPDATE notifications SET is_read=1 WHERE id=?",
    [req.params.id],
    (err, result) => {
      if (err) return res.status(500).json({ message: err.message });
      if (result.affectedRows === 0) return res.status(404).json({ message: "Notification not found." });
      res.json({ message: "Notification marked as read." });
    }
  );
});

router.put("/customer/:user_id/read-all", (req, res) => {
  req.db.query(
    "UPDATE notifications SET is_read=1 WHERE user_id=?",
    [req.params.user_id],
    (err) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json({ message: "Notifications marked as read." });
    }
  );
});

router.delete("/customer/:user_id/read", (req, res) => {
  req.db.query(
    "DELETE FROM notifications WHERE user_id=? AND is_read=1",
    [req.params.user_id],
    (err, result) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json({ message: "Read notifications cleared.", deleted: result.affectedRows || 0 });
    }
  );
});

router.delete("/:id", (req, res) => {
  req.db.query(
    "DELETE FROM notifications WHERE id=?",
    [req.params.id],
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

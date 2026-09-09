const express = require("express");
const multer = require("multer");
const path = require("path");
const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, "uploads/"),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`)
  }),
  limits: { files: 5, fileSize: 5 * 1024 * 1024 }
});

function ensureReviewsTable(db, callback) {
  const sql = `
    CREATE TABLE IF NOT EXISTS product_reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      user_id INT NOT NULL,
      rating INT NOT NULL,
      comment TEXT NULL,
      images TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_order_review (order_id),
      INDEX idx_review_product (product_id),
      INDEX idx_review_user (user_id)
    )
  `;

  db.query(sql, (err) => {
    if (err) return callback(err);
    db.query("SHOW COLUMNS FROM product_reviews LIKE 'images'", (checkErr, rows) => {
      if (checkErr) return callback(checkErr);
      if (rows.length) return callback();
      db.query("ALTER TABLE product_reviews ADD COLUMN images TEXT NULL", (alterErr) => {
        if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") return callback(alterErr);
        callback();
      });
    });
  });
}

function cleanText(value, maxLength = 1000) {
  return String(value || "").trim().slice(0, maxLength);
}

router.use((req, res, next) => {
  ensureReviewsTable(req.db, (err) => {
    if (err) return res.status(500).json({ message: err.message });
    next();
  });
});

router.get("/product/:product_id", (req, res) => {
  const sql = `
    SELECT r.*, u.name AS customer_name
    FROM product_reviews r
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.product_id = ?
    ORDER BY r.created_at DESC
    LIMIT 20
  `;

  req.db.query(sql, [req.params.product_id], (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(rows);
  });
});

router.post("/", upload.array("images", 5), (req, res) => {
  const orderId = Number(req.body.order_id);
  const userId = Number(req.body.user_id);
  const rating = Number(req.body.rating);
  const comment = cleanText(req.body.comment, 1000);
  const images = (req.files || []).map(file => `/uploads/${file.filename}`);

  if (!orderId || !userId) return res.status(400).json({ message: "Order and customer are required." });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ message: "Rating must be from 1 to 5." });
  }

  req.db.query(
    "SELECT id, product_id, user_id, status FROM orders WHERE id=?",
    [orderId],
    (orderErr, orderRows) => {
      if (orderErr) return res.status(500).json({ message: orderErr.message });
      if (!orderRows.length) return res.status(404).json({ message: "Order not found." });

      const order = orderRows[0];
      if (Number(order.user_id) !== userId) {
        return res.status(403).json({ message: "You can only review your own order." });
      }

      if (order.status !== "delivered") {
        return res.status(400).json({ message: "Only delivered orders can be reviewed." });
      }

      const sql = `
        INSERT INTO product_reviews (order_id, product_id, user_id, rating, comment, images)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      req.db.query(sql, [orderId, order.product_id, userId, rating, comment || null, JSON.stringify(images)], (insertErr, result) => {
        if (insertErr && insertErr.code === "ER_DUP_ENTRY") {
          return res.status(400).json({ message: "This order already has a review." });
        }
        if (insertErr) return res.status(500).json({ message: insertErr.message });
        res.json({ message: "Review submitted.", id: result.insertId });
      });
    }
  );
});

module.exports = router;
module.exports.ensureReviewsTable = ensureReviewsTable;

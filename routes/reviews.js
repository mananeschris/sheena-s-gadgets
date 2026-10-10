const express = require("express");
const multer = require("multer");
const path = require("path");
const router = express.Router();
const { customerSession, customerIdentity } = require('./customerAccess');

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, require('../services/uploadStorage').publicUploads),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`)
  }),
  limits: { files: 6, fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = file.fieldname === 'images'
      ? ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) && /\.(jpe?g|png|webp)$/i.test(file.originalname)
      : ['video/mp4', 'video/webm'].includes(file.mimetype) && /\.(mp4|webm)$/i.test(file.originalname);
    cb(allowed ? null : new Error("Only image and video files are allowed."), allowed);
  }
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
      videos TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_order_review (order_id),
      INDEX idx_review_product (product_id),
      INDEX idx_review_user (user_id)
    )
  `;

  db.query(sql, (err) => {
    if (err) return callback(err);
    const columns = [
      ["images", "ADD COLUMN images TEXT NULL"],
      ["videos", "ADD COLUMN videos TEXT NULL"]
    ];
    let index = 0;
    function nextColumn() {
      const column = columns[index];
      index += 1;
      if (!column) return callback();
      db.query(`SHOW COLUMNS FROM product_reviews LIKE '${column[0]}'`, (checkErr, rows) => {
        if (checkErr) return callback(checkErr);
        if (rows.length) return nextColumn();
        db.query(`ALTER TABLE product_reviews ${column[1]}`, (alterErr) => {
          if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") return callback(alterErr);
          nextColumn();
        });
      });
    }
    nextColumn();
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

router.post("/", customerSession, upload.fields([{ name: "images", maxCount: 5 }, { name: "video", maxCount: 1 }]), require('../services/uploadStorage').validateUploadedMedia, customerIdentity(), (req, res) => {
  const orderId = Number(req.body.order_id);
  const userId = Number(req.body.user_id);
  const rating = Number(req.body.rating);
  const comment = cleanText(req.body.comment, 1000);
  const images = (req.files?.images || []).map(file => `/uploads/${file.filename}`);
  const videos = (req.files?.video || []).map(file => `/uploads/${file.filename}`);

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
        INSERT INTO product_reviews (order_id, product_id, user_id, rating, comment, images, videos)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      req.db.query(sql, [orderId, order.product_id, userId, rating, comment || null, JSON.stringify(images), JSON.stringify(videos)], (insertErr, result) => {
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

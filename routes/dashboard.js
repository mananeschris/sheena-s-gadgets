const express = require("express");
const router = express.Router();

/**
 * 📊 TOTAL SALES
 */
router.get("/sales", (req, res) => {
  const sql = "SELECT SUM(total_price) AS total_sales FROM orders";

  req.db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ message: err.message });

    res.json({
      total_sales: result[0].total_sales || 0
    });
  });
});

/**
 * 🧾 TOTAL ORDERS
 */
router.get("/orders", (req, res) => {
  const sql = "SELECT COUNT(*) AS total_orders FROM orders";

  req.db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ message: err.message });

    res.json({
      total_orders: result[0].total_orders
    });
  });
});

/**
 * 📦 TOTAL PRODUCTS
 */
router.get("/products", (req, res) => {
  const sql = "SELECT COUNT(*) AS total_products FROM products";

  req.db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ message: err.message });

    res.json({
      total_products: result[0].total_products
    });
  });
});

/**
 * ⚠️ LOW STOCK ALERT
 */
router.get("/low-stock", (req, res) => {
  const sql = "SELECT * FROM products WHERE stock <= 5";

  req.db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ message: err.message });

    res.json({
      low_stock_products: result
    });
  });
});

module.exports = router;
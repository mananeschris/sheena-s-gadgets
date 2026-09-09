const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const { logAudit, auditActor } = require("./auditLogs");
const { requireAdmin, requireAdminOrStaff, verifiedActor } = require("./roleGuard");
const { logInventoryMovement } = require("./inventoryMovements");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { files: 20 }
});

function ensureProductColumns(db, callback) {
  const columns = [
    ["category", "ADD COLUMN category VARCHAR(80) NULL"]
  ];

  let index = 0;
  function next() {
    const item = columns[index];
    index += 1;
    if (!item) return callback();

    db.query(`SHOW COLUMNS FROM products LIKE '${item[0]}'`, (checkErr, rows) => {
      if (checkErr) return callback(checkErr);
      if (rows.length) return next();

      db.query(`ALTER TABLE products ${item[1]}`, (alterErr) => {
        if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") return callback(alterErr);
        next();
      });
    });
  }

  next();
}

function ensureReviewsTable(db, callback) {
  const sql = `
    CREATE TABLE IF NOT EXISTS product_reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      user_id INT NOT NULL,
      rating INT NOT NULL,
      comment TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_order_review (order_id),
      INDEX idx_review_product (product_id),
      INDEX idx_review_user (user_id)
    )
  `;

  db.query(sql, callback);
}

function ensureProductInfrastructure(db, callback) {
  ensureProductColumns(db, (columnErr) => {
    if (columnErr) return callback(columnErr);
    ensureReviewsTable(db, callback);
  });
}

function parseJsonArray(value) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function uploadedImagePaths(req) {
  return (req.files || []).map(file => `/uploads/${file.filename}`);
}

function cleanCategory(value) {
  const category = String(value || "Accessories").trim().slice(0, 80);
  return category || "Accessories";
}

function isInventoryUpdate(req) {
  return String(req.body.inventory_update || "").toLowerCase() === "1";
}

function requireProductUpdatePermission(req, res, next) {
  if (req.actorUser?.role === "admin") return next();
  if (req.actorUser?.role === "staff" && isInventoryUpdate(req)) return next();
  return res.status(403).json({ message: "Only admin can edit products. Staff can update inventory stock only." });
}

function productAuditActor(req) {
  return verifiedActor(req, auditActor(req));
}

function stockNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function variantName(variant, index) {
  return String(variant?.name || `Variant ${index + 1}`).trim() || `Variant ${index + 1}`;
}

function zeroVariantStocks(variants) {
  return variants.map(variant => ({
    ...variant,
    stock: 0
  }));
}

function movementTypeForChange(change, forcedType) {
  if (forcedType) return forcedType;
  return change > 0 ? "manual_restock" : "manual_reduction";
}

function stockMovementRows(beforeProduct, afterProduct, actor, source, note, forcedType = null) {
  const beforeVariants = parseJsonArray(beforeProduct?.variants);
  const afterVariants = parseJsonArray(afterProduct?.variants);
  const productId = Number(afterProduct?.id || beforeProduct?.id);
  const productName = afterProduct?.name || beforeProduct?.name || "Product";
  const rows = [];
  const usesVariants = beforeVariants.length || afterVariants.length;

  if (usesVariants) {
    const length = Math.max(beforeVariants.length, afterVariants.length);
    for (let index = 0; index < length; index += 1) {
      const beforeVariant = beforeVariants[index] || {};
      const afterVariant = afterVariants[index] || {};
      const beforeStock = stockNumber(beforeVariant.stock);
      const afterStock = stockNumber(afterVariant.stock);
      const change = afterStock - beforeStock;
      if (!change) continue;

      const name = variantName(afterVariant.name ? afterVariant : beforeVariant, index);
      rows.push({
        ...actor,
        product_id: productId,
        product_name: productName,
        variant_index: index,
        variant_name: name,
        movement_type: movementTypeForChange(change, forcedType),
        quantity_change: change,
        quantity_before: beforeStock,
        quantity_after: afterStock,
        source,
        note: `${note} ${name}`.trim()
      });
    }
  }

  if (!rows.length) {
    const beforeStock = stockNumber(beforeProduct?.stock);
    const afterStock = stockNumber(afterProduct?.stock);
    const change = afterStock - beforeStock;
    if (change) {
      rows.push({
        ...actor,
        product_id: productId,
        product_name: productName,
        movement_type: movementTypeForChange(change, forcedType),
        quantity_change: change,
        quantity_before: beforeStock,
        quantity_after: afterStock,
        source,
        note
      });
    }
  }

  return rows;
}

function recordStockMovements(db, movements, callback) {
  let index = 0;
  function next(err) {
    if (err) return callback(err);
    const movement = movements[index];
    index += 1;
    if (!movement) return callback();
    logInventoryMovement(db, movement, next);
  }
  next();
}

function validateProduct(req, res, next) {
  const name = req.body.name;
  const price = Number(req.body.price);
  const stock = Number(req.body.stock);

  if (!name || req.body.price === undefined || req.body.stock === undefined) {
    return res.status(400).json({
      message: "Name, price, stock required"
    });
  }

  if (Number.isNaN(price) || price < 0 || Number.isNaN(stock) || stock < 0) {
    return res.status(400).json({
      message: "Price and stock must be valid non-negative numbers"
    });
  }

  next();
}

router.post("/", upload.array("images", 20), requireAdmin, validateProduct, (req, res) => {
  const name = req.body.name;
  const description = req.body.description || "";
  const category = cleanCategory(req.body.category);
  const price = req.body.price;
  const stock = req.body.stock;
  const variants = parseJsonArray(req.body.variants);
  const images = uploadedImagePaths(req);
  const image = images[0] || null;

  ensureProductColumns(req.db, (columnErr) => {
    if (columnErr) return res.status(500).json({ message: columnErr.message });

    const sql = `
      INSERT INTO products
      (name, description, category, price, stock, image, images, variants)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    req.db.query(
      sql,
      [
        name,
        description,
        category,
        price,
        stock,
        image,
        JSON.stringify(images),
        JSON.stringify(variants)
      ],
      (err, result) => {
        if (err) return res.status(500).json(err);

        const actor = productAuditActor(req);
        const product = {
          id: result.insertId,
          name,
          stock,
          variants: JSON.stringify(variants)
        };
        const movements = stockMovementRows(
          { id: result.insertId, name, stock: 0, variants: JSON.stringify(zeroVariantStocks(variants)) },
          product,
          actor,
          "product_create",
          "Initial product stock recorded.",
          "initial_stock"
        );

        recordStockMovements(req.db, movements, (movementErr) => {
          if (movementErr) return res.status(500).json({ message: movementErr.message });
          logAudit(req.db, {
            ...actor,
            action: "create_product",
            entity_type: "product",
            entity_id: result.insertId,
            details: `${name} | ${category} | stock ${stock} | price ${price}`
          });
          res.json({
            message: "Product added successfully",
            id: result.insertId
          });
        });
      }
    );
  });
});

router.get("/", (req, res) => {
  ensureProductInfrastructure(req.db, (tableErr) => {
    if (tableErr) return res.status(500).json(tableErr);

    const sql = `
      SELECT
        p.*,
        COALESCE(ROUND(AVG(r.rating), 1), 0) AS average_rating,
        COUNT(r.id) AS review_count
      FROM products p
      LEFT JOIN product_reviews r ON p.id = r.product_id
      GROUP BY p.id
      ORDER BY p.id ASC
    `;

    req.db.query(sql, (err, result) => {
      if (err) return res.status(500).json(err);
      res.json(result);
    });
  });
});

router.put("/:id", upload.array("images", 20), requireAdminOrStaff, requireProductUpdatePermission, validateProduct, (req, res) => {
  const { id } = req.params;
  const name = req.body.name;
  const description = req.body.description || "";
  const category = cleanCategory(req.body.category);
  const price = req.body.price;
  const stock = req.body.stock;
  const variants = parseJsonArray(req.body.variants);
  const existingImages = parseJsonArray(req.body.existingImages);
  const newImages = uploadedImagePaths(req);
  const images = [...existingImages, ...newImages].slice(0, 20);
  const image = images[0] || req.body.image || null;

  ensureProductColumns(req.db, (columnErr) => {
    if (columnErr) return res.status(500).json({ message: columnErr.message });

    req.db.query("SELECT * FROM products WHERE id=?", [id], (loadErr, rows) => {
      if (loadErr) return res.status(500).json({ message: loadErr.message });
      if (!rows.length) return res.status(404).json({ message: "Product not found" });

      const beforeProduct = rows[0];
      const actor = productAuditActor(req);
      const afterProduct = {
        id,
        name,
        stock,
        variants: JSON.stringify(variants)
      };
      const movements = stockMovementRows(
        beforeProduct,
        afterProduct,
        actor,
        req.actorUser?.role === "staff" ? "staff_inventory_update" : "product_update",
        req.actorUser?.role === "staff" ? "Staff inventory stock update." : "Product stock updated."
      );

      if (req.actorUser?.role === "staff") {
        req.db.query(
          "UPDATE products SET stock=?, variants=? WHERE id=?",
          [stock, JSON.stringify(variants), id],
          (err) => {
            if (err) return res.status(500).json(err);
            recordStockMovements(req.db, movements, (movementErr) => {
              if (movementErr) return res.status(500).json({ message: movementErr.message });
              logAudit(req.db, {
                ...actor,
                action: "update_inventory_stock",
                entity_type: "product",
                entity_id: id,
                details: `${name} | stock ${stock}`
              });
              res.json({ message: "Inventory stock updated" });
            });
          }
        );
        return;
      }

      req.db.query(
        `UPDATE products SET name=?, description=?, category=?, price=?, stock=?, image=?, images=?, variants=? WHERE id=?`,
        [name, description, category, price, stock, image, JSON.stringify(images), JSON.stringify(variants), id],
        (err) => {
          if (err) return res.status(500).json(err);
          recordStockMovements(req.db, movements, (movementErr) => {
            if (movementErr) return res.status(500).json({ message: movementErr.message });
            logAudit(req.db, {
              ...actor,
              action: "update_product",
              entity_type: "product",
              entity_id: id,
              details: `${name} | ${category} | stock ${stock} | price ${price}`
            });
            res.json({ message: "Product updated" });
          });
        }
      );
    });
  });
});
router.delete("/:id", requireAdmin, (req, res) => {
  const { id } = req.params;

  req.db.query("SELECT * FROM products WHERE id=?", [id], (loadErr, rows) => {
    if (loadErr) return res.status(500).json({ message: loadErr.message });
    if (!rows.length) return res.status(404).json({ message: "Product not found" });

    const product = rows[0];
    const actor = productAuditActor(req);
    const movements = stockMovementRows(
      product,
      {
        id,
        name: product.name,
        stock: 0,
        variants: JSON.stringify(zeroVariantStocks(parseJsonArray(product.variants)))
      },
      actor,
      "product_delete",
      "Product deleted; stock removed from active catalog.",
      "product_delete"
    );

    req.db.query(
      "DELETE FROM products WHERE id=?",
      [id],
      (err) => {
        if (err) return res.status(500).json(err);
        recordStockMovements(req.db, movements, (movementErr) => {
          if (movementErr) return res.status(500).json({ message: movementErr.message });
          logAudit(req.db, {
            ...actor,
            action: "delete_product",
            entity_type: "product",
            entity_id: id,
            details: `${product.name || `Product #${id}`} deleted`
          });
          res.json({ message: "Product deleted" });
        });
      }
    );
  });
});
module.exports = router;
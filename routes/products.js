const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const { logAudit, auditActor } = require("./auditLogs");
const { requireAdmin, requireAdminOrStaff, verifiedActor } = require("./roleGuard");
const { logInventoryMovement } = require("./inventoryMovements");
const { productWarranty } = require("./productWarranty");
const { router: categoryRouter, requireActiveCategory } = require('./productCategories');
router.use('/categories', categoryRouter);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, require('../services/uploadStorage').publicUploads),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { files: 20, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (req.actorUser?.role !== 'admin') return callback(null, false);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) || !/\.(jpe?g|png|webp)$/i.test(file.originalname)) return callback(new Error('Product images must be JPG, PNG, or WEBP.'));
    callback(null, true);
  }
});

function ensureProductColumns(db, callback) {
  const columns = [
    ["category", "ADD COLUMN category VARCHAR(80) NULL"],
    ["allow_layaway", "ADD COLUMN allow_layaway TINYINT(1) NOT NULL DEFAULT 0"],
    ["layaway_downpayment_type", "ADD COLUMN layaway_downpayment_type VARCHAR(20) NOT NULL DEFAULT 'percentage'"],
    ["layaway_downpayment_value", "ADD COLUMN layaway_downpayment_value DECIMAL(12,2) NOT NULL DEFAULT 20"],
    ["layaway_duration_months", "ADD COLUMN layaway_duration_months INT NOT NULL DEFAULT 5"],
    ["layaway_max_quantity", "ADD COLUMN layaway_max_quantity INT NOT NULL DEFAULT 1"],
    ["allow_installment", "ADD COLUMN allow_installment TINYINT(1) NOT NULL DEFAULT 0"],
    ["warranty_eligible", "ADD COLUMN warranty_eligible TINYINT(1) NOT NULL DEFAULT 0"],
    ["warranty_duration_months", "ADD COLUMN warranty_duration_months INT NOT NULL DEFAULT 0"],
    ["warranty_coverage", "ADD COLUMN warranty_coverage TEXT NULL"],
    ["warranty_exclusions", "ADD COLUMN warranty_exclusions TEXT NULL"]
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
      images TEXT NULL,
      videos TEXT NULL,
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

function boolFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase()) ? 1 : 0;
}

function cleanLayawayType(value) {
  return String(value || "percentage").toLowerCase() === "fixed" ? "fixed" : "percentage";
}

function cleanMoneyValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function cleanPositiveInt(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function productSellingOptions(body) {
  const downpaymentType = cleanLayawayType(body.layaway_downpayment_type);
  const downpaymentValue = cleanMoneyValue(body.layaway_downpayment_value, downpaymentType === "percentage" ? 20 : 0);
  return {
    allow_layaway: boolFlag(body.allow_layaway),
    layaway_downpayment_type: downpaymentType,
    layaway_downpayment_value: downpaymentType === "percentage" ? Math.min(downpaymentValue, 100) : downpaymentValue,
    layaway_duration_months: cleanPositiveInt(Number(body.layaway_duration_months), 5),
    layaway_max_quantity: cleanPositiveInt(Number(body.layaway_max_quantity), 1),
    allow_installment: boolFlag(body.allow_installment)
  };
}

function isInventoryUpdate(req) {
  return String(req.body.inventory_update || "").toLowerCase() === "1";
}

function requireProductUpdatePermission(req, res, next) {
  if (req.actorUser?.role === "admin") return next();
  if (req.actorUser?.role === "staff" && isInventoryUpdate(req)) {
    const reason = String(req.body.stock_reason || '').trim();
    if (!reason || reason.length > 500) return res.status(400).json({ message: 'Enter a stock adjustment reason (maximum 500 characters).' });
    if (!Number.isInteger(Number(req.body.stock)) || Number(req.body.stock) < 0) return res.status(400).json({ message: 'Stock must be a non-negative whole number.' });
    return next();
  }
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

router.post("/", requireAdmin, upload.array("images", 20), require('../services/uploadStorage').validateUploadedMedia, validateProduct, requireActiveCategory, (req, res) => {
  const name = req.body.name;
  const description = req.body.description || "";
  const category = cleanCategory(req.body.category);
  const price = req.body.price;
  const stock = req.body.stock;
  const variants = parseJsonArray(req.body.variants);
  const images = uploadedImagePaths(req);
  const image = images[0] || null;
  const sellingOptions = productSellingOptions(req.body);
  let warranty;
  try { warranty = productWarranty(req.body); }
  catch (error) { return res.status(400).json({ message: error.message }); }

  ensureProductColumns(req.db, (columnErr) => {
    if (columnErr) return res.status(500).json({ message: columnErr.message });

    const sql = `
      INSERT INTO products
      (name, description, category, price, stock, image, images, variants, allow_layaway, layaway_downpayment_type, layaway_downpayment_value, layaway_duration_months, layaway_max_quantity, allow_installment, warranty_eligible, warranty_duration_months, warranty_coverage, warranty_exclusions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify(variants),
        sellingOptions.allow_layaway,
        sellingOptions.layaway_downpayment_type,
        sellingOptions.layaway_downpayment_value,
        sellingOptions.layaway_duration_months,
        sellingOptions.layaway_max_quantity,
        sellingOptions.allow_installment,
        warranty.warranty_eligible,
        warranty.warranty_duration_months,
        warranty.warranty_coverage,
        warranty.warranty_exclusions
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
            details: `${name} | ${category} | stock ${stock} | price ${price} | warranty ${warranty.warranty_eligible ? `${warranty.warranty_duration_months} months` : "not eligible"}`
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

router.put("/:id", requireAdminOrStaff, upload.array("images", 20), require('../services/uploadStorage').validateUploadedMedia, requireProductUpdatePermission, validateProduct, requireActiveCategory, (req, res) => {
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
  const sellingOptions = productSellingOptions(req.body);

  ensureProductColumns(req.db, (columnErr) => {
    if (columnErr) return res.status(500).json({ message: columnErr.message });

    req.db.query("SELECT * FROM products WHERE id=?", [id], (loadErr, rows) => {
      if (loadErr) return res.status(500).json({ message: loadErr.message });
      if (!rows.length) return res.status(404).json({ message: "Product not found" });

      const beforeProduct = rows[0];
      if (req.actorUser.role === 'staff') {
        const savedVariants = parseJsonArray(beforeProduct.variants);
        if (savedVariants.length !== variants.length) return res.status(403).json({ message: 'Only admin can add or remove product variants.' });
        for (let index = 0; index < variants.length; index++) {
          if (!variants[index] || typeof variants[index] !== 'object' || Array.isArray(variants[index]) || variants[index].stock === undefined) return res.status(400).json({ message: 'Enter a quantity for each variant.' });
          const quantity = Number(variants[index].stock);
          if (!Number.isInteger(quantity) || quantity < 0) return res.status(400).json({ message: 'Variant stock must be a non-negative whole number.' });
          variants[index] = { ...savedVariants[index], stock: quantity };
        }
        if (variants.length && variants.reduce((sum, item) => sum + item.stock, 0) !== Number(stock)) return res.status(400).json({ message: 'Total stock must match the variant quantities.' });
      }
      let warranty;
      if (req.actorUser?.role === "admin") {
        try { warranty = productWarranty(req.body, beforeProduct); }
        catch (error) { return res.status(400).json({ message: error.message }); }
      }
      const actor = productAuditActor(req);
      const afterProduct = {
        id,
        name: req.actorUser.role === 'staff' ? beforeProduct.name : name,
        stock,
        variants: JSON.stringify(variants)
      };
      const movements = stockMovementRows(
        beforeProduct,
        afterProduct,
        actor,
        req.actorUser?.role === "staff" ? "staff_inventory_update" : "product_update",
        req.actorUser?.role === "staff" ? String(req.body.stock_reason).trim() : "Product stock updated."
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
                details: `${beforeProduct.name} | stock ${stock}`
              });
              res.json({ message: "Inventory stock updated" });
            });
          }
        );
        return;
      }

      req.db.query(
        `UPDATE products
         SET name=?, description=?, category=?, price=?, stock=?, image=?, images=?, variants=?,
             allow_layaway=?, layaway_downpayment_type=?, layaway_downpayment_value=?,
             layaway_duration_months=?, layaway_max_quantity=?, allow_installment=?,
             warranty_eligible=?, warranty_duration_months=?, warranty_coverage=?, warranty_exclusions=?
         WHERE id=?`,
        [
          name,
          description,
          category,
          price,
          stock,
          image,
          JSON.stringify(images),
          JSON.stringify(variants),
          sellingOptions.allow_layaway,
          sellingOptions.layaway_downpayment_type,
          sellingOptions.layaway_downpayment_value,
          sellingOptions.layaway_duration_months,
          sellingOptions.layaway_max_quantity,
          sellingOptions.allow_installment,
          warranty.warranty_eligible,
          warranty.warranty_duration_months,
          warranty.warranty_coverage,
          warranty.warranty_exclusions,
          id
        ],
        (err) => {
          if (err) return res.status(500).json(err);
          recordStockMovements(req.db, movements, (movementErr) => {
            if (movementErr) return res.status(500).json({ message: movementErr.message });
            logAudit(req.db, {
              ...actor,
              action: "update_product",
              entity_type: "product",
              entity_id: id,
              details: `${name} | ${category} | stock ${stock} | price ${price} | warranty ${warranty.warranty_eligible ? `${warranty.warranty_duration_months} months` : "not eligible"}`
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

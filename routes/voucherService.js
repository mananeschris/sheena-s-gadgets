function dbQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function normalizeVoucherCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function moneyValue(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.max(amount, 0) : 0;
}

function parseJsonArray(value) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function normalizeDiscountType(value) {
  const type = String(value || "").toLowerCase();
  return ["percentage", "percent"].includes(type) ? "percent" : "fixed";
}

function normalizeApplicability(value) {
  const type = String(value || "all").toLowerCase();
  return ["selected_products", "products", "product"].includes(type)
    ? "selected_products"
    : ["selected_categories", "categories", "category"].includes(type)
      ? "selected_categories"
      : "all";
}

function normalizeCheckoutType(value) {
  const type = String(value || "regular").toLowerCase();
  if (type === "layaway") return "layaway";
  if (type === "installment") return "installment";
  return "regular";
}

async function ensureVoucherTables(db) {
  await dbQuery(db, `
    CREATE TABLE IF NOT EXISTS vouchers (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(80) NOT NULL,
      discount_type VARCHAR(30) NOT NULL DEFAULT 'fixed',
      discount_value DECIMAL(12,2) NOT NULL DEFAULT 0,
      min_quantity INT NOT NULL DEFAULT 0,
      min_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      product_id INT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const voucherColumns = [
    ["deleted_at", "ADD COLUMN deleted_at DATETIME NULL"],
    ["normalized_code", "ADD COLUMN normalized_code VARCHAR(80) NULL"],
    ["max_discount_amount", "ADD COLUMN max_discount_amount DECIMAL(12,2) NULL"],
    ["starts_at", "ADD COLUMN starts_at DATETIME NULL"],
    ["expires_at", "ADD COLUMN expires_at DATETIME NULL"],
    ["usage_limit", "ADD COLUMN usage_limit INT NULL"],
    ["usage_limit_per_customer", "ADD COLUMN usage_limit_per_customer INT NULL"],
    ["applicability_type", "ADD COLUMN applicability_type VARCHAR(40) NOT NULL DEFAULT 'all'"],
    ["applicable_product_ids", "ADD COLUMN applicable_product_ids TEXT NULL"],
    ["applicable_categories", "ADD COLUMN applicable_categories TEXT NULL"],
    ["allowed_checkout_types", "ADD COLUMN allowed_checkout_types TEXT NULL"],
    ["redemption_count", "ADD COLUMN redemption_count INT NOT NULL DEFAULT 0"],
    ["updated_at", "ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
  ];

  for (const [name, alter] of voucherColumns) {
    const rows = await dbQuery(db, `SHOW COLUMNS FROM vouchers LIKE '${name}'`);
    if (rows.length) continue;
    try {
      await dbQuery(db, `ALTER TABLE vouchers ${alter}`);
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }

  await dbQuery(db, `
    UPDATE vouchers
    SET normalized_code = UPPER(REPLACE(TRIM(code), ' ', ''))
    WHERE normalized_code IS NULL OR normalized_code = ''
  `);

  await dbQuery(db, `
    CREATE TABLE IF NOT EXISTS voucher_redemptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      voucher_id INT NOT NULL,
      voucher_code VARCHAR(80) NOT NULL,
      normalized_code VARCHAR(80) NOT NULL,
      order_id INT NULL,
      source_type VARCHAR(30) NOT NULL DEFAULT 'order',
      source_id INT NULL,
      customer_id INT NOT NULL,
      checkout_type VARCHAR(30) NOT NULL DEFAULT 'regular',
      discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      eligible_subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
      redeemed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_voucher_order (order_id),
      UNIQUE KEY unique_voucher_source (source_type, source_id),
      INDEX idx_voucher_customer (voucher_id, customer_id)
    )
  `);

  const redemptionColumns = [
    ["source_type", "ADD COLUMN source_type VARCHAR(30) NOT NULL DEFAULT 'order'"],
    ["source_id", "ADD COLUMN source_id INT NULL"]
  ];
  for (const [name, alter] of redemptionColumns) {
    const rows = await dbQuery(db, `SHOW COLUMNS FROM voucher_redemptions LIKE '${name}'`);
    if (rows.length) continue;
    try {
      await dbQuery(db, `ALTER TABLE voucher_redemptions ${alter}`);
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
  try {
    await dbQuery(db, "CREATE UNIQUE INDEX unique_voucher_source ON voucher_redemptions (source_type, source_id)");
  } catch (error) {
    if (!["ER_DUP_KEYNAME", "ER_DUP_ENTRY"].includes(error.code)) throw error;
  }
}

async function ensureOrderVoucherColumns(db) {
  const columns = [
    ["voucher_id", "ADD COLUMN voucher_id INT NULL"],
    ["voucher_code", "ADD COLUMN voucher_code VARCHAR(80) NULL"],
    ["voucher_discount", "ADD COLUMN voucher_discount DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["product_subtotal", "ADD COLUMN product_subtotal DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["final_product_total", "ADD COLUMN final_product_total DECIMAL(12,2) NOT NULL DEFAULT 0"]
  ];

  for (const [name, alter] of columns) {
    const rows = await dbQuery(db, `SHOW COLUMNS FROM orders LIKE '${name}'`);
    if (rows.length) continue;
    try {
      await dbQuery(db, `ALTER TABLE orders ${alter}`);
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
}

function voucherAllowedCheckoutTypes(voucher) {
  const allowed = parseJsonArray(voucher.allowed_checkout_types).map(normalizeCheckoutType);
  return allowed.length ? allowed : ["regular"];
}

function productApplies(voucher, line) {
  const type = normalizeApplicability(voucher.applicability_type);
  if (type === "all") return true;
  if (type === "selected_products") {
    const ids = parseJsonArray(voucher.applicable_product_ids).map(Number);
    if (Number(voucher.product_id || 0)) ids.push(Number(voucher.product_id));
    return ids.includes(Number(line.product_id));
  }
  const categories = parseJsonArray(voucher.applicable_categories).map(item => String(item).toLowerCase());
  return categories.includes(String(line.category || "").toLowerCase());
}

function calculateDiscount(voucher, eligibleSubtotal) {
  if (eligibleSubtotal <= 0) return 0;
  let discount = normalizeDiscountType(voucher.discount_type) === "percent"
    ? eligibleSubtotal * moneyValue(voucher.discount_value) / 100
    : moneyValue(voucher.discount_value);

  if (normalizeDiscountType(voucher.discount_type) === "percent" && moneyValue(voucher.max_discount_amount) > 0) {
    discount = Math.min(discount, moneyValue(voucher.max_discount_amount));
  }

  return Math.min(Math.max(discount, 0), eligibleSubtotal);
}

async function buildCurrentLines(db, items) {
  const lines = [];
  for (const item of items) {
    const productId = Number(item.product_id);
    const quantity = Math.max(Number(item.quantity || 1), 1);
    if (!productId || !Number.isInteger(quantity)) throw new Error("Invalid voucher item.");

    const rows = await dbQuery(db, "SELECT id, name, category, price, stock, variants FROM products WHERE id=? LIMIT 1", [productId]);
    if (!rows.length) throw new Error("Product not found while validating voucher.");

    const product = rows[0];
    const variants = parseJsonArray(product.variants);
    const variantIndex = item.variant_index === undefined || item.variant_index === null || item.variant_index === "" ? null : Number(item.variant_index);
    const variant = Number.isInteger(variantIndex) ? variants[variantIndex] : null;
    const unitPrice = moneyValue(variant ? variant.price : product.price);

    lines.push({
      product_id: product.id,
      category: product.category || "Accessories",
      quantity,
      unit_price: unitPrice,
      subtotal: unitPrice * quantity
    });
  }
  return lines;
}

async function validateVoucher(db, options) {
  await ensureVoucherTables(db);
  const code = normalizeVoucherCode(options.code);
  const checkoutType = normalizeCheckoutType(options.checkout_type);
  const customerId = Number(options.customer_id || options.user_id || 0);
  if (!code) return null;
  if (!customerId) throw new Error("Customer account is required to use vouchers.");

  const voucherRows = await dbQuery(db, "SELECT * FROM vouchers WHERE normalized_code=? AND deleted_at IS NULL LIMIT 1", [code]);
  if (!voucherRows.length) throw new Error("Voucher code does not exist.");
  const voucher = voucherRows[0];
  if (!Number(voucher.is_active)) throw new Error("Voucher is inactive.");

  const now = new Date();
  if (voucher.starts_at && new Date(voucher.starts_at) > now) throw new Error("Voucher is not active yet.");
  if (voucher.expires_at && new Date(voucher.expires_at) < now) throw new Error("Voucher is already expired.");

  const allowedTypes = voucherAllowedCheckoutTypes(voucher);
  if (!allowedTypes.includes(checkoutType)) throw new Error(`Voucher is not allowed for ${checkoutType} checkout.`);

  const totalUsageLimit = Number(voucher.usage_limit || 0);
  if (totalUsageLimit > 0 && Number(voucher.redemption_count || 0) >= totalUsageLimit) {
    throw new Error("Voucher total usage limit has been reached.");
  }

  const perCustomerLimit = Number(voucher.usage_limit_per_customer || 0);
  if (perCustomerLimit > 0) {
    const rows = await dbQuery(db, "SELECT COUNT(*) AS used FROM voucher_redemptions WHERE voucher_id=? AND customer_id=?", [voucher.id, customerId]);
    if (Number(rows[0]?.used || 0) >= perCustomerLimit) {
      throw new Error("You already reached the usage limit for this voucher.");
    }
  }

  const currentLines = await buildCurrentLines(db, options.items || []);
  const orderSubtotal = currentLines.reduce((sum, line) => sum + line.subtotal, 0);
  const eligibleLines = currentLines.filter(line => productApplies(voucher, line));
  const eligibleSubtotal = eligibleLines.reduce((sum, line) => sum + line.subtotal, 0);

  if (eligibleSubtotal <= 0) throw new Error("Voucher does not apply to the selected product(s).");
  if (moneyValue(voucher.min_amount) > eligibleSubtotal) {
    throw new Error(`Voucher requires minimum eligible spend of PHP ${moneyValue(voucher.min_amount).toFixed(2)}.`);
  }
  if (Number(voucher.min_quantity || 0) > 0) {
    const eligibleQty = eligibleLines.reduce((sum, line) => sum + line.quantity, 0);
    if (eligibleQty < Number(voucher.min_quantity || 0)) {
      throw new Error(`Voucher requires at least ${voucher.min_quantity} eligible item(s).`);
    }
  }

  const discount = calculateDiscount(voucher, eligibleSubtotal);
  return {
    voucher_id: voucher.id,
    voucher_code: voucher.code,
    normalized_code: code,
    discount_type: normalizeDiscountType(voucher.discount_type),
    discount_value: moneyValue(voucher.discount_value),
    eligible_subtotal: eligibleSubtotal,
    order_subtotal: orderSubtotal,
    discount,
    product_total: Math.max(orderSubtotal - discount, 0),
    checkout_type: checkoutType
  };
}

async function recordVoucherRedemption(db, order, checkoutType = "regular", options = {}) {
  if (!options.skipEnsure) await ensureVoucherTables(db);
  if (!order?.voucher_id || !order?.voucher_code || Number(order.voucher_discount || 0) <= 0) {
    return { redeemed: false, reason: "no_voucher" };
  }

  const normalized = normalizeVoucherCode(order.voucher_code);
  const existing = await dbQuery(db, "SELECT id FROM voucher_redemptions WHERE order_id=? LIMIT 1", [order.id]);
  if (existing.length) return { redeemed: false, reason: "already_redeemed" };

  const result = await dbQuery(db, `
    INSERT IGNORE INTO voucher_redemptions
    (voucher_id, voucher_code, normalized_code, order_id, source_type, source_id, customer_id, checkout_type, discount_amount, eligible_subtotal)
    VALUES (?, ?, ?, ?, 'order', ?, ?, ?, ?, ?)
  `, [
    order.voucher_id,
    order.voucher_code,
    normalized,
    order.id,
    order.id,
    order.user_id,
    normalizeCheckoutType(checkoutType || order.payment_method),
    moneyValue(order.voucher_discount),
    moneyValue(order.product_subtotal)
  ]);

  if (!result.affectedRows) return { redeemed: false, reason: "already_redeemed" };
  await dbQuery(db, "UPDATE vouchers SET redemption_count = redemption_count + 1 WHERE id=?", [order.voucher_id]);
  return { redeemed: true };
}

async function recordVoucherRedemptionForSource(db, source, options = {}) {
  if (!options.skipEnsure) await ensureVoucherTables(db);
  if (!source?.voucher_id || !source?.voucher_code || Number(source.voucher_discount || 0) <= 0) {
    return { redeemed: false, reason: "no_voucher" };
  }

  const normalized = normalizeVoucherCode(source.voucher_code);
  const existing = await dbQuery(db, "SELECT id FROM voucher_redemptions WHERE source_type=? AND source_id=? LIMIT 1", [
    source.source_type || "layaway",
    source.source_id
  ]);
  if (existing.length) return { redeemed: false, reason: "already_redeemed" };

  const result = await dbQuery(db, `
    INSERT IGNORE INTO voucher_redemptions
    (voucher_id, voucher_code, normalized_code, order_id, source_type, source_id, customer_id, checkout_type, discount_amount, eligible_subtotal)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
  `, [
    source.voucher_id,
    source.voucher_code,
    normalized,
    source.source_type || "layaway",
    source.source_id,
    source.customer_id,
    normalizeCheckoutType(source.checkout_type),
    moneyValue(source.voucher_discount),
    moneyValue(source.eligible_subtotal || source.original_product_total || source.total_amount)
  ]);

  if (!result.affectedRows) return { redeemed: false, reason: "already_redeemed" };
  await dbQuery(db, "UPDATE vouchers SET redemption_count = redemption_count + 1 WHERE id=?", [source.voucher_id]);
  return { redeemed: true };
}

module.exports = {
  dbQuery,
  ensureVoucherTables,
  ensureOrderVoucherColumns,
  normalizeVoucherCode,
  normalizeCheckoutType,
  validateVoucher,
  recordVoucherRedemption,
  recordVoucherRedemptionForSource
};

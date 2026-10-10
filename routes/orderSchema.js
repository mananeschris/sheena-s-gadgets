function query(db, sql) {
  return new Promise((resolve, reject) => {
    db.query(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function ensureOrderCoreColumns(db) {
  const columns = [
    ["payment_method", "ADD COLUMN payment_method VARCHAR(40) NULL"],
    ["variant_name", "ADD COLUMN variant_name VARCHAR(255) NULL"],
    ["variant_price", "ADD COLUMN variant_price DECIMAL(12,2) NULL"],
    ["recipient_name", "ADD COLUMN recipient_name VARCHAR(255) NULL"],
    ["delivery_contact", "ADD COLUMN delivery_contact VARCHAR(50) NULL"],
    ["delivery_address", "ADD COLUMN delivery_address TEXT NULL"],
    ["delivery_landmark", "ADD COLUMN delivery_landmark TEXT NULL"],
    ["delivery_latitude", "ADD COLUMN delivery_latitude DECIMAL(10,7) NULL"],
    ["delivery_longitude", "ADD COLUMN delivery_longitude DECIMAL(10,7) NULL"],
    ["delivery_note", "ADD COLUMN delivery_note TEXT NULL"],
    ["shipping_region", "ADD COLUMN shipping_region VARCHAR(40) NULL"],
    ["shipping_fee", "ADD COLUMN shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["payment_status", "ADD COLUMN payment_status VARCHAR(40) NULL"],
    ["payment_provider", "ADD COLUMN payment_provider VARCHAR(40) NULL"],
    ["payment_reference", "ADD COLUMN payment_reference VARCHAR(255) NULL"],
    ["payment_checkout_id", "ADD COLUMN payment_checkout_id VARCHAR(255) NULL"],
    ["payment_checkout_url", "ADD COLUMN payment_checkout_url TEXT NULL"],
    ["gcash_reference", "ADD COLUMN gcash_reference VARCHAR(80) NULL"],
    ["payment_proof_image", "ADD COLUMN payment_proof_image TEXT NULL"],
    ["payment_submitted_at", "ADD COLUMN payment_submitted_at DATETIME NULL"],
    ["payment_verified_at", "ADD COLUMN payment_verified_at DATETIME NULL"],
    ["payment_verified_by", "ADD COLUMN payment_verified_by INT NULL"],
    ["payment_verified_by_name", "ADD COLUMN payment_verified_by_name VARCHAR(255) NULL"],
    ["payment_rejection_reason", "ADD COLUMN payment_rejection_reason TEXT NULL"],
    ["payment_error", "ADD COLUMN payment_error TEXT NULL"],
    ["payment_last_checked_at", "ADD COLUMN payment_last_checked_at DATETIME NULL"],
    ["payment_completed_at", "ADD COLUMN payment_completed_at DATETIME NULL"],
    ["payment_failed_at", "ADD COLUMN payment_failed_at DATETIME NULL"],
    ["processing_at", "ADD COLUMN processing_at DATETIME NULL"],
    ["shipped_at", "ADD COLUMN shipped_at DATETIME NULL"],
    ["delivered_at", "ADD COLUMN delivered_at DATETIME NULL"],
    ["warranty_expires_at", "ADD COLUMN warranty_expires_at DATETIME NULL"],
    ["stock_restored_at", "ADD COLUMN stock_restored_at DATETIME NULL"],
    ["voucher_id", "ADD COLUMN voucher_id INT NULL"],
    ["voucher_code", "ADD COLUMN voucher_code VARCHAR(80) NULL"],
    ["voucher_discount", "ADD COLUMN voucher_discount DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["product_subtotal", "ADD COLUMN product_subtotal DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["final_product_total", "ADD COLUMN final_product_total DECIMAL(12,2) NOT NULL DEFAULT 0"]
  ];

  for (const [name, alter] of columns) {
    const rows = await query(db, `SHOW COLUMNS FROM orders LIKE '${name}'`);
    if (rows.length) continue;

    try {
      await query(db, `ALTER TABLE orders ${alter}`);
    } catch (err) {
      if (err.code !== "ER_DUP_FIELDNAME") throw err;
    }
  }
}

module.exports = { ensureOrderCoreColumns };

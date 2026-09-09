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
    ["delivery_note", "ADD COLUMN delivery_note TEXT NULL"],
    ["shipping_region", "ADD COLUMN shipping_region VARCHAR(40) NULL"],
    ["shipping_fee", "ADD COLUMN shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["payment_status", "ADD COLUMN payment_status VARCHAR(40) NULL"],
    ["payment_provider", "ADD COLUMN payment_provider VARCHAR(40) NULL"],
    ["payment_reference", "ADD COLUMN payment_reference VARCHAR(255) NULL"],
    ["payment_checkout_id", "ADD COLUMN payment_checkout_id VARCHAR(255) NULL"],
    ["payment_checkout_url", "ADD COLUMN payment_checkout_url TEXT NULL"],
    ["payment_error", "ADD COLUMN payment_error TEXT NULL"],
    ["payment_last_checked_at", "ADD COLUMN payment_last_checked_at DATETIME NULL"],
    ["payment_completed_at", "ADD COLUMN payment_completed_at DATETIME NULL"],
    ["payment_failed_at", "ADD COLUMN payment_failed_at DATETIME NULL"],
    ["processing_at", "ADD COLUMN processing_at DATETIME NULL"],
    ["shipped_at", "ADD COLUMN shipped_at DATETIME NULL"],
    ["delivered_at", "ADD COLUMN delivered_at DATETIME NULL"],
    ["warranty_expires_at", "ADD COLUMN warranty_expires_at DATETIME NULL"],
    ["stock_restored_at", "ADD COLUMN stock_restored_at DATETIME NULL"]
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
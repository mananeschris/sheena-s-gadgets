function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function ident(name) {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new Error(`Unsafe database identifier: ${name}`);
  }
  return `\`${name}\``;
}

function duplicateColumn(error) {
  return error?.code === "ER_DUP_FIELDNAME" || /duplicate column/i.test(error?.message || "");
}

async function ensureColumn(db, table, column, definition, report) {
  const rows = await run(db, `SHOW COLUMNS FROM ${ident(table)} LIKE ?`, [column]);
  if (rows.length) return;

  try {
    await run(db, `ALTER TABLE ${ident(table)} ADD COLUMN ${ident(column)} ${definition}`);
    report.addedColumns.push(`${table}.${column}`);
  } catch (error) {
    if (!duplicateColumn(error)) throw error;
  }
}

async function ensureColumns(db, table, columns, report) {
  for (const [column, definition] of columns) {
    await ensureColumn(db, table, column, definition, report);
  }
}

async function ensureTable(db, name, sql, report) {
  await run(db, sql);
  report.checkedTables.push(name);
}

async function ensureCoreSchema(db) {
  const report = {
    checkedTables: [],
    addedColumns: []
  };

  await ensureTable(db, "users", `
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(30) NOT NULL DEFAULT 'customer',
      birthday DATE NULL,
      phone VARCHAR(50) NULL,
      gender VARCHAR(40) NULL,
      address TEXT NULL,
      city VARCHAR(120) NULL,
      province VARCHAR(120) NULL,
      postal_code VARCHAR(30) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, report);

  await ensureColumns(db, "users", [
    ["name", "VARCHAR(255) NULL"],
    ["email", "VARCHAR(255) NULL"],
    ["password", "VARCHAR(255) NULL"],
    ["role", "VARCHAR(30) NOT NULL DEFAULT 'customer'"],
    ["birthday", "DATE NULL"],
    ["phone", "VARCHAR(50) NULL"],
    ["gender", "VARCHAR(40) NULL"],
    ["address", "TEXT NULL"],
    ["city", "VARCHAR(120) NULL"],
    ["province", "VARCHAR(120) NULL"],
    ["postal_code", "VARCHAR(30) NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ], report);

  await ensureTable(db, "customer_addresses", `
    CREATE TABLE IF NOT EXISTS customer_addresses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      label VARCHAR(80) NOT NULL DEFAULT 'Home',
      recipient_name VARCHAR(255) NOT NULL,
      phone VARCHAR(50) NOT NULL,
      address TEXT NOT NULL,
      city VARCHAR(120) NULL,
      province VARCHAR(120) NULL,
      postal_code VARCHAR(30) NULL,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_customer_address_user (user_id),
      INDEX idx_customer_address_default (user_id, is_default)
    )
  `, report);

  await ensureColumns(db, "customer_addresses", [
    ["user_id", "INT NULL"],
    ["label", "VARCHAR(80) NOT NULL DEFAULT 'Home'"],
    ["recipient_name", "VARCHAR(255) NULL"],
    ["phone", "VARCHAR(50) NULL"],
    ["address", "TEXT NULL"],
    ["city", "VARCHAR(120) NULL"],
    ["province", "VARCHAR(120) NULL"],
    ["postal_code", "VARCHAR(30) NULL"],
    ["is_default", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"],
    ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
  ], report);
  await ensureTable(db, "products", `
    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT NULL,
      category VARCHAR(80) NULL,
      price DECIMAL(12,2) NOT NULL DEFAULT 0,
      stock INT NOT NULL DEFAULT 0,
      image TEXT NULL,
      images TEXT NULL,
      variants TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, report);

  await ensureColumns(db, "products", [
    ["name", "VARCHAR(255) NULL"],
    ["description", "TEXT NULL"],
    ["category", "VARCHAR(80) NULL"],
    ["price", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["stock", "INT NOT NULL DEFAULT 0"],
    ["image", "TEXT NULL"],
    ["images", "TEXT NULL"],
    ["variants", "TEXT NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ], report);

  await ensureTable(db, "inventory_movements", `
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NULL,
      variant_index INT NULL,
      variant_name VARCHAR(255) NULL,
      order_id INT NULL,
      movement_type VARCHAR(80) NOT NULL,
      quantity_change INT NOT NULL,
      quantity_before INT NULL,
      quantity_after INT NULL,
      actor_id INT NULL,
      actor_name VARCHAR(255) NULL,
      actor_role VARCHAR(50) NULL,
      source VARCHAR(80) NULL,
      note TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_inventory_product (product_id),
      INDEX idx_inventory_order (order_id),
      INDEX idx_inventory_type (movement_type),
      INDEX idx_inventory_created (created_at)
    )
  `, report);

  await ensureColumns(db, "inventory_movements", [
    ["product_id", "INT NULL"],
    ["product_name", "VARCHAR(255) NULL"],
    ["variant_index", "INT NULL"],
    ["variant_name", "VARCHAR(255) NULL"],
    ["order_id", "INT NULL"],
    ["movement_type", "VARCHAR(80) NOT NULL DEFAULT 'manual_adjustment'"],
    ["quantity_change", "INT NOT NULL DEFAULT 0"],
    ["quantity_before", "INT NULL"],
    ["quantity_after", "INT NULL"],
    ["actor_id", "INT NULL"],
    ["actor_name", "VARCHAR(255) NULL"],
    ["actor_role", "VARCHAR(50) NULL"],
    ["source", "VARCHAR(80) NULL"],
    ["note", "TEXT NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ], report);

  await ensureTable(db, "orders", `
    CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NULL,
      quantity INT NOT NULL DEFAULT 1,
      total_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      user_id INT NULL,
      payment_method VARCHAR(40) NULL,
      payment_status VARCHAR(80) NULL,
      payment_provider VARCHAR(80) NULL,
      payment_reference VARCHAR(255) NULL,
      payment_checkout_id VARCHAR(255) NULL,
      payment_checkout_url TEXT NULL,
      payment_error TEXT NULL,
      payment_last_checked_at DATETIME NULL,
      payment_completed_at DATETIME NULL,
      payment_failed_at DATETIME NULL,
      variant_name VARCHAR(255) NULL,
      variant_price DECIMAL(12,2) NULL,
      recipient_name VARCHAR(255) NULL,
      delivery_contact VARCHAR(50) NULL,
      delivery_address TEXT NULL,
      delivery_note TEXT NULL,
      shipping_region VARCHAR(40) NULL,
      shipping_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      processing_at DATETIME NULL,
      shipped_at DATETIME NULL,
      delivered_at DATETIME NULL,
      warranty_expires_at DATETIME NULL,
      stock_restored_at DATETIME NULL,
      installment_terms INT NULL,
      installment_downpayment DECIMAL(12,2) NULL,
      installment_monthly DECIMAL(12,2) NULL,
      installment_balance DECIMAL(12,2) NULL,
      installment_application_id INT NULL,
      cancellation_request_status VARCHAR(30) NULL,
      cancellation_reason TEXT NULL,
      cancellation_admin_note TEXT NULL,
      cancellation_requested_at DATETIME NULL,
      cancellation_reviewed_at DATETIME NULL,
      repair_request_status VARCHAR(30) NULL,
      repair_service_status VARCHAR(40) NULL,
      repair_issue TEXT NULL,
      repair_admin_note TEXT NULL,
      repair_requested_at DATETIME NULL,
      repair_reviewed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, report);

  await ensureColumns(db, "orders", [
    ["product_id", "INT NULL"],
    ["quantity", "INT NOT NULL DEFAULT 1"],
    ["total_price", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["user_id", "INT NULL"],
    ["payment_method", "VARCHAR(40) NULL"],
    ["payment_status", "VARCHAR(80) NULL"],
    ["payment_provider", "VARCHAR(80) NULL"],
    ["payment_reference", "VARCHAR(255) NULL"],
    ["payment_checkout_id", "VARCHAR(255) NULL"],
    ["payment_checkout_url", "TEXT NULL"],
    ["payment_error", "TEXT NULL"],
    ["payment_last_checked_at", "DATETIME NULL"],
    ["payment_completed_at", "DATETIME NULL"],
    ["payment_failed_at", "DATETIME NULL"],
    ["variant_name", "VARCHAR(255) NULL"],
    ["variant_price", "DECIMAL(12,2) NULL"],
    ["recipient_name", "VARCHAR(255) NULL"],
    ["delivery_contact", "VARCHAR(50) NULL"],
    ["delivery_address", "TEXT NULL"],
    ["delivery_note", "TEXT NULL"],
    ["shipping_region", "VARCHAR(40) NULL"],
    ["shipping_fee", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["status", "VARCHAR(40) NOT NULL DEFAULT 'pending'"],
    ["processing_at", "DATETIME NULL"],
    ["shipped_at", "DATETIME NULL"],
    ["delivered_at", "DATETIME NULL"],
    ["warranty_expires_at", "DATETIME NULL"],
    ["stock_restored_at", "DATETIME NULL"],
    ["installment_terms", "INT NULL"],
    ["installment_downpayment", "DECIMAL(12,2) NULL"],
    ["installment_monthly", "DECIMAL(12,2) NULL"],
    ["installment_balance", "DECIMAL(12,2) NULL"],
    ["installment_application_id", "INT NULL"],
    ["cancellation_request_status", "VARCHAR(30) NULL"],
    ["cancellation_reason", "TEXT NULL"],
    ["cancellation_admin_note", "TEXT NULL"],
    ["cancellation_requested_at", "DATETIME NULL"],
    ["cancellation_reviewed_at", "DATETIME NULL"],
    ["repair_request_status", "VARCHAR(30) NULL"],
    ["repair_service_status", "VARCHAR(40) NULL"],
    ["repair_issue", "TEXT NULL"],
    ["repair_admin_note", "TEXT NULL"],
    ["repair_requested_at", "DATETIME NULL"],
    ["repair_reviewed_at", "DATETIME NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ], report);

  await ensureTable(db, "order_items", `
    CREATE TABLE IF NOT EXISTS order_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      variant_index INT NULL,
      variant_name VARCHAR(255) NULL,
      quantity INT NOT NULL DEFAULT 1,
      unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
      product_image TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, report);

  await ensureColumns(db, "order_items", [
    ["order_id", "INT NULL"],
    ["product_id", "INT NULL"],
    ["product_name", "VARCHAR(255) NULL"],
    ["variant_index", "INT NULL"],
    ["variant_name", "VARCHAR(255) NULL"],
    ["quantity", "INT NOT NULL DEFAULT 1"],
    ["unit_price", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["subtotal", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["product_image", "TEXT NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ], report);

  await ensureTable(db, "payments", `
    CREATE TABLE IF NOT EXISTS payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
      balance DECIMAL(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'unpaid',
      due_date DATE NULL,
      paid_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, report);

  await ensureColumns(db, "payments", [
    ["order_id", "INT NULL"],
    ["amount_paid", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["balance", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["status", "VARCHAR(40) NOT NULL DEFAULT 'unpaid'"],
    ["due_date", "DATE NULL"],
    ["paid_at", "DATETIME NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ], report);

  await ensureTable(db, "vouchers", `
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
  `, report);

  await ensureColumns(db, "vouchers", [
    ["code", "VARCHAR(80) NULL"],
    ["discount_type", "VARCHAR(30) NOT NULL DEFAULT 'fixed'"],
    ["discount_value", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["min_quantity", "INT NOT NULL DEFAULT 0"],
    ["min_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["product_id", "INT NULL"],
    ["is_active", "TINYINT(1) NOT NULL DEFAULT 1"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ], report);

  await ensureTable(db, "installment_applications", `
    CREATE TABLE IF NOT EXISTS installment_applications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      order_id INT NULL,
      full_name VARCHAR(255) NOT NULL,
      birthday DATE NOT NULL,
      phone VARCHAR(50) NOT NULL,
      address TEXT NOT NULL,
      employment_status VARCHAR(80) NOT NULL,
      employer_name VARCHAR(255) NULL,
      monthly_income DECIMAL(12,2) NOT NULL DEFAULT 0,
      valid_id_type VARCHAR(80) NOT NULL,
      valid_id_number VARCHAR(120) NOT NULL,
      preferred_terms INT NOT NULL DEFAULT 3,
      requested_limit DECIMAL(12,2) NOT NULL DEFAULT 0,
      order_total DECIMAL(12,2) NOT NULL DEFAULT 0,
      downpayment_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      downpayment_method VARCHAR(40) NULL,
      downpayment_status VARCHAR(40) NOT NULL DEFAULT 'pending',
      financed_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      monthly_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      national_id_image TEXT NULL,
      selfie_with_id_image TEXT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      admin_note TEXT NULL,
      reviewed_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `, report);

  await ensureColumns(db, "installment_applications", [
    ["user_id", "INT NULL"],
    ["order_id", "INT NULL"],
    ["full_name", "VARCHAR(255) NULL"],
    ["birthday", "DATE NULL"],
    ["phone", "VARCHAR(50) NULL"],
    ["address", "TEXT NULL"],
    ["employment_status", "VARCHAR(80) NULL"],
    ["employer_name", "VARCHAR(255) NULL"],
    ["monthly_income", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["valid_id_type", "VARCHAR(80) NULL"],
    ["valid_id_number", "VARCHAR(120) NULL"],
    ["preferred_terms", "INT NOT NULL DEFAULT 3"],
    ["requested_limit", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["order_total", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["downpayment_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["downpayment_method", "VARCHAR(40) NULL"],
    ["downpayment_status", "VARCHAR(40) NOT NULL DEFAULT 'pending'"],
    ["financed_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["monthly_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["national_id_image", "TEXT NULL"],
    ["selfie_with_id_image", "TEXT NULL"],
    ["status", "VARCHAR(30) NOT NULL DEFAULT 'pending'"],
    ["admin_note", "TEXT NULL"],
    ["reviewed_at", "DATETIME NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"],
    ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
  ], report);

  await ensureTable(db, "installment_schedules", `
    CREATE TABLE IF NOT EXISTS installment_schedules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      application_id INT NOT NULL,
      order_id INT NOT NULL,
      user_id INT NOT NULL,
      installment_no INT NOT NULL,
      due_date DATE NOT NULL,
      amount_due DECIMAL(12,2) NOT NULL DEFAULT 0,
      amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'unpaid',
      paid_at DATETIME NULL,
      payment_method VARCHAR(40) NULL,
      payment_provider VARCHAR(80) NULL,
      payment_reference VARCHAR(255) NULL,
      payment_checkout_id VARCHAR(255) NULL,
      payment_checkout_url TEXT NULL,
      payment_status VARCHAR(40) NULL,
      payment_error TEXT NULL,
      payment_last_checked_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `, report);

  await ensureColumns(db, "installment_schedules", [
    ["application_id", "INT NULL"],
    ["order_id", "INT NULL"],
    ["user_id", "INT NULL"],
    ["installment_no", "INT NULL"],
    ["due_date", "DATE NULL"],
    ["amount_due", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["amount_paid", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["status", "VARCHAR(30) NOT NULL DEFAULT 'unpaid'"],
    ["paid_at", "DATETIME NULL"],
    ["payment_method", "VARCHAR(40) NULL"],
    ["payment_provider", "VARCHAR(80) NULL"],
    ["payment_reference", "VARCHAR(255) NULL"],
    ["payment_checkout_id", "VARCHAR(255) NULL"],
    ["payment_checkout_url", "TEXT NULL"],
    ["payment_status", "VARCHAR(40) NULL"],
    ["payment_error", "TEXT NULL"],
    ["payment_last_checked_at", "DATETIME NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"],
    ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
  ], report);

  await ensureTable(db, "layaways", `
    CREATE TABLE IF NOT EXISTS layaways (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customer_id INT NULL,
      customer_name VARCHAR(255) NOT NULL,
      customer_phone VARCHAR(80) NULL,
      customer_email VARCHAR(255) NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      variant_index INT NULL,
      variant_name VARCHAR(255) NULL,
      quantity INT NOT NULL DEFAULT 1,
      unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
      balance DECIMAL(12,2) NOT NULL DEFAULT 0,
      payment_method VARCHAR(60) NULL,
      payment_reference VARCHAR(255) NULL,
      due_date DATE NULL,
      term_months INT NOT NULL DEFAULT 5,
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      note TEXT NULL,
      released_at DATETIME NULL,
      cancelled_at DATETIME NULL,
      cancel_reason TEXT NULL,
      created_by INT NULL,
      created_by_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_layaway_customer (customer_id),
      INDEX idx_layaway_product (product_id),
      INDEX idx_layaway_status (status),
      INDEX idx_layaway_due (due_date)
    )
  `, report);

  await ensureColumns(db, "layaways", [
    ["customer_id", "INT NULL"],
    ["customer_name", "VARCHAR(255) NULL"],
    ["customer_phone", "VARCHAR(80) NULL"],
    ["customer_email", "VARCHAR(255) NULL"],
    ["product_id", "INT NULL"],
    ["product_name", "VARCHAR(255) NULL"],
    ["variant_index", "INT NULL"],
    ["variant_name", "VARCHAR(255) NULL"],
    ["quantity", "INT NOT NULL DEFAULT 1"],
    ["unit_price", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["total_amount", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["amount_paid", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["balance", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["payment_method", "VARCHAR(60) NULL"],
    ["payment_reference", "VARCHAR(255) NULL"],
    ["due_date", "DATE NULL"],
    ["term_months", "INT NOT NULL DEFAULT 5"],
    ["status", "VARCHAR(30) NOT NULL DEFAULT 'active'"],
    ["note", "TEXT NULL"],
    ["released_at", "DATETIME NULL"],
    ["cancelled_at", "DATETIME NULL"],
    ["cancel_reason", "TEXT NULL"],
    ["created_by", "INT NULL"],
    ["created_by_name", "VARCHAR(255) NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"],
    ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
  ], report);

  await ensureTable(db, "layaway_payments", `
    CREATE TABLE IF NOT EXISTS layaway_payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      layaway_id INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      payment_method VARCHAR(60) NULL,
      payment_reference VARCHAR(255) NULL,
      note TEXT NULL,
      received_by INT NULL,
      received_by_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_layaway_payment_layaway (layaway_id),
      INDEX idx_layaway_payment_created (created_at)
    )
  `, report);

  await ensureColumns(db, "layaway_payments", [
    ["layaway_id", "INT NULL"],
    ["amount", "DECIMAL(12,2) NOT NULL DEFAULT 0"],
    ["payment_method", "VARCHAR(60) NULL"],
    ["payment_reference", "VARCHAR(255) NULL"],
    ["note", "TEXT NULL"],
    ["received_by", "INT NULL"],
    ["received_by_name", "VARCHAR(255) NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ], report);
  await ensureTable(db, "product_reviews", `
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
      UNIQUE KEY unique_order_review (order_id)
    )
  `, report);

  await ensureColumns(db, "product_reviews", [
    ["order_id", "INT NULL"],
    ["product_id", "INT NULL"],
    ["user_id", "INT NULL"],
    ["rating", "INT NULL"],
    ["comment", "TEXT NULL"],
    ["images", "TEXT NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"],
    ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
  ], report);

  await ensureTable(db, "notifications", `
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      type VARCHAR(50) NOT NULL DEFAULT 'info',
      action_url TEXT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, report);

  await ensureColumns(db, "notifications", [
    ["user_id", "INT NULL"],
    ["title", "VARCHAR(255) NULL"],
    ["message", "TEXT NULL"],
    ["type", "VARCHAR(50) NOT NULL DEFAULT 'info'"],
    ["action_url", "TEXT NULL"],
    ["is_read", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ], report);

  await ensureTable(db, "audit_logs", `
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      actor_id INT NULL,
      actor_name VARCHAR(255) NULL,
      actor_role VARCHAR(50) NULL,
      action VARCHAR(120) NOT NULL,
      entity_type VARCHAR(80) NOT NULL,
      entity_id VARCHAR(80) NULL,
      details TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, report);

  await ensureColumns(db, "audit_logs", [
    ["actor_id", "INT NULL"],
    ["actor_name", "VARCHAR(255) NULL"],
    ["actor_role", "VARCHAR(50) NULL"],
    ["action", "VARCHAR(120) NULL"],
    ["entity_type", "VARCHAR(80) NULL"],
    ["entity_id", "VARCHAR(80) NULL"],
    ["details", "TEXT NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ], report);

  await ensureTable(db, "delivery_assignments", `
    CREATE TABLE IF NOT EXISTS delivery_assignments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      rider_id INT NOT NULL,
      rider_name VARCHAR(255) NULL,
      rider_phone VARCHAR(80) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'assigned',
      pickup_note TEXT NULL,
      delivery_note TEXT NULL,
      failed_reason TEXT NULL,
      assigned_by INT NULL,
      assigned_by_name VARCHAR(255) NULL,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      picked_up_at DATETIME NULL,
      out_for_delivery_at DATETIME NULL,
      delivered_at DATETIME NULL,
      failed_at DATETIME NULL,
      cancelled_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_delivery_order (order_id),
      INDEX idx_delivery_rider (rider_id),
      INDEX idx_delivery_status (status),
      INDEX idx_delivery_assigned (assigned_at)
    )
  `, report);

  await ensureColumns(db, "delivery_assignments", [
    ["order_id", "INT NULL"],
    ["rider_id", "INT NULL"],
    ["rider_name", "VARCHAR(255) NULL"],
    ["rider_phone", "VARCHAR(80) NULL"],
    ["status", "VARCHAR(40) NOT NULL DEFAULT 'assigned'"],
    ["pickup_note", "TEXT NULL"],
    ["delivery_note", "TEXT NULL"],
    ["failed_reason", "TEXT NULL"],
    ["assigned_by", "INT NULL"],
    ["assigned_by_name", "VARCHAR(255) NULL"],
    ["assigned_at", "DATETIME DEFAULT CURRENT_TIMESTAMP"],
    ["picked_up_at", "DATETIME NULL"],
    ["out_for_delivery_at", "DATETIME NULL"],
    ["delivered_at", "DATETIME NULL"],
    ["failed_at", "DATETIME NULL"],
    ["cancelled_at", "DATETIME NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"],
    ["updated_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
  ], report);
  await ensureTable(db, "order_status_history", `
    CREATE TABLE IF NOT EXISTS order_status_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      status VARCHAR(40) NOT NULL,
      note TEXT NULL,
      actor_role VARCHAR(40) NULL,
      actor_name VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `, report);

  await ensureColumns(db, "order_status_history", [
    ["order_id", "INT NULL"],
    ["status", "VARCHAR(40) NULL"],
    ["note", "TEXT NULL"],
    ["actor_role", "VARCHAR(40) NULL"],
    ["actor_name", "VARCHAR(255) NULL"],
    ["created_at", "TIMESTAMP DEFAULT CURRENT_TIMESTAMP"]
  ], report);

  return report;
}

module.exports = {
  ensureCoreSchema
};

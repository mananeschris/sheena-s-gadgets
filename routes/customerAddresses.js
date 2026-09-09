const express = require("express");
const router = express.Router();

function dbQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function cleanText(value, maxLength = 1000) {
  return String(value || "").trim().slice(0, maxLength);
}

function toUserId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function ensureAddressTable(db) {
  await dbQuery(db, `
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
  `);

  const columns = [
    ["label", "ADD COLUMN label VARCHAR(80) NOT NULL DEFAULT 'Home'"],
    ["recipient_name", "ADD COLUMN recipient_name VARCHAR(255) NOT NULL"],
    ["phone", "ADD COLUMN phone VARCHAR(50) NOT NULL"],
    ["address", "ADD COLUMN address TEXT NOT NULL"],
    ["city", "ADD COLUMN city VARCHAR(120) NULL"],
    ["province", "ADD COLUMN province VARCHAR(120) NULL"],
    ["postal_code", "ADD COLUMN postal_code VARCHAR(30) NULL"],
    ["is_default", "ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0"],
    ["created_at", "ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"],
    ["updated_at", "ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"]
  ];

  for (const [column, alter] of columns) {
    const rows = await dbQuery(db, `SHOW COLUMNS FROM customer_addresses LIKE ?`, [column]);
    if (!rows.length) await dbQuery(db, `ALTER TABLE customer_addresses ${alter}`);
  }
}

function normalizeAddressPayload(body) {
  return {
    user_id: toUserId(body.user_id),
    label: cleanText(body.label || "Home", 80) || "Home",
    recipient_name: cleanText(body.recipient_name, 255),
    phone: cleanText(body.phone || body.delivery_contact, 50),
    address: cleanText(body.address || body.delivery_address, 1000),
    city: cleanText(body.city, 120),
    province: cleanText(body.province, 120),
    postal_code: cleanText(body.postal_code, 30),
    is_default: Number(body.is_default || 0) ? 1 : 0
  };
}

function validateAddress(payload) {
  if (!payload.user_id) return "Signed-in customer is required.";
  if (!payload.recipient_name || !payload.phone || !payload.address) {
    return "Recipient name, phone, and address are required.";
  }
  return null;
}

async function makeDefaultIfNeeded(db, userId, addressId, requestedDefault) {
  const rows = await dbQuery(db, "SELECT COUNT(*) AS total FROM customer_addresses WHERE user_id=?", [userId]);
  const isFirst = Number(rows[0]?.total || 0) <= 1;
  const defaults = await dbQuery(db, "SELECT id FROM customer_addresses WHERE user_id=? AND is_default=1 LIMIT 1", [userId]);
  if (!requestedDefault && !isFirst && defaults.length) return;
  await dbQuery(db, "UPDATE customer_addresses SET is_default=0 WHERE user_id=? AND id<>?", [userId, addressId]);
  await dbQuery(db, "UPDATE customer_addresses SET is_default=1 WHERE user_id=? AND id=?", [userId, addressId]);
}

async function seedDefaultFromUser(db, userId) {
  const existing = await dbQuery(db, "SELECT id FROM customer_addresses WHERE user_id=? LIMIT 1", [userId]);
  if (existing.length) return;

  const users = await dbQuery(db, "SELECT name, phone, address, city, province, postal_code FROM users WHERE id=? AND role='customer' LIMIT 1", [userId]);
  const user = users[0];
  if (!user || !user.address || !user.phone) return;

  await dbQuery(db, `
    INSERT INTO customer_addresses (user_id, label, recipient_name, phone, address, city, province, postal_code, is_default)
    VALUES (?, 'Home', ?, ?, ?, ?, ?, ?, 1)
  `, [
    userId,
    user.name || "Customer",
    user.phone,
    user.address,
    user.city || null,
    user.province || null,
    user.postal_code || null
  ]);
}

async function listAddresses(db, userId) {
  await seedDefaultFromUser(db, userId);
  return dbQuery(db, `
    SELECT *
    FROM customer_addresses
    WHERE user_id=?
    ORDER BY is_default DESC, updated_at DESC, id DESC
  `, [userId]);
}

router.use(async (req, res, next) => {
  try {
    await ensureAddressTable(req.db);
    next();
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to prepare address book." });
  }
});

router.get("/:user_id", async (req, res) => {
  const userId = toUserId(req.params.user_id);
  if (!userId) return res.status(400).json({ message: "Valid customer id is required." });

  try {
    const rows = await listAddresses(req.db, userId);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load addresses." });
  }
});

router.post("/", async (req, res) => {
  const payload = normalizeAddressPayload(req.body);
  const validation = validateAddress(payload);
  if (validation) return res.status(400).json({ message: validation });

  try {
    const result = await dbQuery(req.db, `
      INSERT INTO customer_addresses (user_id, label, recipient_name, phone, address, city, province, postal_code, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      payload.user_id,
      payload.label,
      payload.recipient_name,
      payload.phone,
      payload.address,
      payload.city || null,
      payload.province || null,
      payload.postal_code || null,
      payload.is_default
    ]);
    await makeDefaultIfNeeded(req.db, payload.user_id, result.insertId, payload.is_default);
    const rows = await listAddresses(req.db, payload.user_id);
    res.json({ message: "Address saved.", address_id: result.insertId, addresses: rows });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to save address." });
  }
});

router.put("/:id", async (req, res) => {
  const addressId = Number(req.params.id);
  const payload = normalizeAddressPayload(req.body);
  const validation = validateAddress(payload);
  if (!Number.isInteger(addressId) || addressId <= 0) return res.status(400).json({ message: "Valid address id is required." });
  if (validation) return res.status(400).json({ message: validation });

  try {
    const result = await dbQuery(req.db, `
      UPDATE customer_addresses
      SET label=?, recipient_name=?, phone=?, address=?, city=?, province=?, postal_code=?, is_default=?
      WHERE id=? AND user_id=?
    `, [
      payload.label,
      payload.recipient_name,
      payload.phone,
      payload.address,
      payload.city || null,
      payload.province || null,
      payload.postal_code || null,
      payload.is_default,
      addressId,
      payload.user_id
    ]);
    if (!result.affectedRows) return res.status(404).json({ message: "Address not found." });
    await makeDefaultIfNeeded(req.db, payload.user_id, addressId, payload.is_default);
    const rows = await listAddresses(req.db, payload.user_id);
    res.json({ message: "Address updated.", addresses: rows });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to update address." });
  }
});

router.put("/:id/default", async (req, res) => {
  const addressId = Number(req.params.id);
  const userId = toUserId(req.body.user_id || req.query.user_id);
  if (!Number.isInteger(addressId) || addressId <= 0 || !userId) {
    return res.status(400).json({ message: "Valid customer and address id are required." });
  }

  try {
    const rows = await dbQuery(req.db, "SELECT id FROM customer_addresses WHERE id=? AND user_id=?", [addressId, userId]);
    if (!rows.length) return res.status(404).json({ message: "Address not found." });
    await dbQuery(req.db, "UPDATE customer_addresses SET is_default=0 WHERE user_id=?", [userId]);
    await dbQuery(req.db, "UPDATE customer_addresses SET is_default=1 WHERE id=? AND user_id=?", [addressId, userId]);
    res.json({ message: "Default address updated.", addresses: await listAddresses(req.db, userId) });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to set default address." });
  }
});

router.delete("/:id", async (req, res) => {
  const addressId = Number(req.params.id);
  const userId = toUserId(req.body.user_id || req.query.user_id);
  if (!Number.isInteger(addressId) || addressId <= 0 || !userId) {
    return res.status(400).json({ message: "Valid customer and address id are required." });
  }

  try {
    const rows = await dbQuery(req.db, "SELECT is_default FROM customer_addresses WHERE id=? AND user_id=?", [addressId, userId]);
    if (!rows.length) return res.status(404).json({ message: "Address not found." });
    await dbQuery(req.db, "DELETE FROM customer_addresses WHERE id=? AND user_id=?", [addressId, userId]);
    const defaults = await dbQuery(req.db, "SELECT id FROM customer_addresses WHERE user_id=? AND is_default=1 LIMIT 1", [userId]);
    if (!defaults.length) {
      const next = await dbQuery(req.db, "SELECT id FROM customer_addresses WHERE user_id=? ORDER BY updated_at DESC, id DESC LIMIT 1", [userId]);
      if (next.length) await dbQuery(req.db, "UPDATE customer_addresses SET is_default=1 WHERE id=?", [next[0].id]);
    }
    res.json({ message: "Address deleted.", addresses: await listAddresses(req.db, userId) });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to delete address." });
  }
});

module.exports = router;
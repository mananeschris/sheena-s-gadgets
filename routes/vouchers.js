const express = require("express");
const router = express.Router();
const { logAudit, auditActor } = require("./auditLogs");
const { requireAdmin, verifiedActor } = require("./roleGuard");
const {
  dbQuery,
  ensureVoucherTables,
  normalizeVoucherCode,
  normalizeCheckoutType,
  validateVoucher
} = require("./voucherService");

function cleanMoney(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.max(amount, 0) : 0;
}

function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return String(value).split(",").map(item => item.trim()).filter(Boolean);
  }
}

function normalizePayload(body) {
  const discountType = ["percent", "percentage"].includes(String(body.discount_type || "").toLowerCase())
    ? "percent"
    : "fixed";
  const applicability = ["selected_products", "selected_categories", "all"].includes(String(body.applicability_type || "").toLowerCase())
    ? String(body.applicability_type).toLowerCase()
    : body.product_id
      ? "selected_products"
      : "all";
  const productIds = parseArray(body.applicable_product_ids);
  if (body.product_id && !productIds.map(Number).includes(Number(body.product_id))) productIds.push(Number(body.product_id));

  return {
    code: normalizeVoucherCode(body.code),
    discount_type: discountType,
    discount_value: cleanMoney(body.discount_value),
    min_quantity: Math.max(Number(body.min_quantity || 0), 0),
    min_amount: cleanMoney(body.min_amount),
    max_discount_amount: body.max_discount_amount === "" || body.max_discount_amount === undefined ? null : cleanMoney(body.max_discount_amount),
    starts_at: body.starts_at || body.start_date || null,
    expires_at: body.expires_at || body.expiration_date || null,
    usage_limit: body.usage_limit === "" || body.usage_limit === undefined ? null : Math.max(Number(body.usage_limit || 0), 0),
    usage_limit_per_customer: body.usage_limit_per_customer === "" || body.usage_limit_per_customer === undefined ? null : Math.max(Number(body.usage_limit_per_customer || 0), 0),
    is_active: Number(body.is_active === undefined ? 1 : body.is_active) ? 1 : 0,
    applicability_type: applicability,
    applicable_product_ids: JSON.stringify(productIds.map(Number).filter(Boolean)),
    applicable_categories: JSON.stringify(parseArray(body.applicable_categories).map(String).filter(Boolean)),
    allowed_checkout_types: JSON.stringify(parseArray(body.allowed_checkout_types).map(normalizeCheckoutType))
  };
}

router.get("/admin/all", requireAdmin, async (req, res) => {
  try {
    await ensureVoucherTables(req.db);
    const rows = await dbQuery(req.db, `
      SELECT *
      FROM vouchers
      WHERE deleted_at IS NULL
      ORDER BY id DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/", async (req, res) => {
  try {
    await ensureVoucherTables(req.db);
    const rows = await dbQuery(req.db, `
      SELECT id, code, discount_type, discount_value, min_quantity, min_amount, max_discount_amount,
             starts_at, expires_at, usage_limit, usage_limit_per_customer, applicability_type,
             applicable_product_ids, applicable_categories, allowed_checkout_types, redemption_count, is_active
      FROM vouchers
      WHERE COALESCE(is_active, 1) = 1
        AND deleted_at IS NULL
      ORDER BY id DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/validate", async (req, res) => {
  try {
    const result = await validateVoucher(req.db, {
      code: req.body.code,
      customer_id: req.body.customer_id || req.body.user_id,
      checkout_type: req.body.checkout_type,
      items: req.body.items || []
    });
    if (!result) return res.json({ valid: false, discount: 0, message: "No voucher code entered." });
    res.json({ valid: true, message: `Voucher ${result.voucher_code} applied.`, ...result });
  } catch (error) {
    res.status(400).json({ valid: false, discount: 0, message: error.message });
  }
});

router.post("/", requireAdmin, async (req, res) => {
  try {
    await ensureVoucherTables(req.db);
    const payload = normalizePayload(req.body);
    if (!payload.code) return res.status(400).json({ message: "Voucher code is required." });
    if (payload.discount_value <= 0) return res.status(400).json({ message: "Discount value must be greater than zero." });

    const duplicate = await dbQuery(req.db, "SELECT id FROM vouchers WHERE normalized_code=? LIMIT 1", [payload.code]);
    if (duplicate.length) return res.status(400).json({ message: "Voucher code already exists." });

    const result = await dbQuery(req.db, `
      INSERT INTO vouchers
      (code, normalized_code, discount_type, discount_value, min_quantity, min_amount, max_discount_amount,
       starts_at, expires_at, usage_limit, usage_limit_per_customer, is_active, applicability_type,
       applicable_product_ids, applicable_categories, allowed_checkout_types)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      payload.code,
      payload.code,
      payload.discount_type,
      payload.discount_value,
      payload.min_quantity,
      payload.min_amount,
      payload.max_discount_amount,
      payload.starts_at,
      payload.expires_at,
      payload.usage_limit,
      payload.usage_limit_per_customer,
      payload.is_active,
      payload.applicability_type,
      payload.applicable_product_ids,
      payload.applicable_categories,
      payload.allowed_checkout_types
    ]);

    const actor = verifiedActor(req, auditActor(req));
    logAudit(req.db, {
      ...actor,
      action: "create_voucher",
      entity_type: "voucher",
      entity_id: result.insertId,
      details: `${payload.code} | ${payload.discount_type} ${payload.discount_value}`
    });
    res.json({ message: "Voucher created successfully", id: result.insertId });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put("/:id", requireAdmin, async (req, res) => {
  try {
    await ensureVoucherTables(req.db);
    const existing = await dbQuery(req.db, "SELECT * FROM vouchers WHERE id=? AND deleted_at IS NULL LIMIT 1", [req.params.id]);
    if (!existing.length) return res.status(404).json({ message: "Voucher not found." });

    if (Object.keys(req.body).length === 1 && req.body.is_active !== undefined) {
      await dbQuery(req.db, "UPDATE vouchers SET is_active=? WHERE id=? AND deleted_at IS NULL", [Number(req.body.is_active) ? 1 : 0, req.params.id]);
    } else {
      const payload = normalizePayload({ ...existing[0], ...req.body });
      const duplicate = await dbQuery(req.db, "SELECT id FROM vouchers WHERE normalized_code=? AND id<>? LIMIT 1", [payload.code, req.params.id]);
      if (duplicate.length) return res.status(400).json({ message: "Voucher code already exists." });

      await dbQuery(req.db, `
        UPDATE vouchers
        SET code=?, normalized_code=?, discount_type=?, discount_value=?, min_quantity=?, min_amount=?,
            max_discount_amount=?, starts_at=?, expires_at=?, usage_limit=?, usage_limit_per_customer=?,
            is_active=?, applicability_type=?, applicable_product_ids=?, applicable_categories=?, allowed_checkout_types=?
        WHERE id=? AND deleted_at IS NULL
      `, [
        payload.code,
        payload.code,
        payload.discount_type,
        payload.discount_value,
        payload.min_quantity,
        payload.min_amount,
        payload.max_discount_amount,
        payload.starts_at,
        payload.expires_at,
        payload.usage_limit,
        payload.usage_limit_per_customer,
        payload.is_active,
        payload.applicability_type,
        payload.applicable_product_ids,
        payload.applicable_categories,
        payload.allowed_checkout_types,
        req.params.id
      ]);
    }

    const actor = verifiedActor(req, auditActor(req));
    logAudit(req.db, {
      ...actor,
      action: "update_voucher",
      entity_type: "voucher",
      entity_id: req.params.id,
      details: `Voucher #${req.params.id} updated`
    });
    res.json({ message: "Voucher updated" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete("/:id", requireAdmin, async (req, res) => {
  try {
    await ensureVoucherTables(req.db);
    const result = await dbQuery(req.db, "UPDATE vouchers SET is_active=0, deleted_at=NOW() WHERE id=? AND deleted_at IS NULL", [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Voucher not found or already deleted.' });
    const actor = verifiedActor(req, auditActor(req));
    logAudit(req.db, {
      ...actor,
      action: "delete_voucher",
      entity_type: "voucher",
      entity_id: req.params.id,
      details: `Voucher #${req.params.id} deleted; historical order discounts retained`
    });
    res.json({ message: "Voucher deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;

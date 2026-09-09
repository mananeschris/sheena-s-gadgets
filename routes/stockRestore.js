const { logInventoryMovementAsync } = require("./inventoryMovements");
function query(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function parseVariants(value) {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function normalText(value) {
  return String(value || "").trim().toLowerCase();
}

function itemVariantIndex(item, variants) {
  const raw = item.variant_index;
  const index = raw === null || raw === undefined || raw === "" ? null : Number(raw);
  if (Number.isInteger(index) && index >= 0 && index < variants.length) return index;

  const name = normalText(item.variant_name);
  if (!name || name === "default") return null;

  const matched = variants.findIndex(variant => normalText(variant.name) === name);
  return matched >= 0 ? matched : null;
}


async function loadOrderItems(db, order) {
  try {
    const items = await query(db, "SELECT product_id, variant_index, variant_name, quantity FROM order_items WHERE order_id=?", [order.id]);
    if (items.length) return items;
  } catch (error) {
    if (error.code !== "ER_NO_SUCH_TABLE") throw error;
  }

  if (!order.product_id) return [];
  return [{
    product_id: order.product_id,
    variant_index: null,
    variant_name: order.variant_name,
    quantity: order.quantity || 1
  }];
}

async function restoreOrderStockAsync(db, orderId, options = {}) {
  const rows = await query(db, `
    SELECT id, product_id, quantity, variant_name, status, payment_provider, stock_restored_at
    FROM orders
    WHERE id=?
    FOR UPDATE
  `, [orderId]);

  const order = rows[0];
  if (!order) return { restored: false, reason: "order_not_found", restored_quantity: 0 };
  if (order.stock_restored_at) return { restored: false, reason: "already_restored", restored_quantity: 0 };
  if (options.skipDelivered && String(order.status || "") === "delivered") {
    return { restored: false, reason: "delivered_order", restored_quantity: 0 };
  }

  const items = await loadOrderItems(db, order);
  let restoredQuantity = 0;
  const touchedProducts = new Set();

  for (const item of items) {
    const productId = Number(item.product_id);
    const quantity = Number(item.quantity || 0);
    if (!Number.isInteger(productId) || productId <= 0 || !Number.isFinite(quantity) || quantity <= 0) continue;

    const productRows = await query(db, "SELECT id, name, stock, variants FROM products WHERE id=? FOR UPDATE", [productId]);
    const product = productRows[0];
    if (!product) continue;

    const variants = parseVariants(product.variants);
    const variantIndex = itemVariantIndex(item, variants);
    let quantityBefore = Number(product.stock || 0);
    let quantityAfter = quantityBefore + quantity;
    let variantName = item.variant_name || null;

    if (variantIndex !== null) {
      quantityBefore = Number(variants[variantIndex].stock || 0);
      quantityAfter = quantityBefore + quantity;
      variants[variantIndex].stock = quantityAfter;
      variantName = variants[variantIndex].name || variantName || "Selected Variant";
      await query(db, "UPDATE products SET stock=stock+?, variants=? WHERE id=?", [quantity, JSON.stringify(variants), productId]);
    } else {
      await query(db, "UPDATE products SET stock=stock+? WHERE id=?", [quantity, productId]);
    }

    await logInventoryMovementAsync(db, {
      ...(options.actor || { actor_name: "System", actor_role: "system" }),
      product_id: productId,
      product_name: product.name || `Product #${productId}`,
      variant_index: variantIndex,
      variant_name: variantName,
      order_id: orderId,
      movement_type: options.movement_type || "stock_return",
      quantity_change: quantity,
      quantity_before: quantityBefore,
      quantity_after: quantityAfter,
      source: options.source || "order_stock_restore",
      note: options.note || `Stock returned for order #${orderId}`
    });

    restoredQuantity += quantity;
    touchedProducts.add(productId);
  }

  await query(db, "UPDATE orders SET stock_restored_at=NOW() WHERE id=? AND stock_restored_at IS NULL", [orderId]);

  return {
    restored: restoredQuantity > 0,
    restored_quantity: restoredQuantity,
    product_count: touchedProducts.size
  };
}

function restoreOrderStock(db, orderId, options, callback) {
  const done = typeof options === "function" ? options : callback;
  const config = typeof options === "function" ? {} : options || {};

  restoreOrderStockAsync(db, orderId, config)
    .then(result => done(null, result))
    .catch(error => done(error));
}

module.exports = { restoreOrderStock, restoreOrderStockAsync };
const express = require('express');
const { requireAdmin, requireAdminOrStaff, verifiedActor } = require('./roleGuard');
const { logAudit } = require('./auditLogs');
const router = express.Router();
const defaults = ['Phones', 'Tablets', 'Audio', 'Power', 'Chargers', 'Cables', 'Wearables', 'Protection', 'Cases', 'Desk Accessories', 'Cameras', 'Hubs', 'Gaming', 'Bags', 'Accessories'];
const query = (db, sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const schemas = new WeakMap();

function ensureCategorySettings(db) {
  if (!schemas.has(db)) {
    schemas.set(db, query(db, `CREATE TABLE IF NOT EXISTS deleted_product_categories (
      name VARCHAR(80) PRIMARY KEY, deleted_by INT NULL, deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`).catch(error => { schemas.delete(db); throw error; }));
  }
  return schemas.get(db);
}

async function categories(db) {
  await ensureCategorySettings(db);
  const counts = await query(db, "SELECT COALESCE(NULLIF(TRIM(category), ''), 'Accessories') AS name, COUNT(*) AS product_count FROM products GROUP BY COALESCE(NULLIF(TRIM(category), ''), 'Accessories')");
  const deleted = await query(db, 'SELECT name FROM deleted_product_categories');
  const hidden = new Set(deleted.map(row => row.name.toLowerCase()));
  const entries = new Map(defaults.map(name => [name.toLowerCase(), { name, product_count: 0, protected: name === 'Accessories' }]));
  counts.forEach(row => entries.set(row.name.toLowerCase(), { name: entries.get(row.name.toLowerCase())?.name || row.name, product_count: Number(row.product_count), protected: row.name.toLowerCase() === 'accessories' }));
  return [...entries.values()].filter(row => !hidden.has(row.name.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
}

router.get('/', requireAdminOrStaff, async (req, res) => {
  try { res.json(await categories(req.db)); }
  catch { res.status(500).json({ message: 'Unable to load product categories.' }); }
});

router.delete('/:name', requireAdmin, async (req, res) => {
  const name = String(req.params.name || '').trim();
  const replacement = String(req.body?.replacement_category || '').trim();
  if (!name || name.length > 80) return res.status(400).json({ message: 'Invalid category.' });
  if (name.toLowerCase() === 'accessories') return res.status(400).json({ message: 'Accessories is the default category and cannot be deleted.' });
  try {
    const category = (await categories(req.db)).find(row => row.name.toLowerCase() === name.toLowerCase());
    if (!category) return res.status(404).json({ message: 'Category not found.' });
    if (category.product_count && !replacement) return res.status(409).json({ message: 'Move the products to another category before deleting this category.' });
    if (replacement && replacement.toLowerCase() === category.name.toLowerCase()) return res.status(400).json({ message: 'Choose a different destination category.' });
    if (replacement) {
      const destination = (await categories(req.db)).find(row => row.name.toLowerCase() === replacement.toLowerCase());
      if (!destination || destination.name.toLowerCase() === category.name.toLowerCase()) return res.status(400).json({ message: 'Choose an active destination category.' });
    }
    const actor = verifiedActor(req);
    if (replacement) await query(req.db, 'UPDATE products SET category=? WHERE LOWER(TRIM(category))=LOWER(?)', [replacement, category.name]);
    // Recheck usage in the write so a stale product count cannot delete an occupied category.
    const result = await query(req.db, `INSERT IGNORE INTO deleted_product_categories (name, deleted_by)
      SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM products WHERE LOWER(TRIM(category))=LOWER(?))`, [category.name, actor.actor_id, category.name]);
    if (!result.affectedRows) return res.status(409).json({ message: 'Category changed. Refresh categories and try again.' });
    logAudit(req.db, { ...actor, action: 'delete_category', entity_type: 'product_category', entity_id: category.name, details: `${category.name} deleted from the product catalog${replacement ? `; products moved to ${replacement}` : ''}.` });
    res.json({ message: 'Category deleted.', name: category.name, replacement_category: replacement || null });
  } catch { res.status(500).json({ message: 'Unable to delete category.' }); }
});

async function requireActiveCategory(req, res, next) {
  const name = String(req.body.category || 'Accessories').trim().slice(0, 80) || 'Accessories';
  try {
    await ensureCategorySettings(req.db);
    const deleted = await query(req.db, 'SELECT name FROM deleted_product_categories WHERE name=?', [name]);
    if (deleted.length) return res.status(400).json({ message: 'This category was deleted. Select another category.' });
    next();
  } catch { res.status(500).json({ message: 'Unable to verify product category.' }); }
}

module.exports = { router, requireActiveCategory };

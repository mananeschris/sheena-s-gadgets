const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2');
const express = require('express');
const products = require('../routes/products');
const { issueSession } = require('../routes/chatSession');
const query = (db, sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));

test('category deletion persists, protects products and blocks stale product saves', { skip: process.env.RUN_CATEGORY_MYSQL !== '1' }, async t => {
  const database = `category_test_${crypto.randomBytes(8).toString('hex')}`;
  const db = mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3307), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' });
  await query(db, `CREATE DATABASE \`${database}\``);
  t.after(async () => {
    assert.match(database, /^category_test_[a-f0-9]{16}$/);
    await query(db, `DROP DATABASE \`${database}\``);
    await new Promise(resolve => db.end(resolve));
  });
  await query(db, `USE \`${database}\``);
  await query(db, 'CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(255), email VARCHAR(255), role VARCHAR(40))');
  await query(db, "INSERT INTO users VALUES (1,'Admin','admin@example.com','admin'), (2,'Staff','staff@example.com','staff')");
  const cookies = {};
  for (const [id, role] of [[1, 'admin'], [2, 'staff']]) {
    await issueSession({ db, headers: {} }, { clearCookie() {}, cookie(name, value) { cookies[id] = `${name}=${value}`; } }, { id, role }, { adminVerified: role === 'admin' });
  }
  await query(db, 'CREATE TABLE products (id INT PRIMARY KEY, category VARCHAR(80))');
  await query(db, "INSERT INTO products VALUES (1,'Phones')");
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.db = db; next(); });
  app.use('/products', products);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', actor = 1, body) => fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', 'X-Actor-Id': String(actor), Cookie: cookies[actor] }, body: body ? JSON.stringify(body) : undefined });
  const list = await (await request('/products/categories')).json();
  assert.equal(list.find(item => item.name === 'Phones').product_count, 1);
  assert.equal((await request('/products/categories/Phones', 'DELETE')).status, 409);
  assert.equal((await request('/products/categories/Accessories', 'DELETE')).status, 400);
  assert.equal((await request('/products/categories/Audio', 'DELETE', 2)).status, 403);
  assert.equal((await request('/products/categories/Unknown', 'DELETE')).status, 404);
  assert.equal((await request('/products/categories/Audio', 'DELETE')).status, 200);
  assert.equal((await request('/products/categories/Desk%20Accessories', 'DELETE')).status, 200);
  const refreshed = await (await request('/products/categories')).json();
  assert.ok(!refreshed.some(item => item.name === 'Audio' || item.name === 'Desk Accessories'));
  assert.equal((await request('/products/categories/Audio', 'DELETE')).status, 404);
  const stale = await request('/products', 'POST', 1, { name: 'Stale product', category: 'Audio', price: 100, stock: 1 });
  assert.equal(stale.status, 400);
  assert.match((await stale.json()).message, /deleted/);
  assert.equal((await query(db, 'SELECT COUNT(*) AS count FROM products'))[0].count, 1);
  const logs = await query(db, "SELECT actor_role, entity_id FROM audit_logs WHERE action='delete_category'");
  assert.deepEqual(logs.map(item => item.entity_id).sort(), ['Audio', 'Desk Accessories']);
  assert.ok(logs.every(item => item.actor_role === 'admin'));
});

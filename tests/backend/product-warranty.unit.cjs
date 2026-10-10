const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { productWarranty } = require('../../routes/productWarranty');
const router = require('../../routes/products');
const { cookieFor, withSessions } = require('../helpers/session-stub.cjs');

const saved = { id: 42, name: 'Test Product', price: 100, stock: 0, variants: '[]', warranty_eligible: 1, warranty_duration_months: 18, warranty_coverage: 'Manufacturing defects', warranty_exclusions: 'Accidental damage' };

test('default eligibility is off without inventing a warranty for old products', () => {
  assert.deepEqual(productWarranty({}), { warranty_eligible: 0, warranty_duration_months: 0, warranty_coverage: '', warranty_exclusions: '' });
});
test('eligible warranty saves canonical months and trimmed terms', () => {
  assert.deepEqual(productWarranty({ warranty_eligible: '1', warranty_duration_months: '24', warranty_coverage: ' Covered ', warranty_exclusions: ' Excluded ' }), { warranty_eligible: 1, warranty_duration_months: 24, warranty_coverage: 'Covered', warranty_exclusions: 'Excluded' });
});
for (const duration of ['', 0, -1, 1.5, 121, 'invalid', Infinity]) {
  test(`invalid duration ${duration} is rejected`, () => assert.throws(() => productWarranty({ warranty_eligible: 1, warranty_duration_months: duration }), /duration/));
}
test('omitted fields preserve warranty on inventory and legacy updates', () => assert.deepEqual(productWarranty({}, saved), { warranty_eligible: 1, warranty_duration_months: 18, warranty_coverage: saved.warranty_coverage, warranty_exclusions: saved.warranty_exclusions }));
test('partial edits preserve other warranty terms', () => assert.equal(productWarranty({ warranty_coverage: 'Updated' }, saved).warranty_duration_months, 18));
test('explicitly disabling clears obsolete terms and duration', () => assert.deepEqual(productWarranty({ warranty_eligible: '0' }, saved), productWarranty({})));
test('invalid flags and oversized terms are rejected', () => {
  assert.throws(() => productWarranty({ warranty_eligible: 'maybe' }), /eligibility/);
  assert.throws(() => productWarranty({ warranty_eligible: 1, warranty_duration_months: 12, warranty_coverage: 'x'.repeat(2001) }), /2,000/);
});

async function appFixture(t, role = 'admin') {
  let product = { ...saved };
  const mutations = [];
  const db = { query(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    const query = sql.replace(/\s+/g, ' ').trim();
    if (query.startsWith('SELECT id, name, email, role FROM users')) return callback(null, [{ id: 1, role, name: 'Test Admin' }]);
    if (query.startsWith('SHOW COLUMNS')) return callback(null, [{ Field: 'existing' }]);
    if (query.startsWith('SELECT * FROM products')) return callback(null, [product]);
    if (query.startsWith('INSERT INTO products') || query.startsWith('UPDATE products')) {
      mutations.push({ query, params });
      if (query.includes('warranty_eligible')) {
        const [eligible, months, coverage, exclusions] = params.slice(14, 18);
        product = { ...product, warranty_eligible: eligible, warranty_duration_months: months, warranty_coverage: coverage, warranty_exclusions: exclusions };
      }
      return callback(null, { insertId: 42, affectedRows: 1 });
    }
    if (query.includes('FROM products p')) return callback(null, [product]);
    callback(null, { insertId: 1, affectedRows: 1 });
  } };
  withSessions(db, [{ id: 1, role, name: 'Test Admin' }]);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.db = db; next(); });
  app.use('/products', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { mutations, product: () => product, request: (method, body, path = '/products/42') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'x-actor-id': '1', Cookie: cookieFor(1) }, body: method === 'GET' ? undefined : JSON.stringify({ name: 'Test Product', price: 100, stock: 0, ...body }) }) };
}

test('product creation persists warranty fields and GET returns them', async t => {
  const app = await appFixture(t);
  assert.equal((await app.request('POST', { warranty_eligible: 1, warranty_duration_months: 24, warranty_coverage: 'Defects', warranty_exclusions: 'Damage' }, '/products')).status, 200);
  assert.deepEqual(app.mutations[0].params.slice(14, 18), [1, 24, 'Defects', 'Damage']);
  const response = await app.request('GET', {}, '/products');
  assert.equal((await response.json())[0].warranty_duration_months, 24);
});
test('invalid warranty creation performs no product writes', async t => {
  const app = await appFixture(t);
  assert.equal((await app.request('POST', { warranty_eligible: 1, warranty_duration_months: 0 }, '/products')).status, 400);
  assert.equal(app.mutations.length, 0);
});
test('admin stock-only update preserves current warranty', async t => {
  const app = await appFixture(t);
  assert.equal((await app.request('PUT', { inventory_update: '1' })).status, 200);
  assert.deepEqual(app.mutations[0].params.slice(14, 18), [1, 18, saved.warranty_coverage, saved.warranty_exclusions]);
});
test('explicit warranty edits and disabling are saved', async t => {
  const app = await appFixture(t);
  assert.equal((await app.request('PUT', { warranty_eligible: 1, warranty_duration_months: 36 })).status, 200);
  assert.equal(app.product().warranty_duration_months, 36);
  assert.equal((await app.request('PUT', { warranty_eligible: 0 })).status, 200);
  assert.equal(app.product().warranty_duration_months, 0);
  assert.equal(app.product().warranty_coverage, '');
});
test('invalid edit is blocked without changing stored terms', async t => {
  const app = await appFixture(t);
  assert.equal((await app.request('PUT', { warranty_eligible: 1, warranty_duration_months: 1.5 })).status, 400);
  assert.equal(app.mutations.length, 0);
});
test('staff inventory updates cannot change warranty or edit product details', async t => {
  const app = await appFixture(t, 'staff');
  assert.equal((await app.request('PUT', { inventory_update: '1', stock_reason: 'Received supplier delivery', warranty_eligible: 0 })).status, 200);
  assert.equal(app.product().warranty_duration_months, 18);
  assert.equal(app.mutations[0].query.includes('warranty'), false);
  assert.equal((await app.request('PUT', { warranty_duration_months: 1 })).status, 403);
  assert.equal((await app.request('POST', {}, '/products')).status, 403);
});

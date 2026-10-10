const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const soa = require('../routes/soa');
const { cookieFor, withSessions } = require('./helpers/session-stub.cjs');

async function server(t, options = {}) {
  const queries = [];
  const app = express();
  app.use((req, res, next) => {
    req.db = { query(sql, params, callback) {
      queries.push({ sql, params });
      assert.match(sql.trim(), /^SELECT/i);
      if (options.fail && sql.includes('FROM orders o')) return callback(new Error('Database unavailable'));
      if (sql.includes('FROM users WHERE id')) return callback(null, [{ id: params[0], role: Number(params[0]) === 1 ? 'admin' : 'staff' }]);
      if (sql.includes('FROM orders o')) return callback(null, Number(params[0]) === 404 ? [] : [{ id: Number(params[0]), user_id: 7, customer_name: 'Chris', customer_email: 'chris@example.com', product_name: 'NovaCam', product_image: '/assets/hero-iphone-style.png', payment_method: options.offline ? 'cod' : 'installment', payment_status: 'installment_active', total_price: 16000, installment_terms: 3, installment_downpayment: 4000, installment_monthly: 4000, installment_balance: 7000, delivery_contact: '09123456789', status: 'processing' }]);
      if (sql.includes('FROM installment_applications')) return callback(null, options.offline ? [] : [{ id: 61, order_id: params[0], status: 'approved', downpayment_status: 'paid', financed_amount: 12000, preferred_terms: 3, monthly_amount: 4000, downpayment_amount: 4000 }]);
      if (sql.includes('FROM installment_schedules')) return callback(null, [
        { id: 71, order_id: params[0], installment_no: 1, amount_due: 4000, amount_paid: 4000, status: 'paid', due_date: '2020-01-01' },
        { id: 72, order_id: params[0], installment_no: 2, amount_due: 4000, amount_paid: 1000, status: 'partial', due_date: '2020-02-01', payment_reference: 'REFERENCE-72' },
        { id: 73, order_id: params[0], installment_no: 3, amount_due: 4000, amount_paid: 0, status: 'unpaid', due_date: '2099-03-01' }
      ]);
      if (sql.includes('FROM payments')) return callback(null, [{ id: 81, order_id: Number(params[0]), amount_paid: 4000 }, { id: 82, order_id: Number(params[0]), amount_paid: 4000 }, { id: 83, order_id: Number(params[0]), amount_paid: 1000 }]);
      if (sql.includes('FROM order_items')) return callback(null, [{ product_name: 'NovaCam Snapshot', variant_name: 'Black 256GB', quantity: 1, product_image: '/assets/hero-iphone-style.png' }]);
      callback(new Error(`Unexpected query: ${sql}`));
    } };
    withSessions(req.db, [{ id: 1, role: 'admin' }, { id: 2, role: 'staff' }]);
    next();
  });
  app.use('/soa', soa);
  const listener = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => listener.close(resolve)));
  return { url: `http://127.0.0.1:${listener.address().port}`, queries };
}

test('full plan reuses SOA totals, snapshots, references and all schedules', async t => {
  const { url, queries } = await server(t);
  const response = await fetch(`${url}/soa/admin/plan/34?actor_id=1`, { headers: { Cookie: cookieFor(1) } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.statement.total_paid, 9000);
  assert.equal(data.statement.balance, 7000);
  assert.equal(data.statement.overdue_amount, 3000);
  assert.equal(data.statement.schedules.length, 3);
  assert.equal(data.statement.payments.length, 3);
  assert.equal(data.statement.schedules[1].payment_reference, 'REFERENCE-72');
  assert.equal(data.statement.schedules[1].payment_proof_image, null);
  assert.equal(data.plan.items[0].product_name, 'NovaCam Snapshot');
  assert.equal(data.plan.application.order_id, 34);
  assert.equal(data.plan.customer_phone, '09123456789');
  assert(queries.filter(query => /WHERE order_id=\?/.test(query.sql)).every(query => query.params[0] === 34));
});

test('full plan rejects missing actors and non-admin accounts', async t => {
  const { url, queries } = await server(t);
  assert.equal((await fetch(`${url}/soa/admin/plan/34`)).status, 401);
  assert.equal((await fetch(`${url}/soa/admin/plan/34?actor_id=2&actor_role=admin`, { headers: { Cookie: cookieFor(2) } })).status, 403);
  assert.equal((await fetch(`${url}/soa/admin/plan/34?actor_id=2`, { headers: { Cookie: cookieFor(1) } })).status, 401);
  assert(queries.every(query => query.sql.includes('FROM users WHERE id')));
});

test('full plan validates IDs and rejects missing or non-installment orders', async t => {
  const { url } = await server(t, { offline: true });
  assert.equal((await fetch(`${url}/soa/admin/plan/not-an-id?actor_id=1`, { headers: { Cookie: cookieFor(1) } })).status, 400);
  assert.equal((await fetch(`${url}/soa/admin/plan/404?actor_id=1`, { headers: { Cookie: cookieFor(1) } })).status, 404);
  assert.equal((await fetch(`${url}/soa/admin/plan/34?actor_id=1`, { headers: { Cookie: cookieFor(1) } })).status, 404);
});

test('full plan reports a database error without leaking SQL details', async t => {
  const { url } = await server(t, { fail: true });
  const response = await fetch(`${url}/soa/admin/plan/34?actor_id=1`, { headers: { Cookie: cookieFor(1) } });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { message: 'Unable to load the installment plan.' });
});

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { withSessions, cookieFor } = require('./helpers/session-stub.cjs');
const { customerSession, customerIdentity } = require('../routes/customerAccess');

async function setup(t) {
  const writes = [];
  const db = withSessions({ query(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    if (/^\s*(CREATE|ALTER)/i.test(sql)) return callback(null, {});
    if (/SHOW COLUMNS/.test(sql)) return callback(null, [{ Field: 'existing' }]);
    if (/UPDATE|DELETE|INSERT/.test(sql)) { writes.push({ sql, params }); return callback(null, { affectedRows: params.includes(1) ? 1 : 0 }); }
    if (/SELECT user_id FROM orders/.test(sql)) return callback(null, [{ user_id: 1 }]);
    if (/SELECT user_id FROM orders WHERE payment/.test(sql)) return callback(null, [{ user_id: 1 }]);
    if (/SELECT user_id FROM installment/.test(sql)) return callback(null, [{ user_id: 1 }]);
    return callback(null, []);
  } }, [{ id: 1, role: 'customer', name: 'Owner' }, { id: 2, role: 'customer', name: 'Other' }, { id: 9, role: 'admin', name: 'Admin' }]);
  const app = express(); app.use(express.json()); app.use((req, res, next) => { req.db = db; next(); });
  for (const [prefix, name] of [['/auth', 'auth'], ['/orders', 'orders'], ['/payments', 'payments'], ['/customer/addresses', 'customerAddresses'], ['/notifications', 'notifications'], ['/installments', 'installments'], ['/layaways', 'layaways'], ['/reviews', 'reviews'], ['/uploads', 'uploadFiles']]) app.use(prefix, require(`../routes/${name}`));
  app.post('/identity', customerSession, customerIdentity(), (req, res) => res.json(req.body));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { writes, request: (url, method = 'GET', actor, body) => fetch(origin + url, { method, headers: { ...(actor ? { Cookie: cookieFor(actor) } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }) };
}
test('customer routes reject unauthenticated reads and writes before file upload', async t => {
  const { request, writes } = await setup(t);
  for (const [url, method] of [['/auth/profile/1', 'GET'], ['/auth/profile/1', 'PUT'], ['/orders/customer/1', 'GET'], ['/orders', 'POST'], ['/orders/cart', 'POST'], ['/orders/3/cancellation-request', 'POST'], ['/orders/3/repair-request', 'POST'], ['/customer/addresses/1', 'GET'], ['/customer/addresses', 'POST'], ['/customer/addresses/1', 'DELETE'], ['/notifications/customer/1', 'GET'], ['/notifications/1/read', 'PUT'], ['/installments/customer/1', 'GET'], ['/installments/apply', 'POST'], ['/installments/schedules/1/status', 'GET'], ['/layaways/customer/1', 'GET'], ['/layaways/customer', 'POST'], ['/layaways/1/payment-status', 'GET'], ['/payments/gcash/status/3', 'GET'], ['/payments/gcash/retry/3', 'POST'], ['/payments/gcash/3/submit', 'POST'], ['/payments/history/3', 'GET'], ['/reviews', 'POST'], ['/uploads/payments/example.jpg', 'GET'], ['/uploads/order-documents/example.jpg', 'GET']]) {
    assert.equal((await request(url, method)).status, 401, `${method} ${url}`);
  }
  assert.equal(writes.length, 0);
});
test('session identity cannot be forged through account IDs or order IDs', async t => {
  const { request } = await setup(t);
  for (const url of ['/auth/profile/1', '/orders/customer/1', '/customer/addresses/1', '/notifications/customer/1', '/installments/customer/1', '/layaways/customer/1', '/payments/gcash/status/3', '/uploads/payments/example.jpg', '/uploads/order-documents/example.jpg']) assert.equal((await request(url, 'GET', 2)).status, 403, url);
  assert.equal((await request('/identity', 'POST', 1, { user_id: 2 })).status, 403);
  assert.equal((await request('/identity?user_id=2', 'POST', 1, {})).status, 403);
  const response = await request('/identity', 'POST', 1, {});
  assert.deepEqual(await response.json(), { user_id: 1, customer_id: 1 });
  assert.equal((await request('/orders/customer/1', 'GET', 9)).status, 403);
});
test('notification writes include session ownership and private paths cannot traverse directories', async t => {
  const { request, writes } = await setup(t);
  assert.equal((await request('/notifications/123/read', 'PUT', 1)).status, 200);
  assert.match(writes.at(-1).sql, /AND user_id=\?/);
  assert.deepEqual(writes.at(-1).params, ['123', 1]);
  assert.equal((await request('/uploads/order-documents/%2e%2e%2fexample.jpg', 'GET', 1)).status, 404);
  assert.equal((await request('/uploads/payload.html')).status, 404);
});

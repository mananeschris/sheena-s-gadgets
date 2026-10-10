const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { attachOrderDeliveryDetails } = require('../routes/orderDeliveryDetails');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/customer-delivery-status.js'), 'utf8'), context);
const status = context.window.CustomerDeliveryStatus.status;

test('customer status distinguishes readiness from the actual rider delivery', () => {
  assert.equal(status({ status: 'shipped', delivery_status: 'assigned' }), 'shipped');
  assert.equal(status({ status: 'shipped', delivery_status: 'picked_up' }), 'shipped');
  assert.equal(status({ status: 'shipped', delivery_status: 'out_for_delivery' }), 'out_for_delivery');
  assert.equal(status({ status: 'shipped', delivery_status: 'failed_attempt', out_for_delivery_at: '2026-10-09' }), 'out_for_delivery');
  assert.equal(status({ status: 'shipped', delivery_status: 'failed_attempt' }), 'shipped');
  assert.equal(status({ status: 'shipped', delivery_status: 'assigned', out_for_delivery_at: '2026-10-09' }), 'shipped');
  for (const terminal of ['delivered', 'cancelled']) assert.equal(status({ status: terminal, delivery_status: 'out_for_delivery' }), terminal);
});

test('order responses include the most recent assignment without modifying order status', async () => {
  const db = { query(sql, params, callback) {
    assert.match(sql, /ORDER BY id DESC/);
    assert.deepEqual(params, [[1, 2]]);
    callback(null, [
      { order_id: 1, delivery_status: 'assigned', out_for_delivery_at: null },
      { order_id: 1, delivery_status: 'out_for_delivery', out_for_delivery_at: '2026-10-08' },
      { order_id: 2, delivery_status: 'out_for_delivery', out_for_delivery_at: '2026-10-09' }
    ]);
  } };
  const result = await new Promise((resolve, reject) => attachOrderDeliveryDetails(db, [{ id: 1, status: 'shipped' }, { id: 2, status: 'shipped' }], (err, rows) => err ? reject(err) : resolve(rows)));
  assert.equal(result[0].delivery_status, 'assigned');
  assert.equal(result[0].out_for_delivery_at, null);
  assert.equal(result[1].out_for_delivery_at, '2026-10-09');
  assert.equal(result[1].status, 'shipped');
});

test('missing delivery table is compatible with older databases; other errors are not hidden', async () => {
  const db = { query(sql, params, cb) { cb({ code: 'ER_NO_SUCH_TABLE' }); } };
  const result = await new Promise(resolve => attachOrderDeliveryDetails(db, [{ id: 1 }], (err, rows) => { assert.equal(err, null); resolve(rows); }));
  assert.equal(result[0].delivery_status, null);
  db.query = (sql, params, cb) => cb({ code: 'CONNECTION_LOST' });
  await new Promise(resolve => attachOrderDeliveryDetails(db, [{ id: 1 }], err => { assert.equal(err.code, 'CONNECTION_LOST'); resolve(); }));
});

test('empty order response does not query delivery assignments', () => {
  attachOrderDeliveryDetails({ query() { assert.fail('Unexpected query'); } }, [], (err, rows) => {
    assert.equal(err, null); assert.deepEqual(rows, []);
  });
});

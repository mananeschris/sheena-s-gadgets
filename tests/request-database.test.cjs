const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { requestDatabase } = require('../db/requestDatabase');
const call = (db, method, ...args) => new Promise((resolve, reject) => db[method](...args, (error, result) => error ? reject(error) : resolve(result)));
function setup() {
  const connections = [];
  const pool = { config: { connectionConfig: {} }, query(sql, callback) { setImmediate(() => callback(null, 'pool')); }, getConnection(callback) {
    const connection = { released: 0, rollbackCount: 0, beginTransaction(cb) { setImmediate(cb); }, query(sql, cb) { setImmediate(() => cb(null, this)); }, commit(cb) { setImmediate(cb); }, rollback(cb) { this.rollbackCount++; setImmediate(cb); }, release() { this.released++; } };
    connections.push(connection); setImmediate(() => callback(null, connection));
  } };
  return { db: requestDatabase(pool), connections };
}
test('concurrent requests isolate transactions and release on commit or rollback', async () => {
  const { db, connections } = setup();
  const request = method => new Promise((resolve, reject) => db.middleware({}, new EventEmitter(), async () => {
    try { await call(db, 'beginTransaction'); const connection = await call(db, 'query', 'SELECT'); await call(db, method); assert.equal(await call(db, 'query', 'SELECT'), 'pool'); resolve(connection); } catch (error) { reject(error); }
  }));
  const [first, second] = await Promise.all([request('commit'), request('rollback')]);
  assert.notEqual(first, second);
  assert.equal(connections.length, 2);
  assert.deepEqual(connections.map(c => c.released), [1, 1]);
});
test('unfinished request rolls back its connection instead of leaking a transaction', async () => {
  const { db, connections } = setup(); const response = new EventEmitter();
  await new Promise((resolve, reject) => db.middleware({}, response, async () => { try { await call(db, 'beginTransaction'); response.emit('close'); setImmediate(resolve); } catch (error) { reject(error); } }));
  assert.equal(connections[0].rollbackCount, 1); assert.equal(connections[0].released, 1);
  await assert.rejects(call(db, 'beginTransaction'), /context/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const crypto = require('crypto');
const chat = require('../routes/deliveryChat');
const { issueSession, revokeSession } = require('../routes/chatSession');
const clientId = '11111111-1111-4111-8111-111111111111';
const token = 'a'.repeat(64);
const thread = { id: 10, order_id: 34, assignment_id: 5, generation: 2, customer_id: 101, rider_id: 201, can_send: 1, is_current: 1, delivery_status: 'assigned', product_name: 'Phone' };

async function setup(t, options = {}) {
  const queries = [], messages = [];
  const user = { id: options.userId || 101, role: options.role || 'customer', name: 'Test account' };
  const db = { query(sql, params, callback) {
    queries.push({ sql, params });
    if (/^(CREATE|ALTER)/.test(sql.trim())) return callback(null, {});
    if (sql.startsWith('SHOW COLUMNS')) return callback(null, [{ Field: params[0] }]);
    if (sql.includes('FROM delivery_chat_sessions s')) {
      assert.equal(params[0], crypto.createHash('sha256').update(token).digest('hex'));
      return callback(null, options.expired ? [] : [user]);
    }
    if (sql.includes('INSERT IGNORE INTO delivery_chat_threads')) return callback(null, { affectedRows: 1 });
    if (sql.startsWith('SELECT t.id')) {
      const visible = user.id === 101 || user.id === 201 && !options.reassigned;
      if (sql.includes('WHERE t.id=?')) return callback(null, visible && params[0] === 10 ? [{ ...thread, can_send: options.closed ? 0 : 1 }] : []);
      return callback(null, visible ? [thread] : []);
    }
    if (sql.startsWith('SELECT COUNT')) return callback(null, [{ count: options.rateLimited ? 30 : 0 }]);
    if (sql.includes('SUM(m.sender_id')) return callback(null, []);
    if (sql.includes('client_id=?')) return callback(null, messages.filter(item => item.thread_id === params[0] && item.sender_id === params[1] && item.client_id === params[2]));
    if (sql.includes('INSERT IGNORE INTO delivery_chat_messages')) {
      assert.match(sql, /t\.generation=da\.chat_generation/);
      assert.match(sql, /o\.status NOT IN \('delivered','cancelled'\)/);
      assert.match(sql, user.role === 'rider' ? /t\.rider_id=\?/ : /t\.customer_id=\?/);
      if (options.race) return callback(null, { affectedRows: 0 });
      messages.push({ id: 1, sender_id: params[0], client_id: params[1], body: params[2], thread_id: params[3], created_at: '2026-10-09' });
      return callback(null, { affectedRows: 1 });
    }
    if (sql.includes('MAX(id) AS peer_read_id')) return callback(null, [{ peer_read_id: 0 }]);
    if (sql.startsWith('SELECT id, sender_id')) return callback(null, options.paged ? Array.from({ length: 101 }, (_, index) => ({ id: 101 - index, body: 'Message', sender_id: 201 })) : messages);
    if (sql.startsWith('UPDATE delivery_chat_messages')) return callback(null, { affectedRows: 1 });
    callback(new Error('Unexpected SQL: ' + sql));
  } };
  const app = express(); app.use(express.json()); app.use((req, res, next) => { req.db = db; next(); }); app.use('/delivery-chat', chat);
  const instance = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => instance.close(resolve)));
  const url = `http://127.0.0.1:${instance.address().port}/delivery-chat`;
  const headers = { Cookie: `delivery_session=${token}`, 'X-Chat-User': String(user.id), 'Content-Type': 'application/json' };
  const send = (path, body, overrides = {}) => fetch(url + path, { method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify(body) });
  return { url, headers, queries, messages, send };
}

test('chat rejects forged actor IDs without an authenticated session', async t => {
  const { url, queries } = await setup(t);
  const response = await fetch(url + '/threads?actor_id=101&actor_role=customer', { headers: { 'X-Chat-User': '101' } });
  assert.equal(response.status, 401); assert.equal(queries.length, 0);
});
test('chat rejects expired sessions and account mismatches', async t => {
  const expired = await setup(t, { expired: true });
  assert.equal((await fetch(expired.url + '/threads', { headers: expired.headers })).status, 401);
  const valid = await setup(t);
  assert.equal((await fetch(valid.url + '/threads', { headers: { ...valid.headers, 'X-Chat-User': '201' } })).status, 401);
});
test('chat rejects staff and cross-origin writes', async t => {
  const staff = await setup(t, { role: 'staff' });
  assert.equal((await fetch(staff.url + '/threads', { headers: staff.headers })).status, 403);
  const current = await setup(t);
  assert.equal((await current.send('/threads/10/messages', { body: 'Hello', client_id: clientId }, { Origin: 'https://untrusted.example' })).status, 403);
});
test('another customer and the previous rider cannot read the thread', async t => {
  const other = await setup(t, { userId: 999 });
  assert.equal((await fetch(other.url + '/threads/10/messages', { headers: other.headers })).status, 404);
  const rider = await setup(t, { userId: 201, role: 'rider', reassigned: true });
  assert.equal((await fetch(rider.url + '/threads/10/messages', { headers: rider.headers })).status, 404);
  assert(rider.queries.some(item => /t\.rider_id=\? AND t\.generation=da\.chat_generation/.test(item.sql)));
});
test('customer thread list scopes ownership and assignment generations', async t => {
  const { url, headers, queries } = await setup(t);
  const response = await fetch(url + '/threads', { headers });
  assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.threads.length, 1); assert.equal(data.unread_count, 0);
  assert(queries.some(item => /WHERE t\.customer_id=\? AND o\.user_id=t\.customer_id/.test(item.sql)));
  assert(queries.some(item => /INSERT IGNORE INTO delivery_chat_threads/.test(item.sql) && /da\.chat_generation/.test(item.sql)));
});
test('sends use verified sender, plain text and idempotent client IDs', async t => {
  const { send, messages } = await setup(t);
  const payload = { body: '  <img src=x onerror=alert(1)>  ', client_id: clientId, sender_id: 201 };
  assert.equal((await send('/threads/10/messages', payload)).status, 201);
  assert.equal((await send('/threads/10/messages', payload)).status, 200);
  assert.equal(messages.length, 1); assert.equal(messages[0].sender_id, 101); assert.equal(messages[0].body, payload.body.trim());
});
test('closed delivery history is readable but not writable', async t => {
  const { send, url, headers } = await setup(t, { closed: true });
  assert.equal((await fetch(url + '/threads/10/messages', { headers })).status, 200);
  assert.equal((await send('/threads/10/messages', { body: 'Hello', client_id: clientId })).status, 409);
});
test('rider reassignment or completion during send prevents insertion', async t => {
  const { send, messages } = await setup(t, { race: true });
  assert.equal((await send('/threads/10/messages', { body: 'Hello', client_id: clientId })).status, 409);
  assert.equal(messages.length, 0);
});
test('invalid bodies, IDs, cursors and rate limit are rejected', async t => {
  const { send, url, headers } = await setup(t, { rateLimited: true });
  assert.equal((await send('/threads/10/messages', { body: ' ', client_id: clientId })).status, 400);
  assert.equal((await send('/threads/10/messages', { body: 'x'.repeat(1001), client_id: clientId })).status, 400);
  assert.equal((await send('/threads/10/messages', { body: 'Hello', client_id: 'wrong' })).status, 400);
  assert.equal((await send('/threads/10/messages', { body: 'Hello', client_id: clientId })).status, 429);
  assert.equal((await fetch(url + '/threads/wrong/messages', { headers })).status, 400);
  assert.equal((await fetch(url + '/threads/10/messages?after_id=-1', { headers })).status, 400);
});
test('history pagination returns chronological latest 100 messages', async t => {
  const { url, headers } = await setup(t, { paged: true });
  const data = await (await fetch(url + '/threads/10/messages', { headers })).json();
  assert.equal(data.messages.length, 100); assert.equal(data.messages[0].id, 2); assert.equal(data.messages.at(-1).id, 101); assert.equal(data.has_more, true);
});
test('read receipts affect only visible received messages through the cursor', async t => {
  const { send, queries } = await setup(t);
  assert.equal((await send('/threads/10/read', { last_id: 30 })).status, 200);
  const update = queries.find(item => item.sql.startsWith('UPDATE delivery_chat_messages'));
  assert.match(update.sql, /m\.sender_id<>\? AND m\.id<=\?/); assert.deepEqual(update.params, [10, 101, 101, 30]);
});
test('session issuance stores only hashes, rotates old token and revokes on logout', async () => {
  const queries = [], cookies = [];
  const req = { secure: false, headers: { cookie: `delivery_session=${token}` }, db: { query(sql, params, done) { queries.push({ sql, params }); done(null, {}); } } };
  const res = { cookie(name, value, options) { cookies.push({ name, value, options }); }, clearCookie() {} };
  await issueSession(req, res, { id: 101 });
  assert.equal(cookies[0].options.httpOnly, true); assert.equal(cookies[0].options.sameSite, 'strict');
  const insert = queries.find(item => item.sql.startsWith('INSERT')); assert.notEqual(insert.params[0], cookies[0].value); assert.equal(insert.params[1], 101);
  assert(queries.some(item => item.sql.startsWith('DELETE')));
  req.headers.cookie = `delivery_session=${cookies[0].value}`;
  await revokeSession(req, res);
  assert.equal(queries.at(-1).params[0], insert.params[0]);
});

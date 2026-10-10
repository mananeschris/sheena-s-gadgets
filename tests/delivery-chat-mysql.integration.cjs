const test = require('node:test');
const assert = require('node:assert/strict');
const mysql = require('mysql2');
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const chat = require('../routes/deliveryChat');
const auth = require('../routes/auth');
const bcrypt = require('bcrypt');
const { query, ensureSessionTable } = require('../routes/chatSession');

test('MySQL chat persists messages and enforces reassignment/closed-delivery rules', { skip: process.env.RUN_CHAT_MYSQL !== '1' }, async t => {
  const env = {};
  const file = path.join(__dirname, '..', '.env');
  if (fs.existsSync(file)) for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim(), split = trimmed.indexOf('=');
    if (split > 0 && !trimmed.startsWith('#')) env[trimmed.slice(0, split).trim()] = trimmed.slice(split + 1).trim().replace(/^["']|["']$/g, '');
  }
  const database = `chat_test_${crypto.randomBytes(8).toString('hex')}`;
  const db = mysql.createConnection({ host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3307), user: env.DB_USER || 'root', password: env.DB_PASSWORD || '' });
  await query(db, `CREATE DATABASE \`${database}\``);
  t.after(async () => {
    // Only this test's newly created database is eligible for teardown.
    assert.match(database, /^chat_test_[a-f0-9]{16}$/);
    await query(db, `DROP DATABASE \`${database}\``);
    await new Promise(resolve => db.end(resolve));
  });
  await query(db, `USE \`${database}\``);
  await query(db, 'CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(255), role VARCHAR(40), email VARCHAR(255), password VARCHAR(255))');
  await query(db, 'CREATE TABLE products (id INT PRIMARY KEY, name VARCHAR(255), image VARCHAR(255))');
  await query(db, 'CREATE TABLE orders (id INT PRIMARY KEY, user_id INT, product_id INT, status VARCHAR(40))');
  await query(db, 'CREATE TABLE order_items (id INT PRIMARY KEY, order_id INT, product_name VARCHAR(255), product_image VARCHAR(255))');
  await chat.ensureChatSchema(db); await ensureSessionTable(db);
  await query(db, "INSERT INTO users (id,name,role) VALUES (101,'Customer','customer'),(102,'Other Customer','customer'),(201,'Rider One','rider'),(202,'Rider Two','rider')");
  await query(db, 'UPDATE users SET email=?,password=? WHERE id=101', ['fixture@example.com', await bcrypt.hash('StrongTest1!', 4)]);
  await query(db, "INSERT INTO products VALUES (28,'Phone','/assets/hero-iphone-style.png')");
  await query(db, "INSERT INTO orders VALUES (34,101,28,'processing')");
  await query(db, "INSERT INTO order_items VALUES (1,34,'Phone Snapshot','/assets/hero-iphone-style.png')");
  await query(db, "INSERT INTO delivery_assignments (id,order_id,rider_id,status) VALUES (5,34,201,'assigned')");
  const tokens = new Map();
  for (const id of [101, 102, 201, 202]) {
    const token = crypto.randomBytes(32).toString('hex'); tokens.set(id, token);
    await query(db, 'INSERT INTO delivery_chat_sessions VALUES (?,?,DATE_ADD(NOW(),INTERVAL 1 DAY))', [crypto.createHash('sha256').update(token).digest('hex'), id]);
  }
  const app = express(); app.use(express.json()); app.use((req, res, next) => { req.db = db; next(); }); app.use('/delivery-chat', chat); app.use('/auth', auth);
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/delivery-chat`;
  const request = (id, endpoint, body) => fetch(url + endpoint, { method: body ? 'POST' : 'GET', headers: { Cookie: `delivery_session=${tokens.get(id)}`, 'X-Chat-User': String(id), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const first = await (await request(101, '/threads')).json();
  assert.equal(first.threads.length, 1); assert.equal(first.threads[0].product_name, 'Phone Snapshot');
  const threadId = first.threads[0].id;
  const payload = { body: 'Near the barangay hall.', client_id: crypto.randomUUID() };
  const sent = await request(101, `/threads/${threadId}/messages`, payload); assert.equal(sent.status, 201);
  const message = (await sent.json()).message;
  assert.equal((await request(101, `/threads/${threadId}/messages`, payload)).status, 200);
  assert.equal((await request(102, `/threads/${threadId}/messages`)).status, 404);
  const riderInbox = await (await request(201, '/threads')).json(); assert.equal(riderInbox.unread_count, 1);
  assert.equal((await request(201, `/threads/${threadId}/read`, { last_id: message.id })).status, 200);
  const history = await (await request(101, `/threads/${threadId}/messages`)).json(); assert.equal(history.peer_read_id, message.id);
  // Match the admin assignment update: close old chat by incrementing the generation.
  await query(db, 'UPDATE delivery_assignments SET rider_id=202,chat_generation=chat_generation+1 WHERE id=5');
  assert.equal((await request(201, `/threads/${threadId}/messages`)).status, 404);
  assert.equal((await request(202, `/threads/${threadId}/messages`)).status, 404);
  const customerInbox = await (await request(101, '/threads')).json();
  assert.equal(customerInbox.threads.length, 2);
  assert.equal(customerInbox.threads.find(item => item.id === threadId).can_send, false);
  assert.equal((await request(101, `/threads/${threadId}/messages`, { body: 'Old chat', client_id: crypto.randomUUID() })).status, 409);
  const nextId = customerInbox.threads.find(item => item.is_current).id;
  const newReply = await request(202, `/threads/${nextId}/messages`, { body: 'I am the new rider.', client_id: crypto.randomUUID() }); assert.equal(newReply.status, 201);
  await query(db, "UPDATE orders SET status='delivered' WHERE id=34");
  const closed = await request(101, `/threads/${nextId}/messages`, { body: 'Closed chat', client_id: crypto.randomUUID() }); assert.equal(closed.status, 409);
  const count = await query(db, 'SELECT COUNT(*) AS count FROM delivery_chat_messages'); assert.equal(count[0].count, 2);
  const authPost = (endpoint, body, cookie) => fetch(url.replace('/delivery-chat', '/auth') + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  const wrong = await authPost('/login', { email: 'fixture@example.com', password: 'wrong' }); assert.equal(wrong.status, 400); assert.equal(wrong.headers.get('set-cookie'), null);
  const login = await authPost('/login', { email: 'fixture@example.com', password: 'StrongTest1!' }); assert.equal(login.status, 200);
  const loginCookie = login.headers.get('set-cookie'); assert.match(loginCookie, /HttpOnly/); assert.match(loginCookie, /SameSite=Strict/);
  const cookie = loginCookie.match(/delivery_session=([a-f0-9]{64})/)[0];
  assert.equal((await fetch(url + '/threads', { headers: { Cookie: cookie, 'X-Chat-User': '101' } })).status, 200);
  await authPost('/logout', {}, cookie);
  assert.equal((await fetch(url + '/threads', { headers: { Cookie: cookie, 'X-Chat-User': '101' } })).status, 401);
  await query(db, 'UPDATE users SET email_2fa_enabled=1,email_2fa_code_hash=?,email_2fa_expires_at=DATE_ADD(NOW(),INTERVAL 10 MINUTE) WHERE id=101', [await bcrypt.hash('123456', 4)]);
  const wrongCode = await authPost('/verify-two-factor', { email: 'fixture@example.com', code: '000000' }); assert.equal(wrongCode.status, 400); assert.equal(wrongCode.headers.get('set-cookie'), null);
  const verified = await authPost('/verify-two-factor', { email: 'fixture@example.com', code: '123456' }); assert.equal(verified.status, 200); assert.match(verified.headers.get('set-cookie'), /delivery_session=[a-f0-9]{64}/);
});

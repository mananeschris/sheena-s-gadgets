const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const express = require('express');
const recovery = require('../routes/passwordRecovery');
const { query, ensureSessionTable } = require('../routes/chatSession');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

test('password recovery persists securely without changing live accounts', { skip: process.env.RUN_RECOVERY_MYSQL !== '1' }, async t => {
  const database = `recovery_test_${crypto.randomBytes(8).toString('hex')}`;
  const db = mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3307), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' });
  await query(db, `CREATE DATABASE \`${database}\``);
  t.after(async () => {
    assert.match(database, /^recovery_test_[a-f0-9]{16}$/);
    await query(db, `DROP DATABASE \`${database}\``);
    await new Promise(resolve => db.end(resolve));
  });
  await query(db, `USE \`${database}\``);
  await query(db, `CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(255), email VARCHAR(255), password VARCHAR(255),
    email_verified TINYINT, email_2fa_enabled TINYINT, email_2fa_code_hash VARCHAR(255), email_2fa_expires_at DATETIME, email_2fa_attempts INT, role VARCHAR(40)) ENGINE=InnoDB`);
  const oldHash = await bcrypt.hash('OldPassword1!', 10);
  await query(db, "INSERT INTO users VALUES (1,'Test Customer','customer@example.com',?,1,1,'pending-code',DATE_ADD(NOW(), INTERVAL 10 MINUTE),2,'customer')", [oldHash]);
  await ensureSessionTable(db);
  await query(db, "INSERT INTO delivery_chat_sessions VALUES (?,1,DATE_ADD(NOW(),INTERVAL 7 DAY)), (?,1,DATE_ADD(NOW(),INTERVAL 7 DAY))", [hash('session1'), hash('session2')]);
  const originalBase = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = 'https://shop.example.com';
  t.after(() => { if (originalBase === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = originalBase; });
  const emails = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.db = db; next(); });
  app.use('/auth', recovery({
    sendEmail: async (user, url) => { emails.push({ user, url }); },
    ensureTwoFactorColumns: async () => {},
    isValidPassword: password => /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/.test(password)
  }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) => fetch(origin + '/auth/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

  assert.equal((await post('forgot-password', { email: 'not-email' })).status, 400);
  assert.equal((await post('forgot-password', { email: 'customer@example.com' }, { Origin: 'https://attacker.example' })).status, 403);
  const known = await post('forgot-password', { email: ' Customer@Example.com ' });
  assert.equal(known.status, 200);
  assert.equal(known.headers.get('cache-control'), 'no-store');
  const knownBody = await known.json();
  const unknown = await post('forgot-password', { email: 'unknown@example.com' });
  assert.deepEqual(await unknown.json(), knownBody);
  assert.equal(emails.length, 1);
  const url = new URL(emails[0].url);
  assert.equal(url.origin, 'https://shop.example.com');
  assert.equal(url.pathname, '/auth.html');
  const token = url.searchParams.get('token');
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(knownBody).includes(token));
  const saved = (await query(db, 'SELECT token_hash,TIMESTAMPDIFF(SECOND,NOW(),expires_at) AS remaining FROM account_password_resets'))[0];
  assert.equal(saved.token_hash, hash(token));
  assert.notEqual(saved.token_hash, token);
  assert.ok(saved.remaining >= 890 && saved.remaining <= 900);
  await post('forgot-password', { email: 'customer@example.com' });
  assert.equal(emails.length, 1, 'cooldown prevents extra email');
  assert.equal((await post('reset-password', { token: 'invalid', password: 'NewPassword1!' })).status, 400);
  assert.equal((await post('reset-password', { token, password: 'weak' })).status, 400);
  assert.equal((await query(db, 'SELECT password FROM users'))[0].password, oldHash);
  const reset = await post('reset-password', { token, password: 'NewPassword1!' });
  assert.equal(reset.status, 200, JSON.stringify(await reset.json()));
  const user = (await query(db, 'SELECT * FROM users'))[0];
  assert.equal(await bcrypt.compare('NewPassword1!', user.password), true);
  assert.equal(user.email_verified, 1);
  assert.equal(user.email_2fa_enabled, 1);
  assert.equal(user.email_2fa_code_hash, null);
  assert.equal(user.email_2fa_attempts, 0);
  assert.equal((await query(db, 'SELECT COUNT(*) AS count FROM delivery_chat_sessions WHERE expires_at>NOW()'))[0].count, 0);
  assert.equal((await query(db, 'SELECT token_hash FROM account_password_resets'))[0].token_hash, null);
  assert.equal((await post('reset-password', { token, password: 'AnotherPassword1!' })).status, 400);

  const expired = crypto.randomBytes(32).toString('hex');
  await query(db, 'UPDATE account_password_resets SET token_hash=?,expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND)', [hash(expired)]);
  assert.equal((await post('reset-password', { token: expired, password: 'AnotherPassword1!' })).status, 400);
  assert.equal((await query(db, 'SELECT password FROM users'))[0].password, user.password);

  // Only one simultaneous reset may consume the same token.
  const concurrent = crypto.randomBytes(32).toString('hex');
  await query(db, 'UPDATE account_password_resets SET token_hash=?,expires_at=DATE_ADD(NOW(),INTERVAL 15 MINUTE)', [hash(concurrent)]);
  const first = post('reset-password', { token: concurrent, password: 'ConcurrentPassword1!' });
  const second = post('reset-password', { token: concurrent, password: 'ConcurrentPassword2!' });
  const responses = [await first, await second];
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);

  await query(db, 'UPDATE account_password_resets SET created_at=DATE_SUB(NOW(),INTERVAL 61 SECOND)');
  await post('forgot-password', { email: 'customer@example.com' });
  assert.equal(emails.length, 2, 'new link available after cooldown');
  for (let attempt = 0; attempt < 10; attempt++) await post('forgot-password', { email: 'limited@example.com' });
  assert.equal((await post('forgot-password', { email: 'limited@example.com' })).status, 429);
});

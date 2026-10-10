const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2');
const express = require('express');
const bcrypt = require('bcrypt');
const auth = require('../routes/auth');
const { query, issueSession } = require('../routes/chatSession');
const { requireAdmin, requireAdminOrStaff } = require('../routes/roleGuard');
const { requireRecentAdmin } = require('../routes/adminSessions');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

test('admin security with isolated MySQL and mocked email provider', { skip: process.env.RUN_ADMIN_SECURITY_MYSQL !== '1' }, async t => {
  const database = `admin_security_test_${crypto.randomBytes(8).toString('hex')}`;
  const db = mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3307), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' });
  await query(db, `CREATE DATABASE \`${database}\``);
  t.after(async () => {
    assert.match(database, /^admin_security_test_[a-f0-9]{16}$/);
    await query(db, `DROP DATABASE \`${database}\``);
    await new Promise(resolve => db.end(resolve));
  });
  await query(db, `USE \`${database}\``);
  await query(db, `CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(255),email VARCHAR(255),password VARCHAR(255),role VARCHAR(40),
    birthday DATE,phone VARCHAR(50),gender VARCHAR(40),address TEXT,city VARCHAR(255),province VARCHAR(255),postal_code VARCHAR(30)) ENGINE=InnoDB`);
  const password = 'AdminPassword1!';
  await query(db, "INSERT INTO users (id,name,email,password,role) VALUES (1,'Admin','admin@example.com',?,'admin'),(2,'Staff','staff@example.com',?,'staff'),(3,'Customer','customer@example.com',?,'customer')", Array(3).fill(await bcrypt.hash(password, 10)));
  const keys = ['EMAIL_PROVIDER', 'BREVO_API_KEY', 'EMAIL_FROM_ADDRESS', 'APP_BASE_URL'];
  const originalEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'mock-key-not-a-real-key', EMAIL_FROM_ADDRESS: 'sender@example.com', APP_BASE_URL: 'https://shop.example.com' });
  const originalFetch = global.fetch;
  const emails = [];
  let deliveryFails = false;
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.brevo.com/')) {
      if (deliveryFails) return new Response('Unavailable', { status: 503 });
      emails.push(JSON.parse(options.body)); return new Response('{}', { status: 201 });
    }
    if (String(url).startsWith('https://')) throw new Error('Unexpected outbound request blocked by test');
    return originalFetch(url, options);
  };
  t.after(() => {
    global.fetch = originalFetch;
    for (const key of keys) { if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key]; }
  });
  const app = express();
  app.use(express.json()); app.use((req, res, next) => { req.db = db; next(); });
  app.use('/auth', auth);
  app.get('/protected', requireAdmin, (req,res) => res.json({ user: req.actorUser }));
  app.get('/store', requireAdminOrStaff, (req,res) => res.json({ user: req.actorUser }));
  app.post('/sensitive', requireAdmin, requireRecentAdmin, (req,res) => res.json({ message: 'Allowed' }));
  app.use('/admin/staff', require('../routes/staff'));
  app.use('/admin/audit-logs', require('../routes/auditLogs'));
  app.use('/dashboard', require('../routes/dashboard'));
  app.use('/products', require('../routes/products'));
  app.use('/orders', require('../routes/orders'));
  const server = await new Promise(resolve => { const instance = app.listen(0,'127.0.0.1',() => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  function remember(response, cookies = jar) {
    for (const cookie of response.headers.getSetCookie()) {
      const [name, value] = cookie.split(';')[0].split('=');
      if (value) cookies[name] = value; else delete cookies[name];
    }
  }
  const request = (path, method = 'GET', body, cookies = jar, headers = {}) => originalFetch(origin + path, { method,
    headers: { 'Content-Type': 'application/json', Cookie: Object.entries(cookies).map(([key,value]) => `${key}=${value}`).join('; '), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const code = () => emails.filter(email => email.subject === 'Your sign-in security code').at(-1).textContent.match(/code is (\d{6})/)[1];
  async function signin(cookies = jar, credential = password) {
    const login = await request('/auth/login', 'POST', { email: 'admin@example.com', password: credential }, cookies);
    assert.equal(login.status, 200, await login.clone().text()); remember(login, cookies);
    const verify = await request('/auth/admin/verify-login', 'POST', { email: 'admin@example.com', code: code() }, cookies);
    assert.equal(verify.status, 200, await verify.clone().text()); remember(verify, cookies);
  }

  await t.test('forged actor IDs cannot access admin reads, writes, metrics or uploads', async () => {
    assert.equal((await request('/protected?actor_id=1')).status, 401);
    assert.equal((await request('/admin/staff?actor_id=1')).status, 401);
    assert.equal((await request('/dashboard/sales?actor_id=1')).status, 401);
    assert.equal((await request('/orders?actor_id=1')).status, 401);
    assert.equal((await request('/products', 'POST', { actor_id: 1, name: 'Forged' })).status, 401);
    assert.equal((await request('/orders/cart', 'POST', { source: 'pos', actor_id: 1, items: [] })).status, 401);
  });
  await t.test('admin password alone grants no session, codes require the issuing browser', async () => {
    const login = await request('/auth/login', 'POST', { email: 'admin@example.com', password });
    assert.equal(login.status, 200); const body = await login.json();
    assert.equal(body.requires_admin_verification, true); assert.equal(body.user, undefined); assert.equal(body.dev_code, undefined);
    remember(login);
    assert.equal(jar.delivery_session, undefined);
    assert.equal((await request('/protected')).status, 401);
    assert.equal((await request('/auth/admin/verify-login', 'POST', { email: 'admin@example.com', code: code() }, {})).status, 400);
    assert.equal((await request('/auth/admin/verify-login', 'POST', { code: '000000' })).status, 400);
    const verify = await request('/auth/admin/verify-login', 'POST', { email: 'admin@example.com', code: code() });
    assert.equal(verify.status, 200, await verify.clone().text());
    const sessionCookie = verify.headers.getSetCookie().find(value => /^delivery_session=[a-f0-9]/.test(value));
    assert.match(sessionCookie, /HttpOnly/i); assert.match(sessionCookie, /SameSite=Strict/i);
    const oldChallenge = { ...jar }; remember(verify);
    assert.equal((await request('/protected')).status, 200);
    assert.equal((await request('/auth/admin/verify-login', 'POST', { code: code() }, oldChallenge)).status, 400);
    assert.equal((await request('/protected?actor_id=2')).status, 401);
    assert.equal((await request('/protected', 'GET', undefined, jar, { 'X-Actor-Id': '2' })).status, 401);
  });
  await t.test('staff retains store access but cannot impersonate admin', async () => {
    const staff = {};
    await issueSession({ db, headers: {} }, { clearCookie() {}, cookie(name,value) { staff[name] = value; } }, { id: 2, role: 'staff' });
    assert.equal((await request('/store?actor_id=2', 'GET', undefined, staff)).status, 200);
    assert.equal((await request('/protected?actor_id=1&actor_role=admin', 'GET', undefined, staff)).status, 403);
    const customer = {};
    await issueSession({ db, headers: {} }, { clearCookie() {}, cookie(name,value) { customer[name] = value; } }, { id: 3, role: 'customer' });
    assert.equal((await request('/store?actor_id=1', 'GET', undefined, customer)).status, 403);
  });
  await t.test('cross-origin writes are blocked and audit entries cannot be forged', async () => {
    assert.equal((await request('/sensitive', 'POST', {}, jar, { Origin: 'https://attacker.example' })).status, 403);
    assert.equal((await request('/sensitive', 'POST', {}, jar, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await request('/admin/audit-logs', 'POST', { action: 'login_success', actor_id: 1 })).status, 405);
  });
  await t.test('sensitive actions require recent password and session-bound email verification', async () => {
    const sessionHash = hash(jar.delivery_session);
    await query(db, 'UPDATE delivery_chat_sessions SET reauth_at=DATE_SUB(NOW(),INTERVAL 6 MINUTE) WHERE token_hash=?', [sessionHash]);
    assert.equal((await request('/sensitive', 'POST', {})).status, 428);
    assert.equal((await request('/admin/staff', 'POST', { name: 'New Staff', email: 'new@example.com', password })).status, 428);
    assert.equal((await request('/auth/admin/reauth/start', 'POST', { password: 'wrong' })).status, 400);
    const start = await request('/auth/admin/reauth/start', 'POST', { password });
    assert.equal(start.status, 200); remember(start);
    const stolen = { admin_challenge: jar.admin_challenge };
    assert.equal((await request('/auth/admin/reauth/verify', 'POST', { code: code() }, stolen)).status, 401);
    const verified = await request('/auth/admin/reauth/verify', 'POST', { code: code() });
    assert.equal(verified.status, 200, await verified.clone().text()); remember(verified);
    assert.equal((await request('/sensitive', 'POST', {})).status, 200);
  });
  await t.test('polling never extends idle time, activity does, and idle/max/legacy sessions are rejected', async () => {
    const sessionHash = hash(jar.delivery_session);
    await query(db, 'UPDATE delivery_chat_sessions SET last_activity_at=DATE_SUB(NOW(),INTERVAL 14 MINUTE) WHERE token_hash=?', [sessionHash]);
    const before = (await query(db, 'SELECT last_activity_at FROM delivery_chat_sessions WHERE token_hash=?', [sessionHash]))[0].last_activity_at;
    assert.equal((await request('/auth/session')).status, 200);
    const after = (await query(db, 'SELECT last_activity_at FROM delivery_chat_sessions WHERE token_hash=?', [sessionHash]))[0].last_activity_at;
    assert.equal(before.getTime(), after.getTime());
    assert.equal((await request('/auth/session/activity', 'POST', {})).status, 200);
    await query(db, 'UPDATE delivery_chat_sessions SET last_activity_at=DATE_SUB(NOW(),INTERVAL 16 MINUTE) WHERE token_hash=?', [sessionHash]);
    assert.equal((await request('/protected')).status, 401);
    await query(db, 'UPDATE delivery_chat_sessions SET last_activity_at=NOW(),created_at=DATE_SUB(NOW(),INTERVAL 9 HOUR) WHERE token_hash=?', [sessionHash]);
    assert.equal((await request('/protected')).status, 401);
    await query(db, 'UPDATE delivery_chat_sessions SET created_at=NOW(),admin_verified_at=NULL WHERE token_hash=?', [sessionHash]);
    assert.equal((await request('/protected')).status, 401);
    await signin();
  });
  await t.test('other sessions can be revoked and password changes invalidate sessions and challenges', async () => {
    const other = {}; await signin(other);
    const response = await request('/auth/admin/sessions/revoke', 'POST', {});
    assert.equal(response.status, 200);
    assert.equal((await request('/protected', 'GET', undefined, other)).status, 401);
    const pending = {}; const login = await request('/auth/login', 'POST', { email: 'admin@example.com', password }, pending); remember(login, pending);
    const newPassword = 'UpdatedAdminPassword1!';
    const changed = await request('/auth/admin/password', 'POST', { password: newPassword });
    assert.equal(changed.status, 200, await changed.clone().text());
    const old = { ...jar }; remember(changed);
    assert.equal((await request('/protected', 'GET', undefined, old)).status, 401);
    assert.equal((await request('/protected')).status, 200);
    assert.equal((await request('/auth/admin/verify-login', 'POST', { code: code() }, pending)).status, 400);
    assert.equal(await bcrypt.compare(newPassword, (await query(db, 'SELECT password FROM users WHERE id=1'))[0].password), true);
  });
  await t.test('security logs record real actors without passwords, codes or session tokens', async () => {
    const rows = await query(db, "SELECT * FROM audit_logs WHERE entity_type='account_security'");
    assert.ok(rows.some(row => row.action === 'login_success' && row.actor_id === 1 && row.actor_role === 'admin'));
    assert.ok(rows.some(row => row.action === 'admin_password_changed'));
    assert.ok(emails.some(email => email.subject === 'Admin account sign-in alert'));
    const logs = JSON.stringify(rows);
    assert.ok(!logs.includes(password)); assert.ok(!logs.includes(code())); assert.ok(!logs.includes(jar.delivery_session));
  });
  await t.test('email failure cannot bypass admin verification', async () => {
    deliveryFails = true;
    const response = await request('/auth/login', 'POST', { email: 'admin@example.com', password: 'UpdatedAdminPassword1!' }, {});
    assert.equal(response.status, 503);
    assert.equal(response.headers.getSetCookie().some(value => /^delivery_session=[a-f0-9]/.test(value)), false);
    deliveryFails = false;
    const key = process.env.BREVO_API_KEY;
    delete process.env.BREVO_API_KEY;
    try {
      const unconfigured = await request('/auth/login', 'POST', { email: 'admin@example.com', password: 'UpdatedAdminPassword1!' }, {});
      assert.equal(unconfigured.status, 503);
      assert.equal(unconfigured.headers.getSetCookie().some(value => /^delivery_session=[a-f0-9]/.test(value)), false);
    } finally { process.env.BREVO_API_KEY = key; }
  });
  await t.test('codes expire and lock after five wrong attempts', async () => {
    const pending = {};
    const login = await request('/auth/login', 'POST', { email: 'admin@example.com', password: 'UpdatedAdminPassword1!' }, pending); remember(login, pending);
    await query(db, 'UPDATE admin_auth_challenges SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE token_hash=?', [hash(pending.admin_challenge)]);
    assert.equal((await request('/auth/admin/verify-login', 'POST', { code: code() }, pending)).status, 400);
    const fresh = await request('/auth/login', 'POST', { email: 'admin@example.com', password: 'UpdatedAdminPassword1!' }, pending); remember(fresh, pending);
    for (let attempt = 0; attempt < 5; attempt++) assert.equal((await request('/auth/admin/verify-login', 'POST', { code: '000000' }, pending)).status, 400);
    assert.equal((await request('/auth/admin/verify-login', 'POST', { code: code() }, pending)).status, 400);
  });
  await t.test('five failed password attempts cause persistent cooldown with generic errors', async () => {
    await query(db, 'DELETE FROM auth_login_limits');
    const unknown = await request('/auth/login', 'POST', { email: 'unknown@example.com', password: 'wrong' }, {});
    const unknownBody = await unknown.json();
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await request('/auth/login', 'POST', { email: 'admin@example.com', password: 'wrong' }, {});
      assert.equal(response.status, 400); assert.deepEqual(await response.json(), unknownBody);
    }
    assert.equal((await request('/auth/login', 'POST', { email: 'admin@example.com', password: 'UpdatedAdminPassword1!' }, {})).status, 429);
    assert.ok((await query(db, 'SELECT * FROM auth_login_limits')).length > 0);
  });
  await t.test('logout revokes the authenticated session', async () => {
    const old = { ...jar };
    const response = await request('/auth/logout', 'POST', {});
    assert.equal(response.status, 200); remember(response);
    assert.equal((await request('/protected', 'GET', undefined, old)).status, 401);
  });
  await t.test('password recovery invalidates admin sessions and pending sign-in codes', async () => {
    await query(db, 'DELETE FROM auth_login_limits');
    const active = {}; await signin(active, 'UpdatedAdminPassword1!');
    const pending = {};
    const login = await request('/auth/login', 'POST', { email: 'admin@example.com', password: 'UpdatedAdminPassword1!' }, pending); remember(login, pending);
    const pendingCode = code();
    assert.equal((await request('/auth/forgot-password', 'POST', { email: 'admin@example.com' }, {})).status, 200);
    const resetMail = emails.find(email => email.subject === "Reset your Sheena's Gadgets password");
    const token = resetMail.textContent.match(/token=([a-f0-9]{64})/)[1];
    const reset = await request('/auth/reset-password', 'POST', { token, password: 'RecoveredAdminPassword1!' }, {});
    assert.equal(reset.status, 200, await reset.clone().text());
    assert.equal((await request('/protected', 'GET', undefined, active)).status, 401);
    assert.equal((await request('/auth/admin/verify-login', 'POST', { code: pendingCode }, pending)).status, 400);
    assert.equal((await query(db, "SELECT actor_role FROM audit_logs WHERE action='password_reset'"))[0].actor_role, 'admin');
  });
  await t.test('admin email requests have an account-level cap independent of the IP limit', async () => {
    await query(db, 'DELETE FROM auth_login_limits');
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await request('/auth/login', 'POST', { email: 'admin@example.com', password: 'RecoveredAdminPassword1!' }, {});
      assert.equal(response.status, 200, await response.clone().text());
      await query(db, 'DELETE FROM auth_login_limits WHERE bucket<>?', [hash('admin-email:1')]);
    }
    const count = emails.length;
    assert.equal((await request('/auth/login', 'POST', { email: 'admin@example.com', password: 'RecoveredAdminPassword1!' }, {})).status, 429);
    assert.equal(emails.length, count);
  });
});

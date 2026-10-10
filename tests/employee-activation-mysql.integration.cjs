const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2');
const express = require('express');
const bcrypt = require('bcrypt');
const { query, issueSession } = require('../routes/chatSession');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

test('employee invitations and access controls with isolated MySQL and mocked email', { skip: process.env.RUN_EMPLOYEE_MYSQL !== '1' }, async t => {
  const database = `employee_activation_test_${crypto.randomBytes(8).toString('hex')}`;
  const db = mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1',port: Number(process.env.DB_PORT || 3307),user: process.env.DB_USER || 'root',password: process.env.DB_PASSWORD || '' });
  await query(db,`CREATE DATABASE \`${database}\``);
  t.after(async () => { assert.match(database,/^employee_activation_test_[a-f0-9]{16}$/); await query(db,`DROP DATABASE \`${database}\``); await new Promise(resolve => db.end(resolve)); });
  await query(db,`USE \`${database}\``); await require('../db/schemaHealth').ensureCoreSchema(db);
  const password = 'EmployeePassword1!';
  await query(db,"INSERT INTO users (id,name,email,password,role) VALUES (1,'Admin','admin@example.com',?,'admin'),(2,'Legacy Staff','legacy@example.com',?,'staff')",[await bcrypt.hash(password,4),await bcrypt.hash(password,4)]);
  const originalFetch = global.fetch;
  const envKeys = ['EMAIL_PROVIDER','BREVO_API_KEY','EMAIL_FROM_ADDRESS','APP_BASE_URL'];
  const env = Object.fromEntries(envKeys.map(key => [key,process.env[key]]));
  Object.assign(process.env,{ EMAIL_PROVIDER: 'brevo',BREVO_API_KEY: 'mock',EMAIL_FROM_ADDRESS: 'sender@example.com',APP_BASE_URL: 'https://shop.example.com' });
  const emails = []; let mailFails = false;
  global.fetch = async (url,options) => {
    if (String(url).startsWith('https://api.brevo.com/')) {
      if (mailFails) return new Response('{}',{ status: 503 });
      emails.push(JSON.parse(options.body)); return new Response('{}',{ status: 201 });
    }
    if (String(url).startsWith('https:')) throw new Error('Unexpected outbound request blocked');
    return originalFetch(url,options);
  };
  t.after(() => { global.fetch = originalFetch; for (const key of envKeys) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; } });
  let adminCookie;
  await issueSession({ db,headers: {} },{ clearCookie() {},cookie(name,value) { adminCookie = `${name}=${value}`; } },{ id: 1,role: 'admin' },{ adminVerified: true });
  const app = express(); app.use(express.json()); app.use((req,res,next) => { req.db = db; next(); });
  app.use('/auth',require('../routes/auth'));
  app.use('/admin/staff',require('../routes/staff')); app.use('/admin/riders',require('../routes/riders'));
  app.use('/account-invitations',require('../routes/employeeAccounts').router);
  app.get('/staff-access',require('../routes/roleGuard').requireRole(['staff']),(req,res) => res.json({ ok: true }));
  app.use('/rider',require('../routes/riders').riderRouter);
  app.use('/delivery-chat',require('../routes/deliveryChat'));
  const server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',() => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path,method='GET',body,cookie=adminCookie,headers={}) => originalFetch(origin+path,{ method,headers: { 'Content-Type': 'application/json',Cookie: cookie || '',...headers },body: body === undefined ? undefined : JSON.stringify(body) });
  const token = () => emails.at(-1).textContent.match(/#token=([a-f0-9]{64})/)[1];
  let staff, rider, staffToken, riderToken, staffCookie;
  await t.test('new staff and riders are pending without admin-selected passwords or leaked tokens', async () => {
    for (const role of ['staff','rider']) {
      const res = await request(`/admin/${role === 'staff' ? role : 'riders'}`,'POST',{ name: `Invited ${role}`,email: `${role}@example.com`,phone: '09123456789',password: 'AdminChosen1!' });
      assert.equal(res.status,201,await res.clone().text()); const data = await res.json();
      assert.equal(data.email_sent,true); assert.equal(data[role].account_status,'pending_activation');
      assert.ok(!JSON.stringify(data).includes(token()));
      const user = (await query(db,'SELECT * FROM users WHERE id=?',[data[role].id]))[0];
      assert.equal(user.email_verified,0); assert.equal(await bcrypt.compare('AdminChosen1!',user.password),false);
      const invitation = (await query(db,'SELECT * FROM employee_invitations WHERE user_id=?',[user.id]))[0];
      assert.equal(invitation.token_hash,hash(token()));
      if (role === 'staff') { staff = user; staffToken = token(); } else { rider = user; riderToken = token(); }
    }
  });
  await t.test('pending accounts cannot sign in, recover passwords, use stale sessions or receive deliveries', async () => {
    await query(db,'UPDATE users SET password=? WHERE id IN (?,?)',[await bcrypt.hash(password,4),staff.id,rider.id]);
    assert.equal((await request('/auth/login','POST',{ email: staff.email,password },'')).status,403);
    assert.equal((await request('/auth/verify-email','POST',{ email: staff.email,code: '123456' },'')).status,404);
    assert.equal((await query(db,'SELECT email_verified FROM users WHERE id=?',[staff.id]))[0].email_verified,0);
    let pendingCookie;
    await issueSession({ db,headers: {} },{ clearCookie() {},cookie(name,value) { pendingCookie = `${name}=${value}`; } },staff);
    assert.equal((await request('/staff-access','GET',undefined,pendingCookie)).status,401);
    const mailCount = emails.length;
    assert.equal((await request('/auth/forgot-password','POST',{ email: staff.email },'')).status,200);
    assert.equal(emails.length,mailCount);
    await query(db,"INSERT INTO products (id,name,price,stock) VALUES (1,'Phone',1000,5)");
    await query(db,"INSERT INTO orders (id,user_id,product_id,quantity,total_price,status,payment_method,payment_status,delivery_address) VALUES (1,2,1,1,1000,'processing','cod','to_collect','Test Address')");
    assert.equal((await request('/admin/riders/assignments','POST',{ order_id: 1,rider_id: rider.id })).status,400);
  });
  await t.test('activation verifies email, sets own password and consumes the link once even concurrently', async () => {
    assert.equal((await request('/account-invitations/inspect','POST',{ token: staffToken },'')).status,200);
    assert.equal((await request('/account-invitations/activate','POST',{ token: staffToken,password: 'weak' },'')).status,400);
    const responses = await Promise.all([1,2].map(() => request('/account-invitations/activate','POST',{ token: staffToken,password },'')));
    assert.deepEqual(responses.map(res => res.status).sort(),[200,400]);
    assert.equal((await request('/account-invitations/activate','POST',{ token: riderToken,password },'')).status,200);
    const rows = await query(db,'SELECT * FROM users WHERE id IN (?,?)',[staff.id,rider.id]);
    assert.ok(rows.every(user => user.account_status === 'active' && user.email_verified === 1 && user.email_verified_at));
    assert.equal((await request('/account-invitations/inspect','POST',{ token: staffToken },'')).status,400);
    const login = await request('/auth/login','POST',{ email: staff.email,password },'');
    assert.equal(login.status,200); staffCookie = login.headers.getSetCookie().find(value => /^delivery_session=[a-f0-9]/.test(value)).split(';')[0];
    assert.equal((await request('/staff-access','GET',undefined,staffCookie)).status,200);
  });
  await t.test('resend rotates links with cooldown, hourly cap, expiry, and deleted account protection', async () => {
    const res = await request('/admin/staff','POST',{ name: 'Pending',email: 'pending@example.com' });
    const pending = (await res.json()).staff; const old = token();
    assert.equal((await request(`/admin/staff/${pending.id}/invitation`,'POST',{})).status,429);
    await query(db,'UPDATE employee_invitations SET last_sent_at=DATE_SUB(NOW(),INTERVAL 61 SECOND) WHERE user_id=?',[pending.id]);
    assert.equal((await request(`/admin/staff/${pending.id}/invitation`,'POST',{})).status,200); const current = token();
    assert.equal((await request('/account-invitations/inspect','POST',{ token: old },'')).status,400);
    await query(db,'UPDATE employee_invitations SET sends=5,last_sent_at=DATE_SUB(NOW(),INTERVAL 61 SECOND) WHERE user_id=?',[pending.id]);
    assert.equal((await request(`/admin/staff/${pending.id}/invitation`,'POST',{})).status,429);
    await query(db,'UPDATE employee_invitations SET expires_at=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE user_id=?',[pending.id]);
    assert.equal((await request('/account-invitations/inspect','POST',{ token: current },'')).status,400);
    await query(db,'DELETE FROM users WHERE id=?',[pending.id]);
    assert.equal((await request('/account-invitations/activate','POST',{ token: current,password },'')).status,400);
  });
  await t.test('mail failures and missing provider never activate accounts or reveal valid invitation tokens', async () => {
    mailFails = true;
    const failed = await request('/admin/riders','POST',{ name: 'Failed Mail',email: 'failed@example.com',phone: '09123456789' });
    assert.equal(failed.status,201); const data = await failed.json(); assert.equal(data.email_sent,false);
    assert.equal((await query(db,'SELECT token_hash FROM employee_invitations WHERE user_id=?',[data.rider.id]))[0].token_hash,null);
    assert.equal((await query(db,'SELECT account_status FROM users WHERE id=?',[data.rider.id]))[0].account_status,'pending_activation');
    mailFails = false; process.env.EMAIL_PROVIDER = 'console';
    assert.equal((await request('/admin/staff','POST',{ name: 'No Provider',email: 'no-provider@example.com' })).status,503);
    assert.equal((await query(db,"SELECT id FROM users WHERE email='no-provider@example.com'")).length,0);
    process.env.EMAIL_PROVIDER = 'brevo';
  });
  await t.test('disable revokes access; enable does not activate an unverified account; existing accounts stay active', async () => {
    assert.equal((await request('/admin/riders/assignments','POST',{ order_id: 1,rider_id: rider.id })).status,200);
    assert.equal((await request(`/admin/riders/${rider.id}/status`,'PUT',{ status: 'disabled' })).status,400);
    assert.equal((await query(db,'SELECT account_status FROM users WHERE id=?',[rider.id]))[0].account_status,'active');
    await query(db,"UPDATE delivery_assignments SET status='cancelled' WHERE rider_id=?",[rider.id]);
    const riderLogin = await request('/auth/login','POST',{ email: rider.email,password },'');
    assert.equal(riderLogin.status,200);
    const riderCookie = riderLogin.headers.getSetCookie().find(value => /^delivery_session=[a-f0-9]/.test(value)).split(';')[0];
    assert.equal((await request(`/admin/riders/${rider.id}/status`,'PUT',{ status: 'disabled' })).status,200);
    assert.equal((await request('/rider/assignments','GET',undefined,riderCookie)).status,401);
    assert.equal((await request('/delivery-chat/threads','GET',undefined,riderCookie,{ 'X-Chat-User': String(rider.id) })).status,401);
    assert.equal((await request(`/admin/staff/${staff.id}/status`,'PUT',{ status: 'disabled' })).status,200);
    assert.equal((await request('/staff-access','GET',undefined,staffCookie)).status,401);
    assert.equal((await request('/auth/login','POST',{ email: staff.email,password },'')).status,403);
    assert.equal((await request(`/admin/staff/${staff.id}/status`,'PUT',{ status: 'enabled' })).status,200);
    assert.equal((await request('/staff-access','GET',undefined,staffCookie)).status,401);
    const pending = (await query(db,"SELECT id FROM users WHERE email='failed@example.com'"))[0];
    await request(`/admin/riders/${pending.id}/status`,'PUT',{ status: 'disabled' });
    await request(`/admin/riders/${pending.id}/status`,'PUT',{ status: 'enabled' });
    assert.equal((await query(db,'SELECT account_status FROM users WHERE id=?',[pending.id]))[0].account_status,'pending_activation');
    await require('../db/schemaHealth').ensureCoreSchema(db);
    assert.equal((await query(db,'SELECT account_status FROM users WHERE id=2'))[0].account_status,'active');
    assert.equal((await request('/auth/login','POST',{ email: 'legacy@example.com',password },'')).status,200);
  });
  await t.test('invitation administration requires an admin and recent verification; logs contain no secrets', async () => {
    assert.equal((await request('/admin/staff','POST',{ name: 'Forged',email: 'forged@example.com' },'')).status,401);
    await query(db,'UPDATE delivery_chat_sessions SET reauth_at=DATE_SUB(NOW(),INTERVAL 6 MINUTE) WHERE user_id=1');
    assert.equal((await request(`/admin/riders/${rider.id}/status`,'PUT',{ status: 'disabled' })).status,428);
    assert.equal((await request('/account-invitations/inspect','POST',{ token: 'invalid' },'')).status,400);
    assert.equal((await request('/account-invitations/activate','POST',{ token: riderToken,password },'',{ Origin: 'https://untrusted.example' })).status,403);
    const logs = JSON.stringify(await query(db,'SELECT * FROM audit_logs'));
    assert.ok(!logs.includes(staffToken)); assert.ok(!logs.includes(password));
  });
});

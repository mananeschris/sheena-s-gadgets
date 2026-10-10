const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mysql = require('mysql2');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const database = `customer_access_test_${crypto.randomBytes(8).toString('hex')}`;
const storagePath = path.join(os.tmpdir(), database);
if (process.env.RUN_CUSTOMER_ACCESS_MYSQL === '1') process.env.STORAGE_DIR = storagePath;
const { query, issueSession } = require('../routes/chatSession');

test('real MySQL customer ownership, private files, and isolated pooled transactions', { skip: process.env.RUN_CUSTOMER_ACCESS_MYSQL !== '1' }, async t => {
  assert.ok(['127.0.0.1', 'localhost'].includes(process.env.DB_HOST || '127.0.0.1'));
  const config = { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3307), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' };
  const control = mysql.createConnection(config);
  await query(control, `CREATE DATABASE \`${database}\``);
  const pool = mysql.createPool({ ...config, database, connectionLimit: 6 });
  const db = require('../db/requestDatabase').requestDatabase(pool);
  t.after(async () => {
    await new Promise(resolve => pool.end(resolve));
    assert.match(database, /^customer_access_test_[a-f0-9]{16}$/);
    await query(control, `DROP DATABASE \`${database}\``);
    await new Promise(resolve => control.end(resolve));
    assert.equal(path.dirname(storagePath), os.tmpdir());
    assert.match(path.basename(storagePath), /^customer_access_test_[a-f0-9]{16}$/);
    fs.rmSync(storagePath, { recursive: true, force: true });
  });
  await require('../db/schemaHealth').ensureCoreSchema(db);
  await require('../routes/orderSchema').ensureOrderCoreColumns(db);
  await query(db, "INSERT INTO users (id,name,email,password,role) VALUES (1,'Owner','owner@example.com','fixture','customer'),(2,'Other','other@example.com','fixture','customer'),(9,'Admin','admin@example.com','fixture','admin')");
  await query(db, 'UPDATE users SET password=? WHERE id=1', [await require('bcrypt').hash('OriginalPassword1!', 4)]);
  await query(db, "INSERT INTO products (id,name,price,stock) VALUES (1,'Fixture Phone',100,5)");
  await query(db, "INSERT INTO orders (id,user_id,product_id,quantity,total_price,status,payment_method,payment_status,payment_proof_image) VALUES (1,1,1,1,100,'delivered','gcash','pending_verification','/uploads/payments/fixture.jpg'),(2,1,1,1,100,'cancelled','gcash','payment_rejected',NULL)");
  await query(db, "INSERT INTO customer_addresses (user_id,label,recipient_name,phone,address) VALUES (1,'Home','Owner','09000000001','Fixture Address')");
  await new Promise((resolve, reject) => require('../routes/notifications').ensureNotificationsTable(db, error => error ? reject(error) : resolve()));
  await query(db, "INSERT INTO notifications (id,user_id,title,message) VALUES (1,1,'Fixture','Private notice')");
  const storage = require('../services/uploadStorage'); storage.ensureUploadDirectories();
  fs.writeFileSync(path.join(storage.paymentProofs, 'fixture.jpg'), 'fixture private proof');
  fs.writeFileSync(path.join(storage.orderDocuments, 'identity.jpg'), 'fixture private identity');
  fs.writeFileSync(path.join(storage.orderDocuments, 'legacy.jpg'), 'fixture legacy identity');
  fs.writeFileSync(path.join(storage.publicUploads, 'public.jpg'), 'fixture public product');
  await query(db, "INSERT INTO installment_applications (user_id,full_name,birthday,phone,address,employment_status,valid_id_type,valid_id_number,national_id_image,selfie_with_id_image) VALUES (1,'Owner','2000-01-01','09000000001','Fixture Address','Employed','Fixture','TEST-ONLY','/uploads/order-documents/identity.jpg','/uploads/legacy.jpg')");
  const cookies = {};
  for (const [id, role] of [[1, 'customer'], [2, 'customer'], [9, 'admin']]) await issueSession({ db, headers: {} }, { clearCookie() {}, cookie(name, token) { cookies[id] = `${name}=${token}`; } }, { id, role }, { adminVerified: role === 'admin' });
  const app = express(); app.use(express.json()); app.use(db.middleware); app.use((req, res, next) => { req.db = db; next(); }); app.use(storage.discardFailedUploads);
  for (const [prefix, name] of [['/auth','auth'], ['/orders','orders'], ['/payments','payments'], ['/customer/addresses','customerAddresses'], ['/notifications','notifications'], ['/reviews','reviews'], ['/uploads','uploadFiles']]) app.use(prefix, require(`../routes/${name}`));
  app.post('/transaction/:id', async (req, res) => {
    try { await new Promise((resolve, reject) => db.beginTransaction(error => error ? reject(error) : resolve())); await query(db, 'UPDATE products SET stock=stock-1 WHERE id=1'); await query(db, 'SELECT SLEEP(0.1)'); await new Promise((resolve, reject) => db[req.params.id === 'commit' ? 'commit' : 'rollback'](error => error ? reject(error) : resolve())); res.json({ ok: true }); } catch { res.status(500).end(); }
  });
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (url, method = 'GET', id = 1, body, headers = {}) => fetch(origin + url, { method, headers: { ...(id ? { Cookie: cookies[id] } : {}), 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal((await request('/customer/addresses/1', 'GET', 0)).status, 401);
  assert.equal((await request('/customer/addresses/1', 'GET', 2)).status, 403);
  assert.equal((await (await request('/customer/addresses/1')).json()).length, 1);
  assert.equal((await request('/customer/addresses/1?user_id=1', 'DELETE', 2)).status, 403);
  assert.equal((await request('/orders/customer/1', 'GET', 2)).status, 403);
  assert.equal((await request('/payments/gcash/status/1', 'GET', 2)).status, 403);
  assert.equal((await request('/payments/gcash/status/1', 'GET', 9)).status, 200);
  assert.equal((await request('/payments/gcash/retry/2', 'POST', 1, {})).status, 400);
  assert.equal((await request('/notifications/1/read', 'PUT', 2, {})).status, 404);
  assert.equal((await query(db, 'SELECT is_read FROM notifications WHERE id=1'))[0].is_read, 0);
  assert.equal((await request('/notifications/1/read', 'PUT', 1, {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/notifications/1/read', 'PUT', 1, {})).status, 200);
  assert.equal((await request('/reviews', 'POST', 2, { user_id: 1, order_id: 1, rating: 5 })).status, 403);
  assert.equal((await request('/reviews', 'POST', 1, { order_id: 1, rating: 5, comment: 'Fixture' })).status, 200);
  for (const [id, status] of [[0,401],[2,403],[1,200],[9,200]]) {
    const response = await request('/uploads/payments/fixture.jpg', 'GET', id);
    assert.equal(response.status, status);
    if (status === 200) { assert.equal(await response.text(), 'fixture private proof'); assert.equal(response.headers.get('cache-control'), 'private, no-store'); }
  }
  for (const url of ['/uploads/order-documents/identity.jpg', '/uploads/legacy.jpg']) {
    assert.equal((await request(url, 'GET', 0)).status, 401);
    assert.equal((await request(url, 'GET', 2)).status, 403);
    assert.equal((await request(url, 'GET', 1)).status, 200);
    assert.equal((await request(url, 'GET', 9)).status, 200);
  }
  assert.equal((await request('/uploads/public.jpg', 'GET', 0)).status, 200);
  const previousCookie = cookies[1];
  await issueSession({ db, headers: {} }, { clearCookie() {}, cookie(name, token) { cookies[1] = `${name}=${token}`; } }, { id: 1, role: 'customer' });
  assert.equal((await request('/auth/profile/1', 'PUT', 1, { name: 'Owner', email: 'unverified@example.com', birthday: '2000-01-01', phone: '09000000001' })).status, 400);
  const change = await request('/auth/profile/1/password', 'PUT', 1, { current_password: 'OriginalPassword1!', new_password: 'UpdatedPassword1!', confirm_password: 'UpdatedPassword1!' });
  assert.equal(change.status, 200, await change.clone().text());
  assert.equal((await request('/auth/profile/1')).status, 200);
  assert.equal((await request('/auth/profile/1', 'GET', 1, undefined, { Cookie: previousCookie })).status, 401);
  assert.equal(await require('bcrypt').compare('UpdatedPassword1!', (await query(db, 'SELECT password FROM users WHERE id=1'))[0].password), true);
  await query(db, "INSERT INTO orders (id,user_id,product_id,quantity,total_price,status,payment_method,payment_status) VALUES (3,1,1,1,100,'pending','gcash','payment_rejected')");
  const photo = await require('sharp')({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  const submitProof = (actor, claimedId) => {
    const form = new FormData(); form.append('user_id', String(claimedId)); form.append('gcash_reference', 'TESTREF123456'); form.append('payment_proof', new Blob([photo], { type: 'image/jpeg' }), 'proof.jpg');
    return fetch(origin + '/payments/gcash/3/submit', { method: 'POST', headers: { Cookie: cookies[actor] }, body: form });
  };
  assert.equal((await submitProof(2, 1)).status, 403);
  assert.equal((await submitProof(1, 2)).status, 403);
  const proofSubmission = await submitProof(1, 1);
  assert.equal(proofSubmission.status, 200, await proofSubmission.clone().text());
  const proofUrl = (await proofSubmission.json()).payment_proof_image;
  assert.match(proofUrl, /^\/uploads\/payments\/gcash-/);
  assert.equal((await request(proofUrl, 'GET', 2)).status, 403);
  assert.equal((await request(proofUrl, 'GET', 1)).status, 200);
  const reject = await request('/payments/gcash/3/verify', 'POST', 9, { decision: 'rejected', rejection_reason: 'Fixture review issue' });
  assert.equal(reject.status, 200, await reject.clone().text());
  assert.equal((await submitProof(1, 1)).status, 200);
  const approve = await request('/payments/gcash/3/verify', 'POST', 9, { decision: 'approved' });
  assert.equal(approve.status, 200, await approve.clone().text());
  assert.equal((await request('/payments/gcash/3/verify', 'POST', 9, { decision: 'rejected', rejection_reason: 'Cannot overwrite approved payment' })).status, 400);
  assert.equal((await request('/payments/gcash/retry/3', 'POST', 1, {})).status, 400);
  assert.equal((await query(db, 'SELECT payment_status FROM orders WHERE id=3'))[0].payment_status, 'paid');
  const outcomes = await Promise.all([request('/transaction/commit', 'POST'), request('/transaction/rollback', 'POST')]);
  assert.deepEqual(outcomes.map(r => r.status), [200,200]);
  assert.equal(Number((await query(db, 'SELECT stock FROM products WHERE id=1'))[0].stock), 4);
});

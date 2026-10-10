const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const { query, issueSession } = require('../routes/chatSession');

test('staff workspace permissions and own account with isolated MySQL', { skip: process.env.RUN_STAFF_MYSQL !== '1' }, async t => {
  const database = `staff_workspace_test_${crypto.randomBytes(8).toString('hex')}`;
  const db = mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3307), user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' });
  await query(db, `CREATE DATABASE \`${database}\``);
  t.after(async () => {
    assert.match(database, /^staff_workspace_test_[a-f0-9]{16}$/);
    await query(db, `DROP DATABASE \`${database}\``);
    await new Promise(resolve => db.end(resolve));
  });
  await query(db, `USE \`${database}\``);
  await require('../db/schemaHealth').ensureCoreSchema(db);
  const password = 'StaffPassword1!';
  const hash = await bcrypt.hash(password, 4);
  await query(db, "INSERT INTO users (id,name,email,password,role) VALUES (1,'Admin','admin@example.com',?,'admin'),(2,'Staff','staff@example.com',?,'staff'),(3,'Customer','customer@example.com',?,'customer')", [hash,hash,hash]);
  await query(db, "INSERT INTO products (id,name,category,stock,price,variants,warranty_eligible,warranty_duration_months) VALUES (1,'Test Phone','Phones',3,1000,?,1,12)", [JSON.stringify([{ name: 'Black', price: 1000, stock: 3 }])]);
  await query(db, "INSERT INTO orders (id,user_id,product_id,quantity,total_price,status,payment_method,payment_status) VALUES (1,3,1,1,1000,'pending','cod','to_collect'),(2,3,1,1,1000,'pending','gcash','for_verification'),(3,3,1,1,1000,'pending','cod','to_collect'),(4,3,1,1,1000,'delivered','gcash','paid')");
  const cookies = {};
  for (const [id, role] of [[1,'admin'],[2,'staff'],[3,'customer']]) await issueSession({ db, headers: {} }, { clearCookie() {}, cookie(name, value) { cookies[id] = `${name}=${value}`; } }, { id, role }, { adminVerified: role === 'admin' });
  const app = express();
  app.use(express.json()); app.use((req,res,next) => { req.db = db; next(); });
  app.use('/orders', require('../routes/orders'));
  app.use('/payments', require('../routes/payments'));
  app.use('/products', require('../routes/products'));
  app.use('/admin/alerts', require('../routes/adminAlerts'));
  app.use('/admin/riders', require('../routes/riders'));
  app.use('/staff/account', require('../routes/staffAccount'));
  const server = await new Promise(resolve => { const instance = app.listen(0,'127.0.0.1',() => resolve(instance)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, id = 2) => fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookies[id] || '' }, body: body === undefined ? undefined : JSON.stringify(body) });

  await t.test('staff cannot bypass approval, delivery, deletion or rider assignment restrictions', async () => {
    for (const [path,method,body] of [
      ['/payments/gcash/2/verify','PUT',{ decision: 'approved' }], ['/payments/gcash/2/verify','POST',{ decision: 'rejected' }],
      ['/payments','POST',{ order_id: 1, amount_paid: 1000 }], ['/orders/1/cancellation-request','PUT',{ decision: 'approved' }],
      ['/orders/4/repair-request','PUT',{ decision: 'approved' }], ['/orders/1/status','PUT',{ status: 'cancelled' }],
      ['/orders/1/status','PUT',{ status: 'delivered' }], ['/orders/1','DELETE',undefined], ['/products/1','DELETE',undefined],
      ['/admin/riders/assignments','POST',{ order_id: 1, rider_id: 1 }]
    ]) assert.equal((await request(path,method,body)).status, 403, path);
    assert.equal((await request('/orders/1/status','PUT',{ status: 'processing' },0)).status, 401);
  });
  await t.test('staff prepares paid or COD orders but cannot process payment or cancellation holds', async () => {
    const process = await request('/orders/1/status','PUT',{ status: 'processing' });
    assert.equal(process.status,200,await process.clone().text());
    assert.equal((await request('/orders/1/status','PUT',{ status: 'shipped' })).status,200);
    assert.equal((await request('/orders/2/status','PUT',{ status: 'processing' })).status,400);
    await query(db, "UPDATE orders SET cancellation_request_status='pending' WHERE id=3");
    assert.equal((await request('/orders/3/status','PUT',{ status: 'processing' })).status,400);
    const rows = await query(db, "SELECT actor_role FROM order_status_history WHERE order_id=1 AND status IN ('processing','shipped')");
    assert.equal(rows.length,2);
    assert.ok(rows.every(row => row.actor_role === 'staff'));
  });
  await t.test('staff repair work requires admin approval and follows the service sequence', async () => {
    assert.equal((await request('/orders/4/repair-status','PUT',{ status: 'item_received' })).status,400);
    await query(db, "UPDATE orders SET repair_request_status='approved',repair_service_status='approved' WHERE id=4");
    assert.equal((await request('/orders/4/repair-status','PUT',{ status: 'completed' })).status,403);
    assert.equal((await request('/orders/4/repair-status','PUT',{ status: 'item_received' })).status,200);
    assert.equal((await request('/orders/4/repair-status','PUT',{ status: 'diagnosing' })).status,200);
    assert.equal((await request('/orders/4/repair-status','PUT',{ status: 'approved' })).status,403);
  });
  await t.test('stock reasons are required and variant prices, names, and warranty remain admin-owned', async () => {
    const payload = { name: 'Forged Name', price: 1, category: 'Phones', inventory_update: '1', stock: 5, variants: JSON.stringify([{ name: 'Forged', price: 1, stock: 5 }]), warranty_eligible: 0 };
    assert.equal((await request('/products/1','PUT',payload)).status,400);
    const update = await request('/products/1','PUT',{ ...payload, stock_reason: 'Received supplier shipment' });
    assert.equal(update.status,200,await update.clone().text());
    const product = (await query(db,'SELECT * FROM products WHERE id=1'))[0];
    assert.equal(product.name,'Test Phone'); assert.equal(Number(product.price),1000); assert.equal(product.warranty_duration_months,12);
    assert.deepEqual(JSON.parse(product.variants),[{ name: 'Black', price: 1000, stock: 5 }]);
    assert.equal((await request('/products/1','PUT',{ ...payload, stock_reason: 'Incorrect quantity', stock: 6 })).status,400);
    assert.equal((await request('/products/1','PUT',{ ...payload, stock_reason: 'Malformed variant', variants: '[null]' })).status,400);
    const movements = await query(db,'SELECT note,actor_role,product_name FROM inventory_movements WHERE product_id=1');
    assert.ok(movements.some(row => row.note.includes('Received supplier shipment') && row.actor_role === 'staff'));
    assert.ok(movements.every(row => row.product_name === 'Test Phone'));
  });
  await t.test('staff task responses exclude financial and approval queues at the server', async () => {
    const response = await request('/admin/alerts');
    assert.equal(response.status,200,await response.clone().text());
    const data = await response.json();
    assert.equal(data.staff_scope,true); assert.equal(data.summary.pending_installments,undefined);
    assert.ok(data.items.every(item => ['order','repair','low_stock','out_stock'].includes(item.type)));
    assert.ok(!data.items.some(item => item.order_id === 2 || item.order_id === 3));
    assert.equal(data.summary.repair_requests,1);
  });
  await t.test('staff updates only their own profile and password, revoking old sessions', async () => {
    assert.equal((await request('/staff/account/profile','PUT',{ name: 'Impersonator',actor_id: 1 })).status,401);
    assert.equal((await request('/staff/account/profile','PUT',{ name: 'Admin' },1)).status,403);
    assert.equal((await request('/staff/account/profile','PUT',{ name: 'Updated Staff',id: 1,role: 'admin',email: 'evil@example.com' })).status,200);
    const user = (await query(db,'SELECT * FROM users WHERE id=2'))[0];
    assert.equal(user.name,'Updated Staff'); assert.equal(user.email,'staff@example.com'); assert.equal(user.role,'staff');
    assert.equal((await request('/staff/account/password','PUT',{ current_password: 'wrong',password: 'NewStaffPassword1!' })).status,400);
    const old = cookies[2];
    const changed = await request('/staff/account/password','PUT',{ current_password: password,password: 'NewStaffPassword1!' });
    assert.equal(changed.status,200,await changed.clone().text());
    cookies[2] = changed.headers.getSetCookie().find(value => /^delivery_session=[a-f0-9]/.test(value)).split(';')[0];
    assert.equal((await request('/orders')).status,200);
    cookies[2] = old; assert.equal((await request('/orders')).status,401);
    const saved = (await query(db,'SELECT password FROM users WHERE id=2'))[0].password;
    assert.equal(await bcrypt.compare('NewStaffPassword1!',saved),true);
  });
});

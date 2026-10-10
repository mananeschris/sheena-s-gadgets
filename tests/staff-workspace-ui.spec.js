const { test, expect } = require('@playwright/test');
const { mockStoreSession } = require('./helpers/store-session-ui.cjs');
const user = { id: 2, name: 'Shop Assistant', role: 'staff', email: 'staff@example.com' };
const image = '/assets/hero-iphone-style.png';
const products = [{ id: 1, name: 'NovaCam Smartphone', category: 'Phones', stock: 3, price: 17990, image, variants: '[]' }, { id: 2, name: 'FlexCase Phone Case', category: 'Cases', stock: 0, price: 300, image, variants: '[]' }];
const base = { product_id: 1, product_name: products[0].name, product_image: image, quantity: 1, total_price: 17990, payment_method: 'cod', payment_status: 'to_collect', recipient_name: 'Customer Name', created_at: '2026-10-10T08:00:00Z' };
const seed = [
  { ...base,id: 10,status: 'pending' }, { ...base,id: 11,status: 'processing' }, { ...base,id: 12,status: 'shipped' },
  { ...base,id: 13,status: 'shipped',delivery_status: 'out_for_delivery' },
  { ...base,id: 14,status: 'pending',payment_method: 'gcash',payment_status: 'for_verification',payment_proof_image: image,gcash_reference: 'TEST' },
  { ...base,id: 15,status: 'pending',cancellation_request_status: 'pending' },
  { ...base,id: 16,status: 'delivered',repair_request_status: 'approved',repair_service_status: 'item_received' },
  { ...base,id: 17,status: 'delivered',repair_request_status: 'pending' }
];
async function setup(page, { empty = false, fail = false } = {}) {
  const errors = []; const writes = []; let orders = empty ? [] : seed.map(item => ({ ...item }));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (path === '/products' && req.method() === 'GET') return route.fulfill({ json: empty ? [] : products });
    if (path === '/products/categories') return route.fulfill({ json: [] });
    if (path === '/orders' && req.method() === 'GET') return route.fulfill(fail ? { status: 503,json: {} } : { json: orders });
    if (path === '/admin/alerts') return route.fulfill({ json: { staff_scope: true,summary: { total: empty ? 0 : 3 },items: [] } });
    if (path === '/admin/inventory-movements') return route.fulfill({ json: empty ? [] : [{ id: 1,product_name: products[0].name,quantity_change: 3,actor_name: user.name,note: 'Supplier shipment',created_at: base.created_at }] });
    if (/^\/orders\/\d+\/status$/.test(path)) {
      const body = req.postDataJSON(); writes.push({ path,body });
      orders = orders.map(order => order.id === Number(path.split('/')[2]) ? { ...order,status: body.status } : order);
      return route.fulfill({ json: { message: 'Updated.' } });
    }
    if (path.startsWith('/staff/account/') && req.method() === 'PUT') {
      const body = req.postDataJSON(); writes.push({ path,body });
      return route.fulfill({ json: { message: 'Updated.', ...(path.endsWith('profile') ? { user: { ...user,name: body.name } } : {}) } });
    }
    if (path.startsWith('/admin/') && !path.endsWith('.html')) return route.fulfill({ json: [] });
    return route.continue();
  });
  await mockStoreSession(page, { user });
  await page.goto('http://localhost:3000/staff/dashboard.html',{ waitUntil: 'networkidle' });
  await expect(page.locator('body')).toHaveAttribute('data-role','staff');
  return { errors,writes };
}
for (const width of [1440,768,390,320]) test(`staff layout, icons, queues and navigation at ${width}px`, async ({ page },info) => {
  await page.setViewportSize({ width,height: 1000 }); const { errors } = await setup(page);
  await expect(page.locator('#staffPrepareCount')).toHaveText('2');
  await expect(page.locator('#staffReadyCount')).toHaveText('1');
  await expect(page.locator('#staffRepairCount')).toHaveText('1');
  await expect(page.locator('#staffStockCount')).toHaveText('2');
  await expect(page.locator('#staffApprovalNotice')).toContainText('2 orders awaiting admin review');
  await expect(page.locator('#staffQueue .staff-queue-row')).toHaveCount(2);
  await expect(page.locator('.overview-performance')).toBeHidden();
  await expect(page.locator('#staffOverview img').first()).toBeVisible();
  expect(await page.locator('#staffOverview img').first().evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.locator('#staffOverview .staff-shortcuts .btn-dark')).toHaveCSS('background-color','rgb(23, 23, 23)');
  await page.locator('[data-staff-filter="ready"]').click();
  await expect(page.locator('#staffQueue .staff-queue-row')).toHaveCount(1);
  await page.locator('[data-staff-filter="repair"]').click();
  await expect(page.locator('#staffQueue')).toContainText('Item Received');
  await page.locator('[data-staff-filter="prepare"]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.staff-metrics button').evaluateAll(buttons => buttons.every(button => button.querySelector('span').getBoundingClientRect().bottom <= button.querySelector('strong').getBoundingClientRect().top))).toBe(true);
  await page.screenshot({ path: info.outputPath(`staff-overview-${width}.png`),fullPage: true,animations: 'disabled' });
  if (width <= 1180) await page.locator('#adminNavToggle').click();
  await expect(page.locator('[data-section="finance"]')).toBeHidden();
  await page.locator('[data-section="staffAccount"]').click();
  await expect(page.locator('#staffAccount')).toBeVisible();
  await expect(page.locator('#staffAccountEmail')).toHaveText(user.email);
  expect(errors).toEqual([]);
});
test('preparation advances through existing confirmation while restricted actions stay absent', async ({ page }) => {
  const { writes } = await setup(page);
  await page.locator('#staffQueue').getByRole('button',{ name: 'Process Order' }).click();
  await expect(page.locator('#statusUpdateModal')).toBeVisible();
  await page.locator('#statusUpdateModal .modal-footer .btn-dark').click();
  await expect(page.locator('#statusUpdateModal')).toBeHidden();
  expect(writes[0].body.status).toBe('processing');
  await page.evaluate(() => viewOrder(14));
  await expect(page.locator('#orderModal')).toBeVisible();
  await page.waitForFunction(() => !bootstrap.Modal.getInstance(document.getElementById('orderModal'))._isTransitioning);
  await expect(page.getByRole('button',{ name: 'Approve Payment',exact: true })).toHaveCount(0);
  await expect(page.getByRole('button',{ name: 'Reject Payment',exact: true })).toHaveCount(0);
  await page.locator('#orderModal .btn-close').click();
  await page.waitForFunction(() => !bootstrap.Modal.getInstance(document.getElementById('orderModal'))._isTransitioning);
  await page.evaluate(() => viewOrder(15));
  await expect(page.locator('#orderModal')).toBeVisible();
  await page.waitForFunction(() => !bootstrap.Modal.getInstance(document.getElementById('orderModal'))._isTransitioning);
  await expect(page.getByRole('button',{ name: 'Approve Cancel',exact: true })).toHaveCount(0);
  await page.locator('#orderModal .btn-close').click();
  await page.waitForFunction(() => !bootstrap.Modal.getInstance(document.getElementById('orderModal'))._isTransitioning);
  await page.evaluate(() => viewOrder(17));
  await expect(page.locator('#orderModal')).toBeVisible();
  await expect(page.getByRole('button',{ name: 'Approve Repair',exact: true })).toHaveCount(0);
});
test('own account saves a name and guards mismatched passwords without storing secrets', async ({ page }) => {
  const { writes } = await setup(page);
  await page.evaluate(() => showSection('staffAccount'));
  await page.locator('#staffDisplayName').fill('Updated Assistant');
  await page.locator('#staffProfileForm button').click();
  await expect(page.locator('#staffProfileMessage')).toHaveText('Updated.');
  await page.locator('#staffCurrentPassword').fill('CurrentStaff1!');
  await page.locator('#staffNewPassword').fill('NewStaff1!');
  await page.locator('#staffConfirmPassword').fill('Mismatch1!');
  await page.locator('#staffPasswordForm button').click();
  await expect(page.locator('#staffPasswordMessage')).toHaveText('Passwords do not match.');
  expect(writes).toHaveLength(1);
  await page.locator('#staffConfirmPassword').fill('NewStaff1!');
  await page.locator('#staffPasswordForm button').click();
  await expect(page.locator('#staffPasswordMessage')).toHaveText('Updated.');
  await expect(page.locator('#staffNewPassword')).toHaveValue('');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('NewStaff1!');
});
test('staff stock adjustment requires a reason and submits it with the quantities', async ({ page }) => {
  await setup(page); let body;
  await page.route('**/products/1',route => { body = route.request().postData(); return route.fulfill({ json: { message: 'Stock updated' } }); });
  await page.evaluate(() => { void restockProduct(1); });
  await expect(page.getByLabel('Adjustment reason')).toBeVisible();
  await page.getByLabel('New stock quantity').fill('8');
  await page.locator('#appDialogForm').getByRole('button',{ name: 'Update Stock' }).click();
  await expect(page.locator('#appDialogLayer')).toBeVisible();
  expect(body).toBeUndefined();
  await page.getByLabel('Adjustment reason').fill('Received supplier shipment');
  await page.locator('#appDialogForm').getByRole('button',{ name: 'Update Stock' }).click();
  await expect(page.locator('#appDialogLayer')).toBeHidden();
  await expect.poll(() => body).toContain('Received supplier shipment');
});
test('empty and failed queues have accurate feedback and support reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page,{ empty: true });
  await expect(page.locator('#staffQueue')).toContainText('No orders waiting');
  await expect(page.locator('#staffStockCount')).toHaveText('0');
  await expect(page.locator('#overview')).toHaveCSS('animation-name','none');
  await page.route('**/orders',route => route.fulfill({ status: 503,json: {} }));
  await page.evaluate(() => loadOrders());
  await expect(page.locator('#staffQueue')).toContainText('Unable to load orders');
  await expect(page.locator('#staffQueue').getByRole('button',{ name: 'Retry',exact: true })).toBeVisible();
});

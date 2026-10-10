const { test, expect } = require('@playwright/test');
const { mockStoreSession } = require('./helpers/store-session-ui.cjs');

const image = '/assets/hero-iphone-style.png';
const base = { product_id: 51, product_name: 'NovaCam Pro 5G Smartphone', product_image: image, quantity: 1, variant_name: 'Graphite 256GB', customer_name: 'Chris Joseph Mananes', customer_email: 'customer@example.com', total_price: 17990, shipping_fee: 0, payment_method: 'gcash', payment_provider: 'manual_gcash', payment_status: 'paid', status: 'pending' };
const orders = [
  { ...base, id: 34, created_at: '2026-10-01T08:00:00Z', payment_status: 'for_verification', payment_proof_image: image, gcash_reference: 'TEST123' },
  { ...base, id: 35, created_at: '2026-10-02T08:00:00Z', total_price: 1290, product_name: 'USB-C Charger', payment_method: 'cod', payment_provider: 'cod', payment_status: 'to_collect', cancellation_request_status: 'pending', cancellation_reason: 'Wrong delivery address; please cancel before dispatch.' },
  { ...base, id: 36, created_at: '2026-10-03T08:00:00Z', total_price: 30980, status: 'processing', customer_name: 'Customer With A Long Name For Delivery Verification', customer_email: 'averylongcustomeremailaddress@example.com', items: [{ product_id: 51, product_name: 'NovaCam Pro 5G Smartphone With Extended Product Name', product_image: image, quantity: 1, variant_name: 'Midnight Graphite Black 256GB', unit_price: 17990, subtotal: 17990 }, { product_id: 52, product_name: 'SlatePad Tablet', product_image: image, quantity: 1, unit_price: 12990, subtotal: 12990 }] },
  { ...base, id: 37, created_at: '2026-10-04T08:00:00Z', total_price: 4990, status: 'shipped' },
  { ...base, id: 38, created_at: '2026-10-05T08:00:00Z', status: 'delivered', warranty_expires_at: '2027-10-05' },
  { ...base, id: 39, created_at: '2026-10-06T08:00:00Z', total_price: 2990, status: 'cancelled', payment_status: 'rejected', stock_restored_at: '2026-10-06T10:00:00Z' },
  { ...base, id: 40, created_at: '2026-10-07T08:00:00Z', payment_status: 'pending_payment', payment_proof_image: null }
];

async function setup(page, options = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(role => localStorage.setItem('currentUser', JSON.stringify({ id: 1, name: 'Admin User', role })), options.role || 'admin');
  await page.route('**/*', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') return route.fulfill({ status: 400, json: { message: 'Writes disabled in UI tests' } });
    if (path === '/orders') return options.orderRoute ? options.orderRoute(route) : route.fulfill({ json: options.orders || orders });
    if (path === '/admin/riders/assignments') return options.assignmentRoute ? options.assignmentRoute(route) : route.fulfill({ json: { items: options.assignments || [{ id: 91, order_id: 36, rider_name: 'Delivery Rider', rider_phone: '09123456789', status: 'assigned', delivery_note: 'Call the customer near the main entrance.' }], summary: {} } });
    if (path === '/admin/alerts') return route.fulfill({ json: { summary: {}, items: [] } });
    if (['/admin/finance', '/admin/collections', '/admin/layaways'].includes(path)) return route.fulfill({ json: { items: [], summary: {}, data: {} } });
    if (['/products', '/products/categories', '/admin/customers', '/admin/staff', '/admin/riders', '/installments', '/installments/schedules', '/admin/inventory-movements', '/vouchers/admin/all', '/admin/audit-logs'].includes(path)) return route.fulfill({ json: [] });
    return route.continue();
  });
  await mockStoreSession(page);
  await page.goto('http://localhost:3000/admin/dashboard.html', { waitUntil: 'networkidle' });
  if (await page.locator('#adminNavToggle').isVisible()) await page.locator('#adminNavToggle').click();
  await page.locator('.nav-button[data-section="orders"]').click();
  await expect(page.locator('#orders')).toHaveClass(/active/);
  return errors;
}

const cards = page => page.locator('#ordersTable .admin-order-card');
const card = (page, id) => page.locator(`#ordersTable [data-order-id="${id}"]`);
const ids = page => cards(page).evaluateAll(elements => elements.map(el => Number(el.dataset.orderId)));

for (const width of [1440, 768, 390, 320]) {
  test(`orders, images and long details fit at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = await setup(page);
    await expect(cards(page)).toHaveCount(6);
    await expect(page.locator('#orderAllCount')).toHaveText('6');
    await expect(page.locator('#orderPendingCount')).toHaveText('2');
    await expect(card(page, 36)).toContainText('2 items in this order');
    await expect(card(page, 36)).toContainText('Delivery Rider');
    await expect(card(page, 36)).toContainText('Call the customer');
    await expect(card(page, 35)).toContainText('Wrong delivery address');
    await expect(card(page, 38)).toContainText('Warranty:');
    await expect(card(page, 39)).toContainText('Stock returned');
    expect(await cards(page).locator('img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
    expect(await page.locator('.orders-status-tabs svg').count()).toBe(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const overflow = await page.locator('#orders').evaluate(root => [...root.querySelectorAll('button, strong, small, .delivery-meta')].filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 2 && !el.matches('.admin-order-product strong')).map(el => el.textContent));
    expect(overflow).toEqual([]);
    await page.locator('.page-head').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('orders.png'), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('status, payment and search filters combine and reset together', async ({ page }) => {
  await setup(page);
  await page.locator('[data-order-status="pending"]').click();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.locator('[data-order-status="pending"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#orderResultsCount')).toHaveText('2 of 6 orders');
  await page.locator('#paymentStatusFilter').selectOption('to_collect');
  expect(await ids(page)).toEqual([35]);
  await page.locator('#orderSearch').fill('Charger');
  expect(await ids(page)).toEqual([35]);
  await page.locator('#orderSearch').fill('not a matching order');
  await expect(cards(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(cards(page)).toHaveCount(6);
  await expect(page.locator('#paymentStatusFilter')).toHaveValue('all');
  await expect(page.locator('[data-order-status="all"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#orderSearch').fill('SlatePad');
  expect(await ids(page)).toEqual([36]);
  await page.locator('#orders').getByRole('button', { name: 'Reset Filters', exact: true }).click();
  await page.locator('[data-order-status="cancelled"]').click();
  await page.locator('#paymentStatusFilter').selectOption('payment_issue');
  expect(await ids(page)).toEqual([39]);
});

test('date and amount sorting works without changing source order data', async ({ page }) => {
  await setup(page);
  expect(await ids(page)).toEqual([39, 38, 37, 36, 35, 34]);
  await page.locator('#orderSort').selectOption('oldest');
  expect(await ids(page)).toEqual([34, 35, 36, 37, 38, 39]);
  await page.locator('#orderSort').selectOption('total-high');
  expect((await ids(page))[0]).toBe(36);
  await page.locator('#orderSort').selectOption('total-low');
  expect((await ids(page))[0]).toBe(35);
  expect(await page.evaluate(() => allOrders.map(order => order.id))).toEqual([34, 35, 36, 37, 38, 39]);
  await page.locator('#orders').getByRole('button', { name: 'Reset Filters', exact: true }).click();
  await expect(page.locator('#orderSort')).toHaveValue('newest');
});

test('review shortcut clears competing filters and opens the existing payment review', async ({ page }) => {
  await setup(page);
  await page.locator('[data-order-status="delivered"]').click();
  await page.locator('#orderSearch').fill('missing');
  await page.locator('#orderReviewShortcut').click();
  expect(await ids(page)).toEqual([34]);
  await expect(page.locator('#paymentStatusFilter')).toHaveValue('for_verification');
  await expect(page.locator('#orderSearch')).toHaveValue('');
  await expect(card(page, 34).getByRole('button', { name: 'Process Order', exact: true })).toHaveCount(0);
  await expect(card(page, 34).locator('select option[value="processing"]')).toHaveCount(0);
  await card(page, 34).getByRole('button', { name: 'Review Payment', exact: true }).click();
  await expect(page.locator('#orderModal')).toBeVisible();
  await expect(page.locator('.payment-review-card')).toContainText('TEST123');
  await expect(page.locator('#orderModal').getByRole('button', { name: 'Approve Payment', exact: true })).toBeVisible();
});

test('status actions retain the note modal and terminal status restrictions', async ({ page }) => {
  await setup(page, { orders: orders.map(order => ({ ...order, cancellation_request_status: null })) });
  await expect(card(page, 38).locator('select')).toHaveCount(0);
  await expect(card(page, 39).locator('select')).toHaveCount(0);
  await card(page, 35).getByRole('button', { name: 'Process Order', exact: true }).click();
  await expect(page.locator('#statusUpdateModal')).toBeVisible();
  await page.locator('#statusUpdateNote').fill('Test only, do not submit.');
  await page.locator('#statusUpdateModal').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#statusUpdateModal')).toBeHidden();
  await expect(card(page, 35)).toHaveClass(/pending/);
});

test('staff cannot use admin-only delete or assignment controls', async ({ page }) => {
  await setup(page, { role: 'staff' });
  await expect(cards(page)).toHaveCount(6);
  await expect(page.locator('#ordersTable').getByRole('button', { name: /^Delete / })).toHaveCount(0);
  await expect(page.locator('#ordersTable').getByRole('button', { name: 'Assign Rider', exact: true })).toHaveCount(0);
  await expect(card(page, 34).getByRole('button', { name: 'Review Payment', exact: true })).toHaveCount(0);
  await expect(card(page, 34).getByRole('button', { name: 'View Details', exact: true })).toBeVisible();
});

test('filtered CSV contains only the selected orders', async ({ page }) => {
  await setup(page);
  await page.locator('[data-order-status="pending"]').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#orders').getByRole('button', { name: 'Export Orders CSV', exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString('utf8');
  expect(csv).toContain('USB-C Charger');
  expect(csv).not.toContain('SlatePad');
  expect(csv.trim().split('\n')).toHaveLength(3);
});

test('empty orders hide the payment review shortcut', async ({ page }) => {
  await setup(page, { orders: [] });
  await expect(page.locator('#ordersTable')).toContainText('No orders found.');
  await expect(page.locator('#orderReviewShortcut')).toBeHidden();
  await expect(page.locator('#orderAllCount')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Clear filters', exact: true })).toHaveCount(0);
});

test('failed order loading can be retried with a visible loading state', async ({ page }) => {
  let retryRoute;
  let retry = false;
  const errors = await setup(page, { orderRoute: route => {
    if (!retry) return route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } });
    retryRoute = route;
  } });
  await expect(page.locator('#ordersTable')).toContainText('Unable to load orders');
  retry = true;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('#ordersTable')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#ordersTable')).toContainText('Loading orders...');
  await expect.poll(() => Boolean(retryRoute)).toBe(true);
  await retryRoute.fulfill({ json: orders });
  await expect(cards(page)).toHaveCount(6);
  await expect(page.locator('#ordersTable')).toHaveAttribute('aria-busy', 'false');
  expect(errors).toEqual([]);
});

test('each order has exactly one primary action matching the approved flow', async ({ page }) => {
  const extra = [
    { ...base, id: 41, created_at: '2026-10-08', payment_status: 'paid' },
    { ...base, id: 42, created_at: '2026-10-08', payment_status: 'rejected', payment_rejection_reason: 'Reference mismatch', payment_proof_image: image },
    { ...base, id: 43, created_at: '2026-10-08', status: 'processing', delivery_address: 'Bacacay, Albay' },
    { ...base, id: 44, created_at: '2026-10-08', payment_method: 'cod', payment_status: 'to_collect' },
    { ...base, id: 45, created_at: '2026-10-08', status: 'processing' }
  ];
  await setup(page, { orders: [...orders, ...extra], assignments: [{ id: 91, order_id: 36, rider_name: 'Delivery Rider', status: 'assigned' }, { id: 92, order_id: 45, rider_name: 'Previous Rider', status: 'cancelled' }] });
  const expected = { 34: 'Review Payment', 35: 'Review Cancellation', 36: 'Mark Ready', 37: 'Out for Delivery', 38: 'View Details', 39: 'View Details', 41: 'Process Order', 42: 'View Payment Issue', 43: 'Mark Ready', 44: 'Process Order', 45: 'Mark Ready' };
  for (const [id, label] of Object.entries(expected)) {
    await expect(card(page, id).locator('.order-primary-action')).toHaveCount(1);
    await expect(card(page, id).locator('.order-primary-action')).toHaveText(label);
    await expect(card(page, id).locator('select')).toHaveCount(0);
  }
  await expect(page.locator('#ordersTable button[onclick^="deleteOrder"]')).toHaveCount(0);
  await expect(page.locator('#ordersTable').getByRole('button', { name: 'Complete', exact: true })).toHaveCount(0);
  await expect(card(page, 43).getByRole('button', { name: 'Mark Ready', exact: true })).toBeVisible();
  await expect(card(page, 42).getByRole('button', { name: 'Process Order', exact: true })).toHaveCount(0);
  await card(page, 42).getByRole('button', { name: 'View Payment Issue', exact: true }).click();
  await expect(page.locator('#orderPaymentDetails')).toBeFocused();
  await expect(page.locator('#orderPaymentDetails')).toContainText('Reference mismatch');
  await expect(page.locator('#orderModal').getByRole('button', { name: 'Process Order', exact: true })).toHaveCount(0);
});

test('view delivery and cancellation review focus the correct details without updating status', async ({ page }) => {
  const errors = await setup(page);
  await card(page, 37).getByRole('button', { name: 'View Details', exact: true }).click();
  await expect(page.locator('#orderDeliveryDetails')).toBeVisible();
  await expect(page.locator('#orderModal select')).toHaveCount(0);
  await expect(page.locator('#orderModal').getByRole('button', { name: 'Complete', exact: true })).toHaveCount(0);
  await page.locator('#orderModal .btn-close').click();
  await expect(page.locator('#orderModal')).toBeHidden();
  await card(page, 35).getByRole('button', { name: 'Review Cancellation', exact: true }).click();
  await expect(page.locator('#orderCancellationDetails')).toBeFocused();
  await expect(page.locator('#orderCancellationDetails').getByRole('button', { name: 'Approve Cancel', exact: true })).toBeVisible();
  await expect(card(page, 35).getByRole('button', { name: 'Process Order', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('more actions menu works with keyboard, cancellation modal, and rider navigation', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 850 });
  const errors = await setup(page, { orders: orders.map(order => ({ ...order, delivery_address: 'Bacacay, Albay', cancellation_request_status: null })) });
  const more = card(page, 36).getByRole('button', { name: /^More actions/ });
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(card(page, 36).getByRole('button', { name: 'Change Rider', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('order-menu.png') });
  const bounds = await card(page, 36).locator('.dropdown-menu').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await card(page, 36).getByRole('button', { name: 'Cancel Order', exact: true }).click();
  await expect(page.locator('#statusUpdateModal')).toBeVisible();
  await expect(page.locator('#statusUpdateStatusText')).toContainText('Cancelled');
  await page.locator('#statusUpdateModal').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#statusUpdateModal')).toBeHidden();
  await page.evaluate(() => viewOrder(36));
  await expect(page.locator('#orderModal .order-primary-action')).toHaveText('Mark Ready');
  await page.locator('#orderModal .order-more-actions > button').click();
  await page.locator('#orderModal').getByRole('button', { name: 'Change Rider', exact: true }).click();
  await expect(page.locator('#orderModal')).toBeHidden();
  await expect(page.locator('#riders')).toHaveClass(/active/);
  await expect(page.locator('#deliveryOrderSelect')).toHaveValue('36');
  expect(errors).toEqual([]);
});

test('delivery lookup errors offer retry instead of a false unassigned state', async ({ page }) => {
  let retry = false;
  await setup(page, { assignmentRoute: route => retry ? route.fulfill({ json: { items: [{ id: 91, order_id: 36, rider_name: 'Delivery Rider', status: 'assigned' }], summary: {} } }) : route.fulfill({ status: 503, json: { message: 'Temporary failure' } }) });
  await expect(card(page, 36).locator('.order-primary-action')).toHaveText('Retry Delivery');
  await expect(card(page, 36).getByRole('button', { name: 'Assign Rider', exact: true })).toHaveCount(0);
  await expect(card(page, 36)).toContainText('Delivery information unavailable');
  retry = true;
  await card(page, 36).getByRole('button', { name: 'Retry Delivery', exact: true }).click();
  await expect(card(page, 36).locator('.order-primary-action')).toHaveText('Mark Ready');
});

test('confirmed processing and ready actions update status and expose the next step', async ({ page }) => {
  let current = { ...base, id: 51, created_at: '2026-10-08', delivery_address: 'Bacacay, Albay' };
  const updates = [];
  await setup(page, { orderRoute: route => route.fulfill({ json: [current] }), assignments: [{ id: 91, order_id: 51, status: 'assigned', rider_name: 'Delivery Rider' }] });
  await page.route('**/orders/51/status', async route => {
    expect(route.request().method()).toBe('PUT');
    const payload = route.request().postDataJSON();
    updates.push(payload);
    current = { ...current, status: payload.status };
    await route.fulfill({ json: { message: 'Updated', status: payload.status } });
  });
  for (const [label, status] of [['Process Order', 'processing'], ['Mark Ready', 'shipped']]) {
    await card(page, 51).getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('#statusUpdateModal')).toBeVisible();
    expect(updates.length).toBe(status === 'processing' ? 0 : 1);
    await page.locator('#statusUpdateNote').fill(`Confirmed ${status} in test.`);
    await page.locator('#statusUpdateModal').getByRole('button', { name: 'Save Update', exact: true }).click();
    await expect(page.locator('#statusUpdateModal')).toBeHidden();
    await expect(card(page, 51)).toHaveClass(new RegExp(status));
  }
  expect(updates.map(update => update.status)).toEqual(['processing', 'shipped']);
  expect(updates[0].admin_note).toBe('Confirmed processing in test.');
  await expect(card(page, 51).locator('.order-primary-action')).toHaveText('Out for Delivery');
});

test('unassigned orders can be ready but pending cancellations still block readiness', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', dialog => { dialogs.push(dialog.message()); return dialog.accept(); });
  await setup(page, { orders: [{ ...base, id: 51, status: 'processing' }, { ...base, id: 52, status: 'processing', cancellation_request_status: 'pending' }], assignments: [] });
  await page.evaluate(() => beginOrderStatusUpdate(51, 'shipped'));
  await expect(page.locator('#statusUpdateModal')).toBeVisible();
  await page.locator('#statusUpdateModal').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#statusUpdateModal')).toBeHidden();
  await page.evaluate(() => beginOrderStatusUpdate(52, 'shipped'));
  await expect(page.locator('#statusUpdateModal')).toBeHidden();
  expect(dialogs).toEqual(['Review the cancellation request before continuing this order.']);
});

test('admin starts self delivery and completes it with a photo from Orders', async ({ page }, info) => {
  let current = { ...base, id: 61, status: 'shipped', created_at: '2026-10-09T08:00:00Z' };
  let assignment = null;
  const errors = await setup(page, {
    orderRoute: route => route.fulfill({ json: [current] }),
    assignmentRoute: route => route.fulfill({ json: { items: assignment ? [assignment] : [], summary: {} } })
  });
  await page.route('**/admin/riders/self-delivery', route => {
    expect(route.request().postDataJSON().order_id).toBe(61);
    assignment = { id: 101, order_id: 61, status: 'assigned', assigned_at: '2026-10-09T08:00:00Z', rider_name: 'Admin User', items: [{ product_name: base.product_name }] };
    return route.fulfill({ json: { assignment_id: 101 } });
  });
  await page.route('**/admin/riders/assignments/101/status', route => {
    expect(route.request().postDataJSON().status).toBe('out_for_delivery');
    assignment.status = 'out_for_delivery';
    return route.fulfill({ json: { status: assignment.status } });
  });
  await page.route('**/admin/riders/assignments/101/delivery-proof', route => {
    expect(route.request().headers()['content-type']).toContain('multipart/form-data');
    expect(route.request().postDataBuffer().toString()).toContain('delivery_proof');
    assignment.status = 'delivered'; current.status = 'delivered';
    return route.fulfill({ json: { status: 'delivered' } });
  });
  await card(page, 61).getByRole('button', { name: 'Out for Delivery', exact: true }).click();
  await page.locator('.app-dialog-submit').click();
  await expect(card(page, 61).locator('.order-primary-action')).toHaveText('Mark Delivered');
  await card(page, 61).getByRole('button', { name: 'Mark Delivered', exact: true }).click();
  await expect(page.locator('.rider-proof-dialog')).toBeVisible();
  await expect(page.locator('.proof-submit').first()).toBeDisabled();
  await page.locator('#deliveryProofPhoto').setInputFiles('public/assets/hero-iphone-style.png');
  await expect(page.locator('.proof-submit').first()).toBeEnabled();
  await page.screenshot({ path: info.outputPath('admin-delivery-proof.png') });
  await page.locator('.proof-submit').first().click();
  await expect(page.locator('.rider-proof-dialog')).toBeHidden();
  await expect(card(page, 61).locator('.order-primary-action')).toHaveText('View Details');
  expect(errors).toEqual([]);
});

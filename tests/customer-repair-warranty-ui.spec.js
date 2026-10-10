const { test, expect } = require('@playwright/test');

const user = { id: 101, role: 'customer', name: 'Chris Joseph B. Mananes', email: 'customer@example.com' };
const day = 24 * 60 * 60 * 1000;
const future = new Date(Date.now() + 5 * day).toISOString();
const past = new Date(Date.now() - 5 * day).toISOString();
const base = { status: 'delivered', quantity: 1, total_price: 14990, payment_status: 'paid', payment_method: 'cod', product_image: '/assets/hero-iphone-style.png', created_at: past, delivered_at: past, warranty_expires_at: future };
const fixtures = [
  { ...base, id: 1, product_name: 'NovaCam Pro 5G Smartphone', variant_name: 'Midnight Black 256GB' },
  { ...base, id: 2, product_name: 'SlatePad 10.4 Tablet', repair_request_status: 'pending', repair_requested_at: past, repair_issue: 'Screen flickers when charging.' },
  { ...base, id: 3, product_name: 'Wireless Earbuds', warranty_expires_at: past, repair_request_status: 'approved', repair_service_status: 'repairing', repair_requested_at: past, repair_issue: 'Right earbud disconnects.', repair_admin_note: 'Replacement part has arrived.\nWe will notify you once the repair is ready.' },
  { ...base, id: 4, product_name: 'Travel Charger', warranty_expires_at: past, repair_request_status: 'approved', repair_service_status: 'ready_for_pickup', repair_admin_note: 'Please bring your receipt when collecting the charger.' },
  { ...base, id: 5, product_name: 'Tablet Keyboard', warranty_expires_at: past, repair_request_status: 'approved', repair_service_status: 'completed' },
  { ...base, id: 6, product_name: 'Bluetooth Speaker', warranty_expires_at: past },
  { ...base, id: 7, product_name: 'Phone Case', repair_request_status: 'rejected', repair_admin_note: '<b>Physical damage</b> is not covered. ' + 'Additional details '.repeat(20), items: [{ product_name: 'Phone Case', quantity: 1 }, { product_name: 'Tempered Glass', quantity: 2 }] },
  { ...base, id: 8, product_name: 'Undelivered Phone', status: 'processing' }
];

async function setup(page, data = fixtures) {
  await page.addInitScript(value => localStorage.setItem('currentUser', JSON.stringify(value)), user);
  await page.route('**/auth/profile/101', route => route.fulfill({ json: { user } }));
  await page.route('**/orders/customer/101', route => route.fulfill({ json: data }));
  await page.route('**/installments/customer/101**', route => route.fulfill({ json: [] }));
  await page.route('**/layaways/customer/101', route => route.fulfill({ json: [] }));
  await page.route('**/customer/addresses/101', route => route.fulfill({ json: [] }));
  await page.route('**/soa/101', route => route.fulfill({ json: { summary: {}, soa: [] } }));
  await page.route('**/notifications/customer/101', route => route.fulfill({ json: [] }));
  await page.goto('http://localhost:3000/customer/profile.html#repairs', { waitUntil: 'networkidle' });
}

for (const width of [1440, 768, 390]) {
  test(`warranty coverage and service progress at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    const cards = page.locator('.service-item');
    const filter = page.getByLabel('Filter warranty and repair activity');
    await expect(cards).toHaveCount(7);
    await expect(page.locator('#repairOverview .payment-metric strong')).toHaveText(['3', '3', '1', '1']);
    await expect(page.getByRole('button', { name: 'Request Repair', exact: true })).toHaveCount(2);
    await expect(cards.filter({ hasText: 'Undelivered Phone' })).toHaveCount(0);
    await expect(cards.filter({ hasText: 'Phone Case' }).locator('h3')).toHaveText('Phone Case + Tempered Glass');
    await expect(cards.filter({ hasText: 'Phone Case' }).locator('.service-notes b')).toHaveCount(0);
    await expect(cards.filter({ hasText: 'Phone Case' })).toContainText('<b>Physical damage</b>');
    await page.locator('#repairWarrantySection').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/repair-overview-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

    await filter.selectOption('ongoing');
    await expect(cards).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Request Repair', exact: true })).toHaveCount(0);
    const repairing = cards.filter({ hasText: 'Wireless Earbuds' });
    await expect(repairing.locator('[aria-current="step"]')).toContainText('Repairing');
    await expect(repairing.locator('.service-steps .done')).toHaveCount(3);
    await expect(repairing).toContainText('Expired');
    await repairing.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/repair-progress-${width}.png` });
    expect(await repairing.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
    await expect(repairing.getByRole('link', { name: 'View order for Wireless Earbuds' })).toHaveAttribute('href', '/customer/order.html?order_id=3');

    await filter.selectOption('ready');
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText('Travel Charger');
    await expect(cards).toContainText('Please bring your receipt');
    await filter.selectOption('completed');
    await expect(cards).toHaveCount(1);
    await expect(cards.locator('.service-steps .done')).toHaveCount(6);
    await filter.selectOption('expired');
    await expect(cards).toHaveCount(4);
    await filter.selectOption('covered');
    await expect(cards).toHaveCount(3);

    await page.route('**/orders/customer/101', route => route.fulfill({ json: [fixtures[0]] }));
    await page.evaluate(() => loadOrders());
    await filter.selectOption('completed');
    await expect(page.locator('#repairWarrantyList')).toContainText('No matching activity');
    await page.getByRole('button', { name: 'Show All Activity' }).click();
    await expect(cards).toHaveCount(1);
    await page.route('**/orders/customer/101', route => route.fulfill({ json: [] }));
    await page.evaluate(() => loadOrders());
    await expect(page.locator('#repairWarrantyList')).toContainText('No warranty activity yet');
    await expect(filter).toBeHidden();
    await expect(page.locator('#repairOverview')).toBeHidden();
    await page.route('**/orders/customer/101', route => route.fulfill({ status: 500, json: { message: 'Unavailable' } }));
    await page.evaluate(() => loadOrders());
    await expect(page.locator('#repairWarrantyList')).toContainText('Unable to load warranty and repair activity');
    await page.route('**/orders/customer/101', route => route.fulfill({ json: fixtures }));
    await page.getByRole('button', { name: 'Try Again' }).click();
    await expect(cards).toHaveCount(7);
  });
}

test('repair request identifies the product, validates input, recovers from failure and refreshes status', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const data = fixtures.map(order => ({ ...order }));
  await setup(page, data);
  const card = page.locator('.service-item').filter({ hasText: 'NovaCam Pro' });
  const requestButton = card.getByRole('button', { name: 'Request Repair', exact: true });
  let requests = 0;
  let fail = true;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/orders/1/repair-request', async route => {
    requests++;
    expect(route.request().postDataJSON()).toEqual({ user_id: 101, issue: 'Screen flickers while charging.' });
    if (fail) return route.abort();
    await gate;
    data[0].repair_request_status = 'pending';
    data[0].repair_requested_at = new Date().toISOString();
    data[0].repair_issue = 'Screen flickers while charging.';
    await route.fulfill({ json: { message: 'Repair request submitted.' } });
  });
  page.on('dialog', dialog => dialog.accept());
  await requestButton.click();
  const dialog = page.getByRole('dialog', { name: 'Request a repair' });
  await expect(dialog).toContainText('NovaCam Pro 5G Smartphone');
  await expect(dialog).toContainText('Active until');
  const issue = dialog.getByLabel('What needs repair?');
  await dialog.getByRole('button', { name: 'Send Repair Request' }).click();
  await expect(dialog).toBeVisible();
  expect(requests).toBe(0);
  await issue.fill('   ');
  await dialog.getByRole('button', { name: 'Send Repair Request' }).click();
  expect(requests).toBe(0);
  await expect(dialog).toBeVisible();
  await issue.fill('Screen flickers while charging.');
  await page.screenshot({ path: 'test-results/repair-request-mobile.png' });
  await dialog.getByRole('button', { name: 'Send Repair Request' }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(requestButton).toBeEnabled();
  fail = false;
  await requestButton.click();
  await issue.fill('  Screen flickers while charging.  ');
  await dialog.getByRole('button', { name: 'Send Repair Request' }).click();
  await expect(requestButton).toBeDisabled();
  await page.evaluate(() => requestRepair(1));
  await expect.poll(() => requests).toBe(2);
  release();
  await expect(card).toContainText('Awaiting review');
  await expect(card.getByRole('button', { name: 'Request Repair', exact: true })).toHaveCount(0);
  await expect(page.locator('#repairOverview .payment-metric').filter({ hasText: 'Open requests' }).locator('strong')).toHaveText('4');
});

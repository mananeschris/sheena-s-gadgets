const { test, expect } = require('@playwright/test');
const { mockStoreSession } = require('./helpers/store-session-ui.cjs');

const image = '/assets/hero-iphone-style.png';
const products = [{ id: 51, name: 'NovaCam Pro 5G Smartphone', category: 'Phones', stock: 3, price: 17990, image }, { id: 52, name: 'SlatePad 10.4 Tablet', category: 'Tablets', stock: 18, price: 14990, image }];
const today = new Date().toISOString();
const orders = [{ id: 34, product_id: 51, product_name: products[0].name, product_image: image, total_price: 17990, quantity: 1, status: 'pending', payment_method: 'gcash', payment_status: 'for_verification', created_at: today, customer_name: 'Chris Joseph Mananes', payment_proof_image: image }];
const tasks = [{ type: 'payment', title: 'Payment ready for review', detail: 'NovaCam Pro 5G Smartphone', order_id: 34, created_at: today, section: 'orders' }, { type: 'low_stock', title: 'NovaCam stock running low', detail: '3 units remaining', product_id: 51, created_at: today, section: 'inventory' }];

async function setup(page, { empty = false, role = 'admin', crowded = false, ordersOnly = false } = {}) {
  const writes = [];
  await page.addInitScript(role => localStorage.setItem('currentUser', JSON.stringify({ id: 1, name: 'Admin User', role })), role);
  await page.route('**/*', route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (req.method() !== 'GET') {
      writes.push(path);
      return route.fulfill({ status: 400, json: { message: 'Test writes disabled' } });
    }
    if (path === '/products') return route.fulfill({ json: empty ? [] : products });
    if (path === '/products/categories') return route.fulfill({ json: [] });
    if (path === '/orders') return route.fulfill({ json: empty ? [] : orders });
    if (path === '/admin/alerts') return route.fulfill({ json: empty ? { summary: {}, items: [] } : { summary: { total: 2, payment_issues: 1, low_stock_products: 1 }, items: ordersOnly ? [34, 35].map(id => ({ type: 'order', title: 'New order pending', detail: `Order ID ${String(id).padStart(6, '0')} from Chris Joseph B. Mananes is waiting for processing.`, amount: 17990, order_id: id, section: 'orders', created_at: today })) : crowded ? Array.from({ length: 25 }, (_, i) => ({ ...tasks[i % 2], title: `${tasks[i % 2].title} ${i}` })) : tasks } });
    if (/^\/(admin|installments|vouchers)\//.test(path) && !path.endsWith('.html')) return route.fulfill({ json: path === '/admin/finance' ? { data: {} } : [] });
    if (path === '/installments') return route.fulfill({ json: [] });
    return route.continue();
  });
  await mockStoreSession(page);
  await page.goto('http://localhost:3000/admin/dashboard.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#adminTaskFilters button:not(.role-hidden)')).toHaveCount(role === 'staff' ? 4 : 6);
  await expect(page.locator('#taskCenterCount')).toHaveText(`${empty ? 0 : crowded ? 25 : role === 'staff' ? 1 : 2} tasks`.replace(/^1 tasks$/, '1 task'));
  return writes;
}

for (const width of [1440, 768, 390, 320]) {
  test(`overview layout is organized and grayscale at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    const writes = await setup(page);
    for (const filter of ['all', 'order', 'installment', 'repair', 'payment', 'inventory']) {
      const icon = page.locator(`[data-task-filter="${filter}"] .task-filter-metric svg`);
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
    const tasksBox = await page.locator('.overview-task-panel').boundingBox();
    const charts = await page.locator('.overview-performance').boundingBox();
    expect(tasksBox.y).toBeLessThan(charts.y);
    const side = await page.locator('.overview-side').boundingBox();
    if (width === 1440) {
      expect(Math.abs(side.y - tasksBox.y)).toBeLessThan(3);
      expect(side.x).toBeGreaterThan(tasksBox.x + tasksBox.width);
    }
    const summary = await page.locator('.overview-insight-grid').boundingBox();
    const trend = await page.locator('#analyticsSalesTrend').boundingBox();
    expect(summary.y + summary.height).toBeLessThan(trend.y);
    await expect(page.locator('#overview .btn-dark').first()).toHaveCSS('background-color', 'rgb(23, 23, 23)');
    await expect(page.locator('#analyticsSalesTrend .bar-fill').first()).toHaveCSS('background-color', 'rgb(36, 36, 36)');
    expect(await page.locator('#analyticsSalesTrend .bar-fill').evaluateAll(bars => Math.max(...bars.map(bar => bar.getBoundingClientRect().height)))).toBeGreaterThan(50);
    await expect(page.locator('#overviewAlerts img')).toBeVisible();
    expect(await page.locator('#overviewAlerts img').evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
    await expect(page.locator('#analyticsBestSeller')).toHaveText(products[0].name);
    await expect(page.locator('#analyticsPeriodValue')).toHaveText('₱17,990.00');
    await expect(page.locator('#analyticsPeriodOrders')).toHaveText('1 order');
    await expect(page.locator('#analyticsTopProducts .overview-product-name')).toHaveText(products[0].name);
    expect(await page.locator('#analyticsTopProducts img').evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
    expect(await page.locator('#analyticsSalesTrend .bar-item[data-zero="true"] .bar-fill').evaluateAll(bars => bars.every(bar => bar.getBoundingClientRect().height === 0))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const overlaps = await page.locator('#overview .overview-actions-grid button, #adminTaskFilters button').evaluateAll(buttons => buttons.filter(button => button.getBoundingClientRect().width && button.scrollWidth > button.clientWidth + 1).map(button => button.textContent));
    expect(overlaps).toEqual([]);
    await page.screenshot({ path: info.outputPath('overview.png'), fullPage: true });
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });
}

test('task filters preserve counts, active states, and empty feedback', async ({ page }) => {
  await setup(page);
  await page.locator('[data-task-filter="payment"]').click();
  await expect(page.locator('#adminActionCenter .action-item')).toHaveCount(1);
  await expect(page.locator('#adminActionCenter')).toContainText('Payment ready for review');
  await expect(page.locator('[data-task-filter="payment"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-task-filter="all"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-task-filter="all"] .task-filter-count')).toHaveText('2');
  await expect(page.locator('[data-task-filter="payment"] .task-filter-count')).toHaveText('1');
  await expect(page.locator('[data-task-filter="inventory"] .task-filter-count')).toHaveText('1');
  await page.locator('[data-task-filter="repair"]').click();
  await expect(page.locator('[data-task-filter="repair"] svg')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.locator('#adminActionCenter')).toContainText('No tasks in this category');
  await page.locator('[data-task-filter="all"]').click();
  await expect(page.locator('#adminActionCenter .action-item')).toHaveCount(2);
});

test('overview shortcuts open product editor, order review, and POS', async ({ page }) => {
  const writes = await setup(page);
  await page.locator('#overview').getByRole('button', { name: 'Add Product', exact: true }).click();
  await expect(page.locator('#productModal')).toBeVisible();
  await page.locator('#productModal .btn-close').click();
  await expect(page.locator('#productModal')).toBeHidden();
  await page.locator('#adminActionCenter').getByRole('button', { name: 'Open Order', exact: true }).click();
  await expect(page.locator('#orderModal')).toBeVisible();
  await expect(page.locator('#orderModalBody')).toContainText(products[0].name);
  await page.locator('#orderModal .btn-close').click();
  await expect(page.locator('#orderModal')).toBeHidden();
  await page.locator('[data-section="overview"]').click();
  await page.locator('#overview').getByRole('button', { name: 'Open POS', exact: true }).click();
  await expect(page.locator('#pos')).toHaveClass(/active/);
  expect(writes).toEqual([]);
});

test('analytics range and CSV export still work', async ({ page }) => {
  await setup(page);
  await page.locator('#analyticsRange').selectOption('all');
  await expect(page.locator('#analyticsSalesTrend .bar-item')).toHaveCount(1);
  await expect(page.locator('#analyticsPeriodLabel')).toHaveText('All time');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Analytics CSV', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/analytics.*\.csv/);
  await page.locator('#analyticsRange').selectOption('90');
  await expect(page.locator('#analyticsPeriodLabel')).toHaveText('Last 90 days');
  await expect(page.locator('#analyticsSalesTrend .bar-item')).toHaveCount(90);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
});

test('empty overview has balanced empty states', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page, { empty: true });
  await expect(page.locator('#adminActionCenter')).toContainText("You're all caught up");
  await expect(page.locator('#overviewAlerts')).toContainText('Stock levels look good');
  await expect(page.locator('#analyticsSalesTrend')).toContainText('No sales in this period');
  await page.screenshot({ path: info.outputPath('overview-empty.png'), fullPage: true });
});

test('staff overview retains allowed shortcuts and tasks', async ({ page }) => {
  await setup(page, { role: 'staff' });
  await expect(page.locator('#overview').getByRole('button', { name: 'Add Product', exact: true })).toBeHidden();
  await expect(page.locator('#overview').getByRole('button', { name: 'Export Reports', exact: true })).toBeHidden();
  await expect(page.locator('[data-task-filter="installment"]')).toBeHidden();
  await expect(page.locator('#staffOverview').getByRole('button', { name: 'Open POS', exact: true })).toBeVisible();
});

test('large task queue stays bounded and scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await setup(page, { crowded: true });
  await expect(page.locator('#adminActionCenter .action-item')).toHaveCount(25);
  const sizes = await page.locator('#adminActionCenter').evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight }));
  expect(sizes.height).toBeLessThanOrEqual(330);
  expect(sizes.scroll).toBeGreaterThan(sizes.height);
  await page.locator('#analyticsRange').selectOption('90');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('pending orders use compact rows with accessible icon actions', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page, { ordersOnly: true });
  await expect(page.locator('[data-task-filter="order"] .task-filter-count')).toHaveText('2');
  await expect(page.locator('#overviewTaskSummary')).toHaveCount(0);
  await expect(page.locator('#adminActionCenter .task-priority')).toHaveCount(0);
  await expect(page.locator('#adminActionCenter .status-badge')).toHaveCount(0);
  await expect(page.locator('#adminActionCenter .task-row-amount').first()).toHaveText('₱17,990.00');
  const row = page.locator('#adminActionCenter .task-row').first();
  expect((await row.boundingBox()).height).toBeLessThan(130);
  const action = row.getByRole('button', { name: 'Open Order', exact: true });
  await expect(action).toHaveAttribute('title', 'Open Order');
  await expect(action.locator('svg')).toBeVisible();
  await expect(action).toHaveText('');
  await action.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#orderModal')).toBeVisible();
  await page.locator('#orderModal .btn-close').click();
  await expect(page.locator('#orderModal')).toBeHidden();
  await page.locator('[data-section="overview"]').click();
  await page.locator('.overview-task-panel').screenshot({ path: info.outputPath('task-center.png') });
});

test('counts and selection survive task refresh', async ({ page }) => {
  await setup(page);
  await page.locator('[data-task-filter="payment"]').click();
  await page.getByRole('button', { name: 'Refresh tasks', exact: true }).click();
  await expect(page.locator('[data-task-filter="payment"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-task-filter="payment"] .task-filter-count')).toHaveText('1');
  await expect(page.locator('#adminActionCenter .task-row')).toHaveCount(1);
});

test('stock task action retains targeted inventory navigation', async ({ page }) => {
  await setup(page);
  await page.locator('[data-task-filter="inventory"]').click();
  await page.locator('#adminActionCenter').getByRole('button', { name: 'Open Inventory', exact: true }).click();
  await expect(page.locator('#inventory')).toHaveClass(/active/);
  await expect(page.locator('#inventorySearch')).toHaveValue(products[0].name);
  await expect(page.locator('#inventoryStatusFilter')).toHaveValue('low');
});

test('ranking and large order values wrap cleanly on mobile', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await setup(page);
  const longName = 'SmartphoneAccessories'.repeat(8);
  await page.route('**/orders', route => route.fulfill({ json: [{ ...orders[0], product_name: longName, total_price: 1234567890.12 }] }));
  await page.evaluate(() => loadOrders());
  await expect(page.locator('#analyticsPeriodValue')).toHaveText('₱1,234,567,890.12');
  await expect(page.locator('#analyticsTopProducts .overview-product-name')).toHaveText(longName);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const ranking = page.locator('#analyticsTopProducts');
  expect(await ranking.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.locator('.overview-performance').screenshot({ path: info.outputPath('long-values.png') });
});

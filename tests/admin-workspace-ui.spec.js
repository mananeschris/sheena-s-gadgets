const { test, expect } = require('@playwright/test');
const { mockStoreSession } = require('./helpers/store-session-ui.cjs');

const sections = ['overview', 'products', 'orders', 'repairs', 'inventory', 'pos', 'customers', 'installments', 'collections', 'layaway', 'vouchers', 'finance', 'riders', 'staff', 'audit'];
const product = { id: 51, name: 'NovaCam Pro 5G Smartphone', category: 'Phones', price: 17990, stock: 8, image: '/assets/hero-iphone-style.png', variants: JSON.stringify([{ name: 'Black 256GB', stock: 8, price: 17990 }]), warranty_eligible: 1, warranty_duration_months: 12 };
const order = { id: 34, product_id: 51, product_name: product.name, product_image: product.image, quantity: 1, total_price: 17990, status: 'pending', payment_method: 'gcash', payment_status: 'for_verification', payment_proof_image: product.image, gcash_reference: 'TEST123', customer_name: 'Chris Joseph Mananes', customer_email: 'customer@example.com', created_at: '2026-10-09T08:00:00Z' };

async function setup(page, role = 'admin', populated = true) {
  await page.addInitScript(role => localStorage.setItem('currentUser', JSON.stringify({ id: 1, role, name: 'Admin User' })), role);
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname;
    let json;
    if (path === '/products') json = populated ? [product] : [];
    else if (path === '/products/categories') json = [];
    else if (path === '/orders') json = populated ? [order] : [];
    else if (path === '/admin/alerts') json = { summary: { total: 1 }, items: [] };
    else if (path === '/admin/customers') json = populated ? [{ id: 7, name: 'Chris Joseph Mananes', email: 'customer@example.com', phone: '09123456789', address: 'Bacacay, Albay', order_count: 1, total_spend: 17990 }] : [];
    else if (path === '/admin/finance') json = { data: { total_users: 8, total_orders: 2, paid_sales: 17990, overdue_amount: 0 } };
    else if (path === '/admin/staff') json = populated ? [{ id: 9, name: 'Shop Staff', email: 'staff@example.com', role: 'staff' }] : [];
    else if (path === '/admin/riders') json = populated ? [{ id: 10, name: 'Delivery Rider', email: 'rider@example.com', role: 'rider' }] : [];
    else if (path === '/installments') json = populated ? [{ id: 61, order_id: 34, status: 'pending', full_name: 'Chris Joseph Mananes', customer_email: 'customer@example.com', product_name: product.name, order_total: 17990, downpayment_amount: 3598, financed_amount: 14392, monthly_amount: 2398.67, preferred_terms: 6 }] : [];
    else if (path === '/installments/schedules') json = populated ? [{ id: 62, order_id: 34, installment_no: 1, due_date: '2026-11-09', status: 'unpaid', amount_due: 2398.67, amount_paid: 0, product_name: product.name, customer_name: 'Chris Joseph Mananes' }] : [];
    else if (path === '/admin/collections') json = { items: populated ? [{ id: 62, order_id: 34, installment_no: 1, due_date: '2026-11-09', collection_status: 'current', amount_due: 2398.67, amount_paid: 0, balance: 2398.67, product_name: product.name, customer_name: 'Chris Joseph Mananes' }] : [], summary: {} };
    else if (path === '/admin/layaways') json = { items: populated ? [{ id: 71, product_id: 51, product_name: product.name, customer_name: 'Chris Joseph Mananes', status: 'active', quantity: 1, unit_price: 17990, total_amount: 17990, amount_paid: 3598, balance: 14392, due_date: '2027-03-09' }] : [], summary: {} };
    else if (path === '/admin/audit-logs') json = populated ? [{ id: 81, actor_name: 'Admin User', actor_role: 'admin', action: 'create_product', entity_type: 'product', entity_id: 51, details: product.name, created_at: '2026-10-09T08:00:00Z' }] : [];
    else if (/^\/admin\/(inventory-movements|riders\/assignments)$/.test(path) || path === '/vouchers/admin/all') json = [];
    if (json !== undefined) return route.fulfill({ json });
    if (route.request().method() !== 'GET') return route.fulfill({ status: 400, json: { message: 'Writes disabled during layout testing' } });
    return route.continue();
  });
  await mockStoreSession(page);
  await page.goto('http://localhost:3000/admin/dashboard.html', { waitUntil: 'networkidle' });
  await expect(page.locator('#dashboardTitle')).toHaveText(role === 'admin' ? 'Shop Dashboard' : 'Staff Workspace');
  await expect(page.locator('#adminSidebar')).toHaveCSS('background-color', 'rgb(5, 5, 5)');
  await expect(page.locator('.sidebar .brand-subtitle')).toHaveCSS('color', 'rgb(250, 250, 250)');
  await expect(page.locator('.nav-button.active')).toHaveCSS('color', 'rgb(23, 23, 23)');
  await expect(page.locator('.nav-button.active')).toHaveCSS('background-color', 'rgb(245, 245, 245)');
}

async function navigate(page, section) {
  if (await page.locator('#adminNavToggle').isVisible()) await page.locator('#adminNavToggle').click();
  await page.locator(`.nav-button[data-section="${section}"]`).click();
  await expect(page.locator(`.main > #${section}`)).toHaveClass(/active/);
  await expect(page.locator(`.nav-button[data-section="${section}"]`)).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#activeSectionLabel')).toHaveText(await page.locator(`.nav-button[data-section="${section}"] .nav-label span`).textContent());
  await page.locator('.page-head').scrollIntoViewIfNeeded();
}

for (const width of [1440, 768, 390, 320]) {
  test(`all admin sections fit and remain reachable at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await setup(page);
    for (const section of sections) {
      await navigate(page, section);
      const recordTable = { orders: '#ordersTable', installments: '#installmentTable', collections: '#collectionsTable', layaway: '#layawayTable', audit: '#auditLogTable' }[section];
      if (recordTable) await expect(page.locator(recordTable)).toContainText(product.name);
      if (section === 'staff') await expect(page.locator('#staffTable')).toContainText('Shop Staff');
      await page.locator(`#${section}`).evaluate(el => el.getAnimations({ subtree: true }).forEach(animation => { if (Number.isFinite(animation.effect.getTiming().iterations)) animation.finish(); }));
      if (width <= 1180) await expect(page.locator('#adminSidebar')).toBeHidden();
      const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('.main > .section.active *')].filter(el => !el.closest('.table-responsive') && el.getBoundingClientRect().right > innerWidth + 2).map(el => el.id || el.className).slice(0, 6) }));
      expect(overflow.scroll, `${section}: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(width);
      if (['overview', 'orders', 'inventory', 'pos', 'finance', 'staff'].includes(section)) await page.screenshot({ path: testInfo.outputPath(`${section}.png`) });
    }
    expect(errors).toEqual([]);
  });
}

test('mobile navigation traps focus, closes with Escape and backdrop, and survives resize', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await setup(page);
  await page.locator('#adminNavToggle').click();
  await expect(page.locator('#adminNavToggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-section="overview"]')).toBeFocused();
  await expect(page.locator('#adminNavClose')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: testInfo.outputPath('mobile-menu.png') });
  await page.getByRole('button', { name: 'Logout', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#adminNavClose')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#adminNavToggle')).toBeFocused();
  await expect(page.locator('#adminSidebar')).toBeHidden();
  await page.locator('#adminNavToggle').click();
  await page.locator('#adminNavBackdrop').click({ position: { x: 380, y: 300 } });
  await expect(page.locator('#adminSidebar')).toBeHidden();
  await page.locator('#adminNavToggle').click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('#adminNavBackdrop')).toBeHidden();
  await expect(page.locator('#adminSidebar')).toBeVisible();
  expect(await page.locator('main').evaluate(el => el.inert)).toBe(false);
});

test('utility icons retain their names and export working CSV', async ({ page }) => {
  await setup(page);
  await navigate(page, 'orders');
  const exportButton = page.getByRole('button', { name: 'Export Orders CSV', exact: true });
  await expect(exportButton.locator('svg')).toBeVisible();
  await expect(exportButton).toHaveAttribute('title', 'Export Orders CSV');
  const download = page.waitForEvent('download');
  await exportButton.click();
  expect((await download).suggestedFilename()).toMatch(/orders.*\.csv/);
});

test('order and status modals stay within a small viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await setup(page);
  await navigate(page, 'orders');
  await page.evaluate(() => viewOrder(34));
  await expect(page.locator('#orderModal')).toBeVisible();
  await expect(page.locator('#orderModal')).toHaveCSS('opacity', '1');
  await expect(page.locator('#orderModal .modal-content')).toHaveCSS('opacity', '1');
  await expect(page.locator('#orderModal .modal-content')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const modal = await page.locator('#orderModal .modal-content').boundingBox();
  expect(modal.x).toBeGreaterThanOrEqual(0);
  expect(modal.x + modal.width).toBeLessThanOrEqual(391);
  expect(modal.y + modal.height).toBeLessThanOrEqual(701);
  expect(await page.locator('#orderModalBody').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('order-modal.png') });
  await page.locator('#orderModal .btn-close').click();
  await expect(page.locator('#orderModal')).toBeHidden();
  await page.evaluate(() => beginOrderStatusUpdate(34, 'cancelled'));
  await expect(page.locator('#statusUpdateModal')).toBeVisible();
  await expect(page.locator('#statusUpdateModal')).toHaveCSS('opacity', '1');
  await expect(page.locator('#statusUpdateModal .modal-content')).toHaveCSS('opacity', '1');
  await page.locator('#statusUpdateNote').fill('Test note only. No changes will be submitted.');
  await expect(page.locator('#statusUpdateNote')).toHaveValue('Test note only. No changes will be submitted.');
  const statusModal = await page.locator('#statusUpdateModal .modal-content').boundingBox();
  expect(statusModal.y + statusModal.height).toBeLessThanOrEqual(701);
  await page.screenshot({ path: testInfo.outputPath('status-modal.png') });
  await page.locator('#statusUpdateModal').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#statusUpdateModal')).toBeHidden();
});

test('staff navigation retains role restrictions with the new menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await setup(page, 'staff');
  await page.locator('#adminNavToggle').click();
  await expect(page.locator('[data-section="finance"]')).toBeHidden();
  await expect(page.locator('[data-section="staff"]')).toBeHidden();
  await page.locator('[data-section="pos"]').click();
  await expect(page.locator('#pos')).toHaveClass(/active/);
  await expect(page.locator('#adminSidebar')).toBeHidden();
});

test('closing during the opening transition does not leave the product modal stuck', async ({ page }) => {
  await setup(page);
  await navigate(page, 'products');
  await page.evaluate(() => new Promise(resolve => {
    document.getElementById('productModal').addEventListener('hidden.bs.modal', () => resolve(), { once: true });
    openProductModal();
    productModal.hide();
  }));
  await expect(page.locator('#productModal')).toBeHidden();
  await page.locator('#products').getByRole('button', { name: 'Add Product', exact: true }).click();
  await expect(page.locator('#productModal')).toBeVisible();
  await page.locator('#productModal').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#productModal')).toBeHidden();
});

test('empty views remain navigable and show empty states', async ({ page }) => {
  await setup(page, 'admin', false);
  await navigate(page, 'products');
  await expect(page.locator('#productTable')).toContainText('Your catalog is empty');
  await navigate(page, 'orders');
  await expect(page.locator('#ordersTable')).toContainText('No orders found');
  await navigate(page, 'inventory');
  await expect(page.locator('#inventoryTable')).toContainText('No inventory records');
});

test('sidebar keeps account controls visible while navigation scrolls', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  await setup(page);
  const brand = await page.locator('.sidebar-brand-block').boundingBox();
  const footer = await page.locator('.sidebar-footer').boundingBox();
  expect(footer.y + footer.height).toBeLessThanOrEqual(720);
  expect(await page.locator('.sidebar-nav').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.locator('[data-section="audit"]').click();
  expect((await page.locator('.sidebar-brand-block').boundingBox()).y).toBe(brand.y);
  expect((await page.locator('.sidebar-footer').boundingBox()).y).toBe(footer.y);
  await expect(page.locator('#audit')).toHaveClass(/active/);
  await page.locator('#adminSidebar').screenshot({ path: info.outputPath('sidebar.png') });
});

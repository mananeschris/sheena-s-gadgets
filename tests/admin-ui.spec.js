const { test, expect } = require('@playwright/test');
const { mockStoreSession } = require('./helpers/store-session-ui.cjs');

const adminUser = { id: 1, role: 'admin', name: 'Admin User', email: 'admin@example.com' };
const products = [
  { id: 1, name: 'iPhone 15 Pro Max 256GB', category: 'Phones', price: 68990, stock: 8, image: '/assets/hero-iphone-style.png', variants: '[]' },
  { id: 2, name: 'USB-C Fast Charger 30W', category: 'Chargers', price: 790, stock: 18, image: '/assets/hero-iphone-style.png', variants: '[]' }
];
const orders = [
  { id: 28, product_name: 'iPhone 15 Pro Max 256GB', quantity: 1, total_price: 68990, status: 'processing', payment_method: 'gcash', payment_status: 'paid', customer_name: 'Chris', created_at: '2026-09-01T08:00:00Z', product_image: '/assets/hero-iphone-style.png' }
];

test.describe('admin dashboard redesign', () => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'tablet', width: 768, height: 1000 },
    { name: 'mobile', width: 390, height: 1000 },
    { name: 'small mobile', width: 320, height: 1000 }
  ]) {
    test(`admin layout at ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript(user => localStorage.setItem('currentUser', JSON.stringify(user)), adminUser);
      await page.route('**/products**', route => route.fulfill({ json: products }));
      await page.route('**/orders**', route => route.fulfill({ json: orders }));
      await page.route('**/admin/alerts**', route => route.fulfill({ json: { summary: { total: 2 }, items: [] } }));
      await page.route('**/admin/inventory-movements**', route => route.fulfill({ json: [] }));
      await page.route('**/vouchers/admin/all**', route => route.fulfill({ json: [] }));
      await page.route('**/admin/customers**', route => route.fulfill({ json: [] }));
      await page.route('**/installments/schedules**', route => route.fulfill({ json: [] }));
      await page.route('**/installments**', route => route.fulfill({ json: [] }));
      await page.route('**/admin/collections**', route => route.fulfill({ json: [] }));
      await page.route('**/admin/layaways**', route => route.fulfill({ json: [] }));
      await page.route('**/admin/riders/assignments**', route => route.fulfill({ json: [] }));
      await page.route('**/admin/riders**', route => route.fulfill({ json: [] }));
      await page.route('**/admin/staff**', route => route.fulfill({ json: [] }));
      await page.route('**/admin/finance**', route => route.fulfill({ json: {} }));

      const errors = [];
      page.on('pageerror', error => errors.push(error.message));

      await mockStoreSession(page);
      await page.goto('http://localhost:3000/admin/dashboard.html', { waitUntil: 'networkidle' });

      if (viewport.width <= 1180) {
        await expect(page.locator('.sidebar')).toBeHidden();
        await page.locator('#adminNavToggle').click();
      }
      await expect(page.locator('.sidebar')).toBeVisible();
      if (viewport.width <= 1180) await page.locator('#adminNavClose').click();
      await expect(page.locator('#dashboardTitle')).toContainText('Shop Dashboard');
      await expect(page.locator('#dashboardCaption')).toHaveCount(0);
      await expect(page.locator('#metricProducts')).toHaveText('2');
      await expect(page.locator('#metricStock')).toHaveText('26');
      await expect(page.locator('#metricLowStock')).toHaveText('0');
      await expect(page.locator('#metricOrders')).toHaveText('1');
      await expect(page.locator('#adminNotificationBadge')).toHaveText('2');
      expect(await page.locator('#dashboardTitle').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(24);
      expect(await page.locator('.overview-metric').first().evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
      expect((await page.locator('.overview-kpis').boundingBox()).height).toBeLessThanOrEqual(viewport.width > 700 ? 80 : 145);
      await page.locator('.page-head').scrollIntoViewIfNeeded();
      const head = await page.locator('.page-head').boundingBox();
      const metrics = await page.locator('.overview-kpis').boundingBox();
      await page.screenshot({ path: testInfo.outputPath('compact-header.png'), clip: { x: head.x, y: head.y, width: head.width, height: metrics.y + metrics.height - head.y } });
      await page.getByRole('button', { name: 'Admin notifications', exact: true }).click();
      await expect(page.locator('#adminNotificationPanel')).toBeVisible();
      await expect(page.locator('#notificationButton')).toHaveAttribute('aria-expanded', 'true');
      await page.locator('#adminNotificationPanel').evaluate(el => el.getAnimations().forEach(animation => animation.finish()));
      const notification = await page.locator('#adminNotificationPanel').boundingBox();
      expect(notification.x).toBeGreaterThanOrEqual(0);
      expect(notification.x + notification.width).toBeLessThanOrEqual(viewport.width + 1);
      await page.getByRole('button', { name: 'Admin notifications', exact: true }).click();
      await expect(page.locator('#adminNotificationPanel')).toBeHidden();
      await expect(page.locator('#notificationButton')).toHaveAttribute('aria-expanded', 'false');
      const refreshed = page.waitForRequest(request => new URL(request.url()).pathname === '/products');
      await page.getByRole('button', { name: 'Refresh dashboard', exact: true }).click();
      await refreshed;
      await expect(page.locator('#metricStock')).toHaveText('26');
      if (viewport.width <= 1180) await page.locator('#adminNavToggle').click();
      await page.locator('[data-section="products"]').click();
      await expect(page.locator('#products')).toHaveClass(/active/);
      if (viewport.width <= 1180) await page.locator('#adminNavToggle').click();
      await page.locator('[data-section="pos"]').click();
      await expect(page.locator('#pos')).toHaveClass(/active/);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
      expect(errors).toEqual([]);
    });
  }
});

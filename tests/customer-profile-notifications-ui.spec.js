const { test, expect } = require('@playwright/test');

const origin = 'http://localhost:3000';
const user = { id: 101, role: 'customer', name: 'Chris Joseph B. Mananes', email: 'customer@example.com' };
const today = new Date();
const yesterday = new Date(today);
yesterday.setDate(yesterday.getDate() - 1);
const fixtures = [
  { id: 1, type: 'order', title: 'Order ID 000058: Out for Delivery', message: 'Order ID 000058 is on the way.', order_product_name: 'HyperCharge 65W GaN Charger', order_product_image: '/assets/hero-iphone-style.png', action_url: '/customer/profile.html?order=58#orders', is_read: 0, created_at: today.toISOString() },
  { id: 2, type: 'payment', title: 'Payment rejected', message: 'Please upload a clearer payment screenshot.', order_product_name: 'NovaCam Pro 5G Smartphone', order_product_image: '/assets/hero-iphone-style.png', action_url: '/customer/order.html?order_id=59', is_read: 0, created_at: yesterday.toISOString() },
  { id: 3, type: 'repair', title: 'Repair ready', message: '<b>Please bring your receipt.</b>', order_product_name: 'Very Long Product Name '.repeat(5), order_product_image: '/missing-notification-image.png', action_url: '/customer/profile.html#repairs', is_read: 1, created_at: yesterday.toISOString() },
  { id: 4, type: 'info', title: 'Shop update', message: 'Thank you for shopping with us.', is_read: 1, created_at: '2026-08-01T06:00:00Z' },
  { id: 5, type: 'installment', title: 'Installment reminder', message: 'Your monthly installment is due soon.', is_read: 0, created_at: '2026-08-01T05:00:00Z' }
];

async function setup(page, data = fixtures) {
  const state = { items: data.map(item => ({ ...item })), failLoad: false, failChange: false, requests: [], errors: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.addInitScript(value => localStorage.setItem('currentUser', JSON.stringify(value)), user);
  await page.route('**/auth/profile/101', route => route.fulfill({ json: { user } }));
  for (const path of ['orders/customer/101', 'installments/customer/101**', 'layaways/customer/101', 'customer/addresses/101']) {
    await page.route(`**/${path}`, route => route.fulfill({ json: [] }));
  }
  await page.route('**/soa/101', route => route.fulfill({ json: { summary: {}, soa: [] } }));
  await page.route('**/delivery-chat/**', route => route.fulfill({ json: { threads: [], unread_count: 0 } }));
  await page.route('**/notifications/**', async route => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;
    if (method === 'GET') return route.fulfill({ status: state.failLoad ? 500 : 200, json: state.failLoad ? { message: 'Unavailable' } : state.items });
    state.requests.push({ method, path });
    if (state.failChange) return route.fulfill({ status: 500, json: { message: 'Unavailable' } });
    if (method === 'PUT') {
      state.items = state.items.map(item => ({ ...item, is_read: path.endsWith('/read-all') || path === `/notifications/${item.id}/read` ? 1 : item.is_read }));
    } else if (method === 'DELETE') {
      state.items = state.items.filter(item => path === '/notifications/customer/101/read' ? !item.is_read : path !== `/notifications/${item.id}`);
    }
    return route.fulfill({ json: { success: true } });
  });
  return state;
}

async function open(page) {
  await page.goto(`${origin}/customer/profile.html#notifications`);
  await expect(page.locator('#profileNotifications')).toHaveAttribute('aria-busy', 'false');
}

for (const width of [320, 390, 768, 1440]) {
  test(`profile notification layout, filters, and image fallback at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await setup(page);
    await open(page);
    const cards = page.locator('.profile-notification-card');
    await expect(cards).toHaveCount(5);
    await expect(page.locator('#notificationSummaryText')).toHaveText('3 unread / 5 updates');
    await expect(page.locator('.profile-notification-day-title').first()).toHaveText('Today');
    await expect(page.locator('#profileNotifications')).not.toContainText('Order ID');
    await expect(cards.first().locator('h3')).toHaveText(fixtures[0].order_product_name);
    await expect(cards.first().locator('.profile-notification-event')).toHaveText('Out for Delivery');
    await expect(cards.first().getByRole('link', { name: 'View Order' })).toHaveAttribute('href', '/customer/order.html?order_id=58');
    await expect.poll(() => cards.first().locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    const failedPhoto = page.locator('[data-notification-id="3"]');
    await failedPhoto.scrollIntoViewIfNeeded();
    await expect(failedPhoto.locator('img')).toBeHidden();
    await expect(failedPhoto.locator('.profile-notification-visual svg')).toBeVisible();
    await expect(failedPhoto.locator('.notification-message b')).toHaveCount(0);
    await expect(failedPhoto).toContainText('<b>Please bring your receipt.</b>');
    expect(await cards.evaluateAll(items => items.every(el => el.scrollWidth <= el.clientWidth))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#notificationsSection').scrollIntoViewIfNeeded();
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
    await page.screenshot({ path: `test-results/profile-notifications-${width}.png`, fullPage: true });
    await page.locator('[data-notification-filter="unread"]').click();
    await expect(cards).toHaveCount(3);
    await expect(page.locator('[data-notification-filter="unread"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-notification-filter="payment"]').click();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText('NovaCam');
    await page.getByLabel('Search notifications').fill('clearer');
    await expect(cards).toHaveCount(1);
    await page.getByLabel('Search notifications').fill('missing product');
    await expect(page.locator('#profileNotifications')).toContainText('No matching updates');
    await page.getByRole('button', { name: 'Clear notification search', exact: true }).click();
    await expect(cards).toHaveCount(1);
    await page.locator('[data-notification-filter="all"]').click();
    await page.getByLabel('Search notifications').fill('HyperCharge');
    await expect(cards).toHaveCount(1);
    expect(state.errors).toEqual([]);
  });
}

test('mark read, mark all, and clear read preserve unread notifications', async ({ page }) => {
  const state = await setup(page);
  await open(page);
  await page.locator('[data-notification-filter="unread"]').click();
  await page.locator('[data-notification-id="1"]').getByRole('button', { name: 'Mark notification read' }).click();
  await expect(page.locator('.profile-notification-card')).toHaveCount(2);
  await expect(page.locator('#notificationUnreadBadge')).toHaveText('2');
  await page.getByRole('button', { name: 'Clear read notifications', exact: true }).click();
  await expect(page.locator('#appDialogTitle')).toHaveText('Clear read notifications?');
  await page.locator('.app-dialog-cancel').click();
  expect(state.requests.filter(request => request.method === 'DELETE')).toHaveLength(0);
  await page.getByRole('button', { name: 'Clear read notifications', exact: true }).click();
  await page.locator('.app-dialog-submit').click();
  await expect(page.locator('#notificationSummaryText')).toHaveText('2 unread / 2 updates');
  await expect(page.locator('#profileNotificationClearRead')).toBeDisabled();
  await page.getByRole('button', { name: 'Mark all read', exact: true }).click();
  await expect(page.locator('#profileNotifications')).toContainText('All caught up');
  await expect(page.locator('#profileNotificationMarkAll')).toBeDisabled();
  await expect(page.locator('#notificationUnreadBadge')).toHaveText('0');
  expect(state.errors).toEqual([]);
});

test('individual delete requires confirmation', async ({ page }) => {
  const state = await setup(page);
  await open(page);
  await page.locator('[data-notification-id="1"]').getByRole('button', { name: 'Delete notification', exact: true }).click();
  await expect(page.locator('#appDialogTitle')).toHaveText('Delete notification?');
  await page.locator('.app-dialog-submit').click();
  await expect(page.locator('.profile-notification-card')).toHaveCount(4);
  await expect(page.locator('[data-notification-id="1"]')).toHaveCount(0);
  expect(state.requests).toContainEqual({ method: 'DELETE', path: '/notifications/1' });
  expect(state.errors).toEqual([]);
});

test('opening an unread update marks it read and uses the order details link', async ({ page }) => {
  const state = await setup(page);
  await open(page);
  await page.locator('[data-notification-id="1"]').getByRole('link', { name: 'View Order' }).click();
  await expect(page).toHaveURL(`${origin}/customer/order.html?order_id=58`);
  expect(state.items.find(item => item.id === 1).is_read).toBe(1);
  expect(state.requests).toContainEqual({ method: 'PUT', path: '/notifications/1/read' });
  expect(state.errors).toEqual([]);
});

test('failed mutations keep unread status and allow retry', async ({ page }) => {
  const state = await setup(page);
  await open(page);
  state.failChange = true;
  await page.locator('[data-notification-id="1"]').getByRole('button', { name: 'Mark notification read' }).click();
  await expect(page.locator('#profileNotificationFeedback')).toContainText('Unable to update notifications');
  await expect(page.locator('#notificationUnreadBadge')).toHaveText('3');
  await expect(page.locator('[data-notification-id="1"]')).toHaveClass(/unread/);
  await expect(page.locator('#profileNotificationMarkAll')).toBeEnabled();
  state.failChange = false;
  await page.locator('[data-notification-id="1"]').getByRole('button', { name: 'Mark notification read' }).click();
  await expect(page.locator('#notificationUnreadBadge')).toHaveText('2');
  await expect(page.locator('#profileNotificationFeedback')).toBeHidden();
  expect(state.errors).toEqual([]);
});

test('load errors have retry and empty state disables bulk actions', async ({ page }) => {
  const state = await setup(page, []);
  state.failLoad = true;
  await open(page);
  await expect(page.locator('#profileNotifications')).toContainText('Unable to load notifications');
  await expect(page.locator('#profileNotificationMarkAll')).toBeDisabled();
  await expect(page.locator('#profileNotificationClearRead')).toBeDisabled();
  state.failLoad = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('#profileNotifications')).toContainText('No notifications yet');
  await expect(page.locator('#profileNotificationMarkAll')).toBeDisabled();
  await expect(page.locator('#profileNotificationClearRead')).toBeDisabled();
  expect(state.errors).toEqual([]);
});

test('unsafe action URLs are not rendered', async ({ page }) => {
  const state = await setup(page, [{ ...fixtures[0], action_url: 'javascript:alert(1)' }]);
  await open(page);
  await expect(page.locator('.profile-notification-card a')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

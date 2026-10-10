const { test, expect } = require('@playwright/test');
const origin = process.env.CUSTOMER_TEST_ORIGIN || 'http://localhost:3000';
const user = { id: 101, role: 'customer', name: 'Chris Joseph B. Mananes', email: 'customer@example.com' };
const base = { product_id: 28, product_image: '/assets/hero-iphone-style.png', quantity: 1, total_price: 1290,
  payment_method: 'gcash', payment_status: 'paid', status: 'shipped', created_at: '2026-10-07T10:00:00Z',
  processing_at: '2026-10-08T10:00:00Z', shipped_at: '2026-10-09T09:00:00Z' };
async function setup(page) {
  const errors = [];
  const orders = [
    { ...base, id: 1, product_name: 'Ready Phone Case', delivery_status: 'picked_up' },
    { ...base, id: 2, product_name: 'Delivery Cable', delivery_status: 'out_for_delivery', out_for_delivery_at: '2026-10-09T10:00:00Z' },
    { ...base, id: 3, product_name: 'Completed Charger', status: 'delivered', delivery_status: 'delivered', out_for_delivery_at: '2026-10-09T08:00:00Z', delivered_at: '2026-10-09T11:00:00Z' }
  ];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(user => localStorage.setItem('currentUser', JSON.stringify(user)), user);
  await page.route('**/auth/profile/101', route => route.fulfill({ json: { user } }));
  await page.route('**/orders/customer/101', route => route.fulfill({ json: orders }));
  for (const path of ['installments/customer/101**', 'layaways/customer/101', 'customer/addresses/101', 'notifications/customer/101']) {
    await page.route(`**/${path}`, route => route.fulfill({ json: [] }));
  }
  await page.route('**/delivery-chat/**', route => route.fulfill({ json: { threads: [], unread_count: 0 } }));
  await page.route('**/soa/101', route => route.fulfill({ json: { summary: {}, soa: [] } }));
  await page.route('**/payments/gcash/config', route => route.fulfill({ json: {} }));
  return { errors, orders };
}

for (const width of [320, 390, 768, 1440]) {
  test(`profile separates ready and out for delivery at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const { errors } = await setup(page);
    await page.goto(`${origin}/customer/profile.html#orders`);
    await expect(page.locator('#toReceiveCount')).toHaveText('1');
    await expect(page.locator('#outForDeliveryCount')).toHaveText('1');
    await page.locator('[data-filter="out-for-delivery"]').click();
    await expect(page.locator('#ordersList')).toContainText('Delivery Cable');
    await expect(page.locator('#ordersList')).not.toContainText('Ready Phone Case');
    await expect(page.locator('#ordersList .tracking-step')).toHaveCount(5);
    await expect(page.locator('#ordersList .tracking-step.current strong')).toHaveText('Out for Delivery');
    await expect(page.locator('#ordersList .tracking-step strong').first()).toHaveText('Order Placed');
    expect(await page.locator('#ordersList').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/profile-delivery-status-${width}.png`, fullPage: true });
    await page.locator('[data-filter="to-receive"]').click();
    await expect(page.locator('#ordersList .tracking-step.current strong')).toHaveText('Ready');
    expect(errors).toEqual([]);
  });

  test(`order delivery timeline has five stages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const { errors } = await setup(page);
    await page.goto(`${origin}/customer/order.html?order_id=2`);
    await expect(page.locator('#orderStatusPill')).toHaveText('Out for Delivery');
    await expect(page.locator('#trackingTimeline .tracking-step-large')).toHaveCount(5);
    await expect(page.locator('#trackingTimeline .current strong')).toHaveText('Out for Delivery');
    await expect(page.locator('#trackingTimeline .done')).toHaveCount(4);
    await expect(page.locator('#trackingTimeline .tracking-step-large strong').first()).toHaveText('Order Placed');
    expect(await page.locator('#trackingTimeline').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/order-delivery-status-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('rider status changes update customer bucket and completed state on refresh', async ({ page }) => {
  const { orders, errors } = await setup(page);
  await page.goto(`${origin}/customer/profile.html#orders`);
  await expect(page.locator('#outForDeliveryCount')).toHaveText('1');
  orders[0].delivery_status = 'out_for_delivery';
  orders[0].out_for_delivery_at = '2026-10-09T12:00:00Z';
  await page.evaluate(() => refreshProfile());
  await expect(page.locator('#outForDeliveryCount')).toHaveText('2');
  await expect(page.locator('#toReceiveCount')).toHaveText('0');
  orders[0].status = 'delivered';
  orders[0].delivered_at = '2026-10-09T13:00:00Z';
  await page.evaluate(() => refreshProfile());
  await expect(page.locator('#outForDeliveryCount')).toHaveText('1');
  await page.locator('[data-filter="completed"]').click();
  await expect(page.locator('#ordersList')).toContainText('Ready Phone Case');
  expect(errors).toEqual([]);
});

test('order search uses customer delivery labels and counts the selected status', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${origin}/customer/profile.html#orders`);
  await expect(page.locator('#ordersList .profile-order-card')).toHaveCount(3);
  await page.locator('#customerOrderSearch').fill('Out for Delivery');
  await expect(page.locator('#ordersList .profile-order-card')).toHaveCount(1);
  await expect(page.locator('#customerOrderSearchCount')).toHaveText('Showing 1 of 3');
  await page.getByRole('button', { name: 'Clear order search', exact: true }).click();
  await expect(page.locator('#ordersList .profile-order-card')).toHaveCount(3);
  await page.locator('[data-filter="completed"]').click();
  await expect(page.locator('#customerOrderSearchCount')).toHaveText('Showing 1 of 3');
  await expect(page.locator('[data-filter="completed"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-order-id="3"]').getByRole('button', { name: 'Write Review' })).toBeVisible();
  await page.locator('#customerOrderSearch').fill('does not exist');
  await expect(page.locator('#ordersList')).toContainText('No matching orders');
  expect(errors).toEqual([]);
});

test('orders sort within each status group and extra products expand', async ({ page }) => {
  const { orders, errors } = await setup(page);
  orders.push({ ...orders[0], id: 4, product_name: 'Newer Phone Case', created_at: '2026-10-09T12:00:00Z' });
  orders[0].items = ['First Case', 'Second Case', 'Third Case'].map(product_name => ({ product_name, quantity: 1, subtotal: 430 }));
  await page.goto(`${origin}/customer/profile.html#orders`);
  await page.locator('[data-filter="to-receive"]').click();
  await expect(page.locator('.profile-order-card').first()).toHaveAttribute('data-order-id', '4');
  await page.locator('#customerOrderSort').selectOption('oldest');
  await expect(page.locator('.profile-order-card').first()).toHaveAttribute('data-order-id', '1');
  const extra = page.locator('[data-order-id="1"] .profile-order-extra');
  await expect(extra.getByText('Third Case')).toBeHidden();
  await extra.locator('summary').click();
  await expect(extra.getByText('Third Case')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [390, 1440]) {
  test(`order action menu and unframed sections at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { errors } = await setup(page);
    await page.goto(`${origin}/customer/profile.html#orders`);
    if (width < 480) {
      const tabs = page.locator('#ordersSection .tabs');
      expect(await tabs.evaluate(el => getComputedStyle(el).display)).toBe('flex');
      expect(await tabs.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
      expect((await tabs.boundingBox()).height).toBeLessThan(70);
    }
    await page.locator('[data-filter="out-for-delivery"]').click();
    const more = page.locator('[data-order-id="2"] .profile-order-more');
    await more.locator('summary').click();
    await expect(more.getByRole('button', { name: 'Buy Again' })).toBeVisible();
    await expect(more.getByRole('button', { name: 'Request Cancel' })).toHaveCount(0);
    const bounds = await more.locator('.profile-order-menu').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    await expect(more).not.toHaveAttribute('open', '');
    await expect(more.locator('summary')).toBeFocused();
    await more.locator('summary').click();
    await page.locator('#customerOrderActivitySummary').click();
    await expect(more).not.toHaveAttribute('open', '');
    expect(await page.locator('.orders-section').evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('0px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
    await page.locator('#ordersSection').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/my-orders-final-${width}.png` });
    expect(errors).toEqual([]);
  });
}

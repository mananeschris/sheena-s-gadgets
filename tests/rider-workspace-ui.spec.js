const { test, expect } = require('@playwright/test');

const base = {
  id: 5, order_id: 34, status: 'assigned', assigned_at: '2026-10-09T08:00:00Z',
  customer_display_name: 'Chris Joseph B. Mananes', customer_display_phone: '09123456789',
  delivery_display_address: 'Barangay San Pedro, Bacacay, Albay',
  delivery_latitude: 13.3, delivery_longitude: 123.8, delivery_landmark: 'Beside the barangay hall',
  delivery_note: 'Please call when you arrive.', payment_method: 'gcash', payment_status: 'paid', total_price: 17990,
  items: [{ product_name: 'NovaCam Pro 5G Smartphone', variant_name: 'Midnight Black - 12GB/256GB', quantity: 1, product_image: '/assets/hero-iphone-style.png' }]
};
const statuses = ['assigned', 'picked_up', 'out_for_delivery', 'failed_attempt', 'delivered', 'cancelled'];
const rows = statuses.map((status, index) => ({ ...base, id: 5 + index, order_id: 34 + index, status,
  failed_reason: status === 'failed_attempt' ? 'Customer could not be reached.' : '',
  items: [{ ...base.items[0], product_name: index === 1 ? 'SlatePad 10.4 Tablet' : base.items[0].product_name }]
}));

async function setup(page, options = {}) {
  const errors = [], writes = [];
  let failing = options.failing;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(user => {
    if (location.pathname === '/rider/dashboard.html') localStorage.setItem('currentUser', JSON.stringify(user));
  }, { id: 201, name: options.name || 'Juan Dela Cruz', role: 'rider' });
  await page.route('**/delivery-chat/**', route => route.fulfill({ json: { threads: [], unread_count: 0 } }));
  await page.route('**/rider/assignments?**', route => {
    if (failing) { failing = false; return route.fulfill({ status: 503, json: { message: 'Deliveries are temporarily unavailable.' } }); }
    return route.fulfill({ json: { items: options.items || rows } });
  });
  await page.route('**/rider/assignments/*/status', route => {
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true } });
  });
  await page.goto('http://localhost:3000/rider/dashboard.html');
  return { errors, writes };
}

for (const width of [320, 390, 768, 1440]) {
  test(`rider delivery cards remain organized at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { errors } = await setup(page);
    await expect(page.locator('.delivery-card')).toHaveCount(4);
    await expect(page.locator('#deliveryCount')).toHaveText('4 deliveries');
    await expect(page.locator('.summary-card svg')).toHaveCount(5);
    await expect(page.locator('#summaryActive')).toHaveText('4');
    await page.getByLabel('Delivery status', { exact: true }).selectOption('all');
    await expect(page.locator('.delivery-card')).toHaveCount(6);
    for (const card of await page.locator('.delivery-card').all()) {
      expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      const bounds = await card.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    }
    await expect(page.locator('[data-assignment="9"] .delivery-finished')).toHaveText('Delivery completed');
    await expect(page.locator('[data-assignment="10"] .status-actions')).toHaveCount(0);
    await expect(page.locator('[data-assignment="8"] .delivery-issue')).toContainText('Customer could not be reached');
    await expect(page.locator('[data-assignment="5"] .item-row img')).toBeVisible();
    await expect.poll(() => page.locator('[data-assignment="5"] .item-row img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: `test-results/rider-redesign-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('search, status filtering and reset keep summary totals intact', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Search deliveries', { exact: true }).fill('slatepad');
  await expect(page.locator('.delivery-card')).toHaveCount(1);
  await expect(page.locator('#deliveryCount')).toHaveText('1 delivery');
  await expect(page.locator('#summaryActive')).toHaveText('4');
  await page.getByLabel('Delivery status', { exact: true }).selectOption('delivered');
  await expect(page.locator('#message')).toContainText('No deliveries match your filters');
  await page.getByRole('button', { name: 'Reset Filters' }).click();
  await expect(page.locator('.delivery-card')).toHaveCount(4);
  await expect(page.getByLabel('Search deliveries', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Delivery status', { exact: true })).toHaveValue('active');
});

test('contact, directions and all status actions have icons and retain their behavior', async ({ page }) => {
  const { writes } = await setup(page);
  const card = page.locator('[data-assignment="5"]');
  await expect(card.getByRole('link', { name: 'Call Customer' })).toHaveAttribute('href', 'tel:09123456789');
  await expect(card.getByRole('link', { name: 'Open Directions' })).toHaveAttribute('href', /destination=13.3%2C123.8/);
  await expect(card.locator('.status-actions button svg')).toHaveCount(3);
  await expect(card.locator('.contact-actions svg')).toHaveCount(2);
  await expect(card.locator('.delivery-payment')).toContainText('Order total');
  const dialogs = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await card.getByRole('button', { name: 'Picked Up', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(dialogs).toEqual([]);
  expect(writes[0]).toMatchObject({ status: 'picked_up', note: '', actor_id: 201, actor_role: 'rider' });
});

for (const status of ['assigned', 'picked_up', 'failed_attempt']) {
  test(`out for delivery from ${status} updates without a note prompt`, async ({ page }) => {
    const { writes } = await setup(page, { items: [{ ...base, status }] });
    const dialogs = [];
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    await page.locator('[data-assignment="5"]').getByRole('button', { name: status === 'failed_attempt' ? 'Retry Delivery' : 'Out for Delivery', exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(dialogs).toEqual([]);
    expect(writes[0]).toMatchObject({ status: 'out_for_delivery', note: '', actor_id: 201, actor_role: 'rider' });
  });
}

test('failed delivery still collects its reason and supports cancelling the prompt', async ({ page }) => {
  const { writes } = await setup(page);
  const button = page.locator('[data-assignment="5"]').getByRole('button', { name: 'Failed Attempt', exact: true });
  page.once('dialog', async dialog => {
    expect(dialog.message()).toBe('Reason for failed delivery attempt');
    await dialog.dismiss();
  });
  await button.click();
  expect(writes).toHaveLength(0);
  page.once('dialog', dialog => dialog.accept('Customer could not be reached.'));
  await button.click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ status: 'failed_attempt', note: 'Customer could not be reached.' });
});

test('long delivery details and missing product photo or pin do not break mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const longText = 'VeryLongDeliveryAddressOrCustomerName'.repeat(4);
  const { errors } = await setup(page, { items: [{ ...base, customer_display_name: longText,
    customer_display_phone: '', delivery_display_address: longText, delivery_note: '<script>window.riderXss=true</script>',
    delivery_latitude: null, delivery_longitude: null,
    items: [{ product_name: longText, quantity: 2, product_image: '/missing-product.png' }, { product_name: 'USB-C Cable', quantity: 1 }]
  }] });
  await expect(page.locator('.delivery-card')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Open Directions' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Call Customer' })).toHaveCount(0);
  await expect(page.locator('.rider-product-photo img')).toBeHidden();
  await expect(page.locator('.rider-product-photo svg')).toHaveCount(2);
  expect(await page.locator('.delivery-card').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => window.riderXss)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('empty assignments and load failures have clear recoverable states', async ({ page }) => {
  await setup(page, { items: [], failing: true });
  await expect(page.locator('#message')).toContainText('temporarily unavailable');
  await expect(page.locator('#message > svg')).toHaveCount(1);
  await page.getByRole('button', { name: 'Try Again' }).click();
  await expect(page.locator('#message')).toContainText('No delivery assignments yet');
  await expect(page.locator('#deliveryCount')).toHaveText('0 deliveries');
});

test('unknown delivery status is not mislabeled as cancelled', async ({ page }) => {
  await setup(page, { items: [{ ...base, status: 'on_hold' }] });
  await page.getByLabel('Delivery status', { exact: true }).selectOption('all');
  await expect(page.locator('.delivery-finished')).toHaveText('No rider action needed.');
  await expect(page.locator('.status-badge')).toHaveText('on_hold');
});

for (const width of [320, 390, 768, 1024, 1440]) {
  for (const longName of [false, true]) {
    test(`rider header at ${width}px with ${longName ? 'long' : 'regular'} account name`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const name = longName ? 'VeryLongUnbrokenCustomerName'.repeat(3) : 'Kim Laurenz Bataller';
      const { errors } = await setup(page, { name });
      await expect(page.locator('#riderNameText')).toHaveText(name);
      await expect(page.locator('#riderAvatar')).toHaveText(longName ? 'V' : 'KL');
      await expect(page.locator('.rider-page-context')).toHaveText('Rider Dashboard');
      await expect(page.locator('.rider-shop-brand')).toContainText("Sheena's");
      await expect(page.locator('.rider-account-copy > span')).toHaveText('Delivery rider');
      await expect(page.locator('.topbar [data-delivery-inbox]')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Refresh deliveries', exact: true })).toHaveAttribute('title', 'Refresh deliveries');
      const layout = await page.locator('.rider-header-inner').evaluate(header => {
        const elements = [...header.querySelectorAll('a, button, strong, .rider-account, .rider-page-context, .rider-brand-area, .rider-header-tools')];
        const account = header.querySelector('.rider-account').getBoundingClientRect();
        const actions = header.querySelector('.actions').getBoundingClientRect();
        return {
          fits: elements.every(el => { const rect = el.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && el.scrollWidth <= el.clientWidth + 1; }),
          noOverlap: account.right <= actions.left,
          background: getComputedStyle(header.parentElement).backgroundColor
        };
      });
      expect(layout).toEqual({ fits: true, noOverlap: true, background: 'rgb(255, 255, 255)' });
      for (const button of await page.locator('.topbar .actions button').all()) {
        const bounds = await button.boundingBox();
        expect(bounds.width).toBe(38);
        expect(bounds.height).toBe(38);
        await expect(button.locator('svg')).toHaveCount(1);
      }
      if (!longName) await page.locator('.topbar').screenshot({ path: `test-results/rider-header-${width}.png` });
      expect(errors).toEqual([]);
    });
  }
}

test('rider header refresh, messaging and logout remain functional', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.delivery-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Refresh deliveries', exact: true }).click();
  await expect(page.locator('.delivery-card')).toHaveCount(4);
  await page.locator('.topbar [data-delivery-inbox]').click();
  await expect(page.locator('#deliveryChatDialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.topbar [data-delivery-inbox]')).toBeFocused();
  await page.route('**/auth/logout', route => route.fulfill({ json: { success: true } }));
  await page.getByRole('button', { name: 'Log out', exact: true }).click();
  await expect(page).toHaveURL(/\/auth.html/);
  expect(await page.evaluate(() => localStorage.getItem('currentUser'))).toBeNull();
});

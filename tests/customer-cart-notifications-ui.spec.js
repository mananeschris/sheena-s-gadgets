const { test, expect } = require('@playwright/test');

const user = { id: 101, role: 'customer', name: 'Chris Joseph B. Mananes' };
const products = [
  { id: 9101, name: 'SlatePad 10.4 Tablet', category: 'Tablets', price: 14990, stock: 4, image: '/uploads/catalog/photos/slatepad-10-4-tablet.png', variants: JSON.stringify([{ name: 'WiFi - 6GB/128GB', price: 14990, stock: 4 }]) },
  { id: 9102, name: 'NovaCam Pro 5G Smartphone', category: 'Phones', price: 17990, stock: 3, image: '/uploads/catalog/photos/novacam-pro-5g-smartphone.png' },
  { id: 9103, name: 'Unavailable charging cable', category: 'Accessories', price: 150, stock: 0, image: '/missing-cart-image.png' }
];
const cart = products.map((product, index) => ({ key: `${product.id}_${index ? '' : 0}`, product_id: product.id, variant_index: index ? '' : 0, name: product.name, image: product.image, price: product.price, stock: product.stock, variant_name: index ? 'Default' : 'WiFi - 6GB/128GB', quantity: 1, selected: true }));
const updates = [
  { id: 1, type: 'payment', title: 'Payment proof rejected', message: 'Order ID 000048 payment proof was rejected. Please upload a clearer receipt.', order_product_name: products[0].name, order_product_image: products[0].image, action_url: '/customer/order.html?order_id=48', is_read: 0, created_at: '2026-10-07T06:39:00Z' },
  { id: 2, type: 'order', title: 'Order ID 000048: Processing', message: 'Order ID 000048 is being prepared.', order_product_name: products[1].name, order_product_image: products[1].image, action_url: '/customer/order.html?order_id=48', is_read: 1, created_at: '2026-10-07T06:30:00Z' },
  { id: 3, type: 'repair', title: 'Repair update', message: 'Your repair has been received.', order_product_name: 'Charging Cable', order_product_image: '/missing-notification-image.png', is_read: 0, created_at: '2026-10-07T06:00:00Z' }
];

async function setup(page, initialCart = cart) {
  await page.addInitScript(({ user, cart }) => {
    if (sessionStorage.getItem('cartInboxFixture')) return;
    sessionStorage.setItem('cartInboxFixture', '1');
    localStorage.setItem('currentUser', JSON.stringify(user));
    localStorage.setItem('cart', JSON.stringify(cart));
  }, { user, cart: initialCart });
  await page.route('**/products', route => route.fulfill({ json: products }));
  await page.route('**/auth/profile/**', route => route.fulfill({ json: { user } }));
  await page.route('**/reviews/product/**', route => route.fulfill({ json: [] }));
  await page.route('**/orders**', route => route.fulfill({ json: [] }));
  let notifications = updates.map(item => ({ ...item }));
  await page.route('**/notifications/**', route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === 'DELETE') notifications = notifications.filter(item => !item.is_read);
    if (method === 'PUT') notifications = notifications.map(item => ({ ...item, is_read: path.endsWith('/read-all') || path === `/notifications/${item.id}/read` ? 1 : item.is_read }));
    return route.fulfill({ json: method === 'GET' ? notifications : { success: true } });
  });
}

async function open(page, target) {
  await page.goto(`http://localhost:3000/customer/${target === 'shop' ? 'shop.html' : target === 'product' ? 'product.html?id=9101' : 'order.html?order_id=48'}`);
  if (target === 'product') await expect(page.locator('#productPageBody')).toHaveAttribute('aria-busy', 'false');
  if (target === 'shop') await expect(page.locator('#products .product-card')).toHaveCount(3);
}

async function checkPanelBounds(page, id) {
  const bounds = await page.locator(id).evaluate(el => {
    const rect = el.getBoundingClientRect();
    return { inside: rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && rect.bottom <= innerHeight + 1, noOverflow: el.scrollWidth <= el.clientWidth + 1 };
  });
  expect(bounds).toEqual({ inside: true, noOverflow: true });
}

for (const target of ['shop', 'product']) {
  for (const width of [320, 390, 768, 1440]) {
    test(`${target} cart layout and selection at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await setup(page);
      await open(page, target);
      await page.locator('#cartButton').click();
      await expect(page.locator('.cart-item')).toHaveCount(3);
      await expect(page.locator('#cartItemSummary')).toHaveText('3 items');
      await expect(page.locator('#cartTotal')).toContainText('32,980.00');
      await expect(page.locator('.cart-item.unavailable input[type=checkbox]')).toBeDisabled();
      await expect(page.locator('.cart-item.unavailable .cart-photo-fallback')).toBeVisible();
      await expect(page.locator('.cart-item.unavailable img')).toBeHidden();
      await expect.poll(() => page.locator('.cart-thumb img').first().evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      await page.getByRole('button', { name: `Increase quantity of ${products[0].name}`, exact: true }).click();
      await expect(page.getByRole('spinbutton', { name: `Quantity of ${products[0].name}` })).toHaveValue('2');
      await expect(page.locator('#cartTotal')).toContainText('47,970.00');
      await page.locator('#cartSelectAll').uncheck();
      await expect(page.locator('#cartCheckoutButton')).toBeDisabled();
      await expect(page.locator('#cartTotal')).toContainText('0.00');
      await page.getByRole('checkbox', { name: `Select ${products[0].name}`, exact: true }).check();
      expect(await page.locator('#cartSelectAll').evaluate(input => input.indeterminate)).toBe(true);
      await expect(page.locator('#cartCheckoutButton')).toBeEnabled();
      await checkPanelBounds(page, '#cartPanel');
      expect(await page.locator('#cartPanel').evaluate(el => [...el.querySelectorAll('button, input, .cart-thumb, .cart-product-name')].every(child => {
        const rect = child.getBoundingClientRect(); const parent = el.getBoundingClientRect(); return rect.left >= parent.left && rect.right <= parent.right;
      }))).toBe(true);
      await page.screenshot({ path: `test-results/cart-${target}-${width}.png` });
      await page.keyboard.press('Escape');
      await expect(page.locator('#cartPanel')).toBeHidden();
      await expect(page.locator('#cartButton')).toBeFocused();
      expect(errors).toEqual([]);
    });
  }
  test(`${target} cart quantity boundaries and selected checkout payload`, async ({ page }) => {
    await setup(page);
    await open(page, target);
    await page.locator('#cartButton').click();
    const quantity = page.getByRole('spinbutton', { name: `Quantity of ${products[0].name}`, exact: true });
    await quantity.fill('1.5');
    await quantity.press('Tab');
    await expect(quantity).toHaveValue('1');
    await quantity.fill('4');
    await quantity.press('Tab');
    await expect(page.getByRole('button', { name: `Increase quantity of ${products[0].name}`, exact: true })).toBeDisabled();
    await page.getByRole('button', { name: `Remove ${products[1].name} from cart`, exact: true }).click();
    await page.route('**/checkout.html', route => route.fulfill({ contentType: 'text/html', body: '<h1>Checkout</h1>' }));
    await page.locator('#cartCheckoutButton').click();
    await expect(page).toHaveURL(/checkout.html$/);
    const checkout = await page.evaluate(() => JSON.parse(localStorage.getItem('checkout')));
    expect(checkout).toEqual({ mode: 'cart', items: [{ key: '9101_0', product_id: 9101, variant_index: 0, quantity: 4 }] });
  });
}

for (const width of [320, 390, 768, 1440]) {
  test(`notification content and styles match on all customer pages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    const snapshots = [];
    for (const target of ['shop', 'product', 'order']) {
      await open(page, target);
      await page.locator('#notificationButton').click();
      await expect(page.locator('#notificationSummary')).toHaveText('2 unread of 3');
      await expect(page.locator('.customer-notification-item')).toHaveCount(3);
      await expect(page.locator('#notificationList')).not.toContainText('Order ID');
      await expect(page.locator('.notification-product-name').first()).toHaveText(products[0].name);
      await expect(page.locator('.customer-notification-item').last().locator('.notification-icon')).toBeVisible();
      await expect(page.locator('.customer-notification-item').last().locator('img')).toBeHidden();
      await expect(page.locator('.customer-notification-item').first().locator('.notification-icon')).toBeHidden();
      await expect.poll(() => page.locator('.notification-product-image').first().evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      await checkPanelBounds(page, '#notificationPanel');
      snapshots.push(await page.locator('#notificationPanel').evaluate(panel => ({
        text: panel.innerText,
        styles: ['.notification-head', '.notification-heading h2', '.notification-filters', '.customer-notification-item', '.notification-product-image', '.notification-product-name', '.notification-meta', '.notification-row-actions button'].map(selector => {
          const el = panel.querySelector(selector); const css = getComputedStyle(el);
          return [css.display, css.fontSize, css.fontWeight, css.color, css.backgroundColor, css.padding, css.gap, css.borderRadius, css.gridTemplateColumns, css.objectFit];
        })
      })));
      await page.screenshot({ path: `test-results/notifications-${target}-${width}.png` });
      await page.getByRole('button', { name: 'Unread 2', exact: true }).click();
      await expect(page.locator('.customer-notification-item')).toHaveCount(2);
      await page.keyboard.press('Escape');
      await expect(page.locator('#notificationPanel')).toBeHidden();
      await expect(page.locator('#notificationButton')).toBeFocused();
    }
    expect(snapshots[1]).toEqual(snapshots[0]);
    expect(snapshots[2]).toEqual(snapshots[0]);
  });
}

test('empty cart, exclusive panels, read actions and outside dismissal', async ({ page }) => {
  await setup(page, []);
  await open(page, 'product');
  await page.locator('#cartButton').click();
  await expect(page.locator('.cart-empty')).toContainText('Your cart is empty');
  await expect(page.locator('#cartFooter')).toBeHidden();
  await page.locator('#notificationButton').click();
  await expect(page.locator('#cartPanel')).toBeHidden();
  await expect(page.locator('#notificationPanel')).toBeVisible();
  await page.getByRole('button', { name: 'Mark all read', exact: true }).click();
  await expect(page.locator('#notificationSummary')).toHaveText('You are all caught up');
  await expect(page.locator('#markAllNotificationsButton')).toBeDisabled();
  await page.getByRole('button', { name: 'Clear read', exact: true }).click();
  await expect(page.locator('.notification-empty')).toContainText('You are all caught up');
  await expect(page.locator('#clearReadNotificationsButton')).toBeDisabled();
  await page.locator('#cartButton').click();
  await expect(page.locator('#notificationPanel')).toBeHidden();
  await page.locator('#productDetailPage').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('#cartPanel')).toBeHidden();
});

test('long cart scrolls its items without hiding checkout', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 600 });
  await setup(page, Array.from({ length: 12 }, (_, index) => ({ ...cart[0], key: `test_${index}` })));
  await open(page, 'shop');
  await page.locator('#cartButton').click();
  await expect(page.locator('#cartCheckoutButton')).toBeVisible();
  await checkPanelBounds(page, '#cartPanel');
  expect(await page.locator('#cartList').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.locator('#cartList').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('#cartCheckoutButton')).toBeVisible();
  await page.screenshot({ path: 'test-results/cart-long-mobile.png' });
});

const { test, expect } = require('@playwright/test');

const user = { id: 101, name: 'Chris Joseph B. Mananes', email: 'customer@example.com', role: 'customer' };
const products = [
  { id: 1, name: 'NovaCam Pro 5G Smartphone', price: 17990, stock: 10, category: 'Phones', variants: JSON.stringify([{ name: 'Midnight Black 256GB', price: 17990, stock: 5 }, { name: 'Silver 512GB', price: 21990, stock: 5 }]), image: '/assets/hero-iphone-style.png', average_rating: 4.8, review_count: 12 },
  { id: 2, name: 'PulseBuds ANC Wireless Earbuds', price: 2490, stock: 14, category: 'Audio', image: '/assets/hero-iphone-style.png', average_rating: 4.5, review_count: 7 },
  { id: 3, name: 'HyperCharge 65W GaN Charger', price: 1290, stock: 3, category: 'Chargers', image: '/assets/hero-iphone-style.png' },
  { id: 4, name: 'ClearShield Tempered Glass', price: 299, stock: 0, category: 'Protection', image: '/assets/hero-iphone-style.png' },
  { id: 5, name: 'Travel Cable With Extra Long Product Name For Overflow Testing', price: 499, stock: 6, category: "Customer's Accessories", image: '/assets/does-not-exist.png' },
  ...Array.from({ length: 22 }, (_, index) => ({ id: index + 6, name: `Daily Tech Accessory ${String(index + 1).padStart(2, '0')}`, price: 500 + index * 100, stock: 10, category: 'Accessories', image: '/assets/hero-iphone-style.png' }))
].map(product => ({ description: 'Everyday tech essentials with practical features and reliable performance.', variants: '[]', ...product }));

async function setup(page, loggedIn = true) {
  await page.addInitScript(({ user, loggedIn }) => {
    if (sessionStorage.getItem('catalogTestInitialized')) return;
    sessionStorage.setItem('catalogTestInitialized', '1');
    localStorage.clear();
    if (loggedIn) localStorage.setItem('currentUser', JSON.stringify(user));
  }, { user, loggedIn });
  await page.route('**/products', route => route.fulfill({ json: products }));
  await page.route('**/notifications/customer/**', route => route.fulfill({ json: [] }));
  await page.goto('http://localhost:3000/customer/shop.html#products', { waitUntil: 'networkidle' });
}

for (const width of [1440, 1024, 768, 390, 360]) {
  test(`catalog filtering and views at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await setup(page);
    const catalog = page.locator('#products');
    const cards = catalog.locator('.product-card');
    const filters = page.locator('#catalogFilters');
    await expect(cards).toHaveCount(12);
    await expect(page.locator('#catalogResultSummary')).toHaveText('Showing 1-12 of 27 products');
    await expect(page.locator('.shop-toolbar')).toHaveCSS('position', 'static');
    await expect(cards.first().locator('.price')).toContainText('17,990.00');
    await expect(cards.first()).toContainText('From');
    await expect(cards.nth(4).locator('.catalog-image-fallback')).toBeVisible();
    await expect(cards.nth(3).locator('.cart-add')).toBeDisabled();
    await expect(cards.nth(3).locator('.catalog-buy')).toBeDisabled();
    await expect(cards.nth(2).locator('.catalog-rating svg')).toHaveCount(0);
    await page.screenshot({ path: `test-results/catalog-grid-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    for (const card of await cards.all()) {
      expect(await card.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
    }
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(page.locator('#catalogResultSummary')).toHaveText('Showing 13-24 of 27 products');
    await page.getByRole('button', { name: 'List view', exact: true }).click();
    await expect(page.locator('#catalogResultSummary')).toHaveText('Showing 13-24 of 27 products');
    await expect(page.locator('#productList')).toHaveAttribute('data-view', 'list');
    await expect(page.getByRole('button', { name: 'List view', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(cards).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();

    await page.getByRole('searchbox', { name: 'Search products' }).fill('Midnight');
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText('NovaCam');
    await expect(page.locator('#catalogPagination')).toBeHidden();
    await page.getByRole('button', { name: 'Remove Search: Midnight filter', exact: true }).click();
    await expect(cards).toHaveCount(12);
    await page.locator('[data-category="Phones"]').click();
    await expect(cards).toHaveCount(1);
    await expect(page.locator('[data-category="Phones"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-category="Phones"]')).toBeFocused();
    await page.getByRole('button', { name: 'Remove Phones filter', exact: true }).click();

    if (width <= 800) {
      await expect(filters).toBeHidden();
      await page.getByRole('button', { name: 'Filters', exact: true }).click();
      await expect(filters).toBeVisible();
      await expect(page.getByRole('button', { name: 'Filters', exact: true })).toHaveAttribute('aria-expanded', 'true');
    }
    await page.getByLabel('Category', { exact: true }).selectOption("Customer's Accessories");
    await expect(cards).toHaveCount(1);
    await page.getByRole('button', { name: "Remove Customer's Accessories filter", exact: true }).click();
    await page.getByLabel('Price range').selectOption('under-500');
    await expect(cards).toHaveCount(2);
    await page.getByLabel('Availability', { exact: true }).selectOption('available');
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText('Travel Cable');
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await page.getByLabel('Availability', { exact: true }).selectOption('low');
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText('HyperCharge');
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await page.getByLabel('Sort products').selectOption('price-high');
    await expect(cards.first()).toContainText('NovaCam');
    await page.getByLabel('Sort products').selectOption('price-low');
    await expect(cards.first()).toContainText('ClearShield');
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await page.locator('#catalogSave2').click();
    await expect(page.locator('#catalogSave2')).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Saved products only', { exact: true }).check();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText('PulseBuds');
    await page.locator('#catalogSave2').click();
    await expect(page.getByRole('heading', { name: 'No matching products' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear All Filters', exact: true }).click();
    await page.getByRole('button', { name: 'Grid view', exact: true }).click();
    await cards.first().hover();
    await expect.poll(() => cards.first().evaluate(el => getComputedStyle(el).transform)).not.toBe('none');
    await page.getByRole('button', { name: 'List view', exact: true }).click();
    await page.locator('.catalog-results-head').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/catalog-list-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('#productList')).toHaveAttribute('data-view', 'list');
    expect(errors).toEqual([]);
  });
}

test('catalog shopping actions preserve cart and variant selection flow', async ({ page }) => {
  await setup(page);
  const earbuds = page.locator('.product-card').filter({ hasText: 'PulseBuds' });
  await earbuds.getByRole('button', { name: 'Add PulseBuds ANC Wireless Earbuds to cart', exact: true }).click();
  await expect(page.locator('#cartPanel')).toBeVisible();
  await expect(page.locator('.cart-item')).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cart'))[0].product_id)).toBe(2);
  await page.getByRole('button', { name: 'Shopping cart', exact: true }).click();
  await page.locator('.product-card').first().getByRole('button', { name: 'Add NovaCam Pro 5G Smartphone to cart', exact: true }).click();
  await page.waitForURL('**/customer/product.html?id=1');
  await page.goBack({ waitUntil: 'networkidle' });
  await page.locator('.product-card').filter({ hasText: 'PulseBuds' }).getByRole('button', { name: 'Buy PulseBuds ANC Wireless Earbuds now', exact: true }).click();
  await page.waitForURL('**/customer/product.html?id=2');
  await page.goBack({ waitUntil: 'networkidle' });
  await page.locator('.product-title a').first().focus();
  await page.keyboard.press('Enter');
  await page.waitForURL('**/customer/product.html?id=1');
});

test('guest wishlist requests sign-in and logout hides catalog cart actions', async ({ page }) => {
  await setup(page, false);
  await expect(page.locator('#products .cart-add')).toHaveCount(0);
  await page.locator('#catalogSave1').click();
  await expect(page.locator('#guestAccountModal')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('wishlist'))).toBeNull();
  await page.getByRole('button', { name: 'Continue as Guest', exact: true }).click();
  await expect(page.locator('#guestAccountModal')).toBeHidden();
  await page.evaluate(value => localStorage.setItem('currentUser', JSON.stringify(value)), user);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.locator('#products .cart-add')).toHaveCount(12);
  await page.locator('#logoutButton').click();
  await expect(page.locator('#products .cart-add')).toHaveCount(0);
  await expect(page.locator('#loginLink')).toBeVisible();
});

test('catalog respects reduced motion while keeping shopping controls accessible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  const card = page.locator('.product-card').first();
  await card.hover();
  await expect(card).toHaveCSS('transform', 'none');
  await expect(card.locator('.product-image')).toHaveCSS('transform', 'none');
  await expect(card.locator('.catalog-save')).toHaveAttribute('title', 'Save to Wishlist');
  await expect(card.locator('.cart-add')).toHaveAttribute('title', 'Add to Cart');
  await expect(card.locator('.catalog-buy')).toHaveAttribute('title', 'Buy Now');
});

test('catalog loading, error retry and genuine empty catalog', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('catalogView', 'list'));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/products', async route => { await gate; await route.fulfill({ status: 500, json: { message: 'Unavailable' } }); });
  await page.goto('http://localhost:3000/customer/shop.html#products', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#productList')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.catalog-skeleton')).toHaveCount(6);
  expect((await page.locator('.catalog-skeleton').first().boundingBox()).height).toBeLessThanOrEqual(180.01);
  release();
  await expect(page.getByRole('heading', { name: 'Unable to load products' })).toBeVisible();
  await page.route('**/products', route => route.fulfill({ json: products }));
  await page.getByRole('button', { name: 'Try Again', exact: true }).click();
  await expect(page.locator('.product-card')).toHaveCount(12);
  await page.route('**/products', route => route.fulfill({ json: [] }));
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'No products available yet' })).toBeVisible();
  await expect(page.locator('#catalogPagination')).toBeHidden();
});

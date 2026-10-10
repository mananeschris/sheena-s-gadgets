const { test, expect } = require('@playwright/test');

const photo = '/uploads/catalog/photos/novacam-pro-5g-smartphone.png';
const secondPhoto = '/uploads/catalog/photos/aster-x1-5g-smartphone.png';
const product = {
  id: 9101, name: 'NovaCam Pro 5G Smartphone', category: 'Phones', price: 17990, stock: 12,
  description: 'AMOLED display, fast charging, and an everyday camera.\nChoose your preferred storage and finish.',
  image: photo, images: JSON.stringify([photo, secondPhoto]), average_rating: 4.5, review_count: 2,
  allow_layaway: 1, layaway_duration_months: 3,
  variants: JSON.stringify([{ name: 'Midnight Black - 12GB/256GB', price: 17990, stock: 8 }, { name: 'Frost Silver - 12GB/512GB', price: 21990, stock: 4 }, { name: 'Blue - 512GB', price: 21990, stock: 0 }])
};
const related = { id: 9102, name: 'Aster X1 5G Smartphone', category: 'Phones', price: 8990, stock: 12, image: secondPhoto };
const user = { id: 101, name: 'Chris Joseph B. Mananes', role: 'customer' };
const reviews = [
  { id: 1, customer_name: 'Maria', rating: 4, comment: 'Great camera.', created_at: '2026-09-09T08:00:00Z', images: JSON.stringify([photo]) },
  { id: 2, customer_name: 'Joseph', rating: 5, comment: 'Fast and easy to use.', created_at: '2026-09-08T08:00:00Z' }
];

async function setup(page, options = {}) {
  await page.addInitScript(({ user, recent }) => {
    if (sessionStorage.getItem('productDetailTestInitialized')) return;
    sessionStorage.setItem('productDetailTestInitialized', 'true');
    localStorage.clear();
    if (user) localStorage.setItem('currentUser', JSON.stringify(user));
    if (recent) localStorage.setItem('recentProducts', JSON.stringify([9102]));
  }, { user: options.guest ? null : user, recent: options.recent });
  await page.route('**/products', route => route.fulfill({ json: options.products || [product, related] }));
  await page.route('**/reviews/product/**', route => route.fulfill({ json: options.reviews || [] }));
  await page.route('**/notifications/customer/**', route => route.fulfill({ json: [] }));
  await page.route('**/auth/profile/**', route => route.fulfill({ json: user }));
}

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`product details layout and controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await setup(page);
    await page.goto('http://localhost:3000/customer/product.html?id=9101', { waitUntil: 'networkidle' });
    await expect(page.locator('.product-details h1')).toHaveText(product.name);
    await expect(page.locator('.variant-option')).toHaveCount(3);
    await expect(page.locator('.variant-option').last()).toBeDisabled();
    await expect(page.locator('.variant-option').last()).toContainText('Out of stock');
    await expect(page.locator('#mainImage')).toHaveCSS('object-fit', 'contain');
    expect(await page.locator('#mainImage').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(page.locator('#productDescriptionSection')).toBeVisible();
    await expect(page.locator('#recentProductsSection')).toBeHidden();
    await expect(page.locator('.review-empty')).toContainText('No reviews yet');
    await expect(page.locator('#decreaseQty')).toBeDisabled();
    const geometry = await page.evaluate(() => {
      const image = document.querySelector('.product-gallery').getBoundingClientRect();
      const details = document.querySelector('.product-details').getBoundingClientRect();
      const title = document.querySelector('.product-title-row').getBoundingClientRect();
      const rating = document.querySelector('.product-rating-link').getBoundingClientRect();
      const actions = [...document.querySelector('.product-actions-main').children].map(el => el.getBoundingClientRect());
      return {
        separate: image.right <= details.left || image.bottom <= details.top,
        titleClear: title.bottom <= rating.top,
        actionsInside: actions.every(box => box.left >= 0 && box.right <= innerWidth),
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    });
    expect(geometry).toEqual({ separate: true, titleClear: true, actionsInside: true, overflow: false });
    await page.screenshot({ path: `test-results/product-detail-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'View product image 2', exact: true }).click();
    await page.getByRole('button', { name: 'Increase quantity', exact: true }).click();
    await expect(page.locator('#productQty')).toHaveValue('2');
    await expect(page.locator('#productSubtotal')).toContainText('35,980');
    await page.locator('#saveProductButton').click();
    await expect(page.locator('#saveProductButton')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#productQty')).toHaveValue('2');
    await expect(page.locator('#mainImage')).toHaveAttribute('src', secondPhoto);
    await page.locator('.variant-option').nth(1).click();
    await expect(page.locator('.variant-option').nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.product-price')).toContainText('21,990');
    await expect(page.locator('#productSubtotal')).toContainText('43,980');
    await page.locator('#productQty').fill('999');
    await page.locator('#productQty').blur();
    await expect(page.locator('#productQty')).toHaveValue('4');
    await expect(page.locator('#increaseQty')).toBeDisabled();
    await page.getByRole('button', { name: `Add ${product.name} to cart`, exact: true }).click();
    await expect(page.locator('#cartPanel')).toBeVisible();
    const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('cart')));
    expect(cart[0]).toMatchObject({ product_id: 9101, variant_index: '1', quantity: 4 });
    expect(errors).toEqual([]);
  });
}

test('gallery zoom, navigation and Escape dismissal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.goto('http://localhost:3000/customer/product.html?id=9101', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Zoom product image', exact: true }).click();
  const modal = page.locator('#productImageModal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('#productImageCounter')).toHaveText('1 / 2');
  await expect(modal.getByRole('button', { name: 'Previous image', exact: true })).toBeDisabled();
  await modal.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(modal.locator('#productImageZoom')).toHaveText('150%');
  await expect(modal.locator('#zoomedProductImage')).toHaveClass('is-zoomed');
  await modal.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await modal.getByRole('button', { name: 'Next image', exact: true }).click();
  await expect(modal.locator('#productImageCounter')).toHaveText('2 / 2');
  await expect(modal.locator('#zoomedProductImage')).toHaveAttribute('src', secondPhoto);
  expect(await modal.locator('#zoomedProductImage').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: 'test-results/product-image-zoom-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(page.locator('#productZoomButton')).toBeFocused();
  await expect(page.locator('.product-thumbs button').nth(1)).toHaveAttribute('aria-pressed', 'true');
});

test('reviews sort, media preview and native recommendation links', async ({ page }) => {
  await setup(page, { reviews, recent: true });
  await page.goto('http://localhost:3000/customer/product.html?id=9101', { waitUntil: 'networkidle' });
  await expect(page.locator('.review-item')).toHaveCount(2);
  await expect(page.locator('.review-author strong').first()).toHaveText('Maria');
  await page.locator('#reviewSort').selectOption('highest');
  await expect(page.locator('.review-author strong').first()).toHaveText('Joseph');
  await page.getByRole('button', { name: 'View review photo', exact: true }).click();
  await expect(page.locator('#reviewMediaModal')).toBeVisible();
  await expect(page.locator('#reviewMediaViewer img')).toHaveAttribute('src', photo);
  await page.locator('#reviewMediaModal').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#recentProductsSection')).toBeVisible();
  await expect(page.locator('#relatedProducts a')).toHaveAttribute('href', '/customer/product.html?id=9102');
  await page.locator('#relatedProducts a').press('Enter');
  await expect(page).toHaveURL(/product.html\?id=9102/);
});

test('Buy Now retains variant and quantity without creating an order', async ({ page }) => {
  await setup(page);
  const orders = [];
  page.on('request', request => { if (request.method() === 'POST' && /orders/.test(request.url())) orders.push(request.url()); });
  await page.route('**/checkout.html', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Checkout</body></html>' }));
  await page.goto('http://localhost:3000/customer/product.html?id=9101', { waitUntil: 'networkidle' });
  await page.locator('.variant-option').nth(1).click();
  await page.getByRole('button', { name: 'Increase quantity', exact: true }).click();
  await page.getByRole('button', { name: 'Buy Now', exact: true }).click();
  await expect(page).toHaveURL(/checkout.html/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('checkout')))).toEqual({ product_id: 9101, variant_index: '1', quantity: 2 });
  expect(orders).toEqual([]);
});

test('guest actions and layaway terms retain account requirements', async ({ page }) => {
  await setup(page, { guest: true });
  await page.goto('http://localhost:3000/customer/product.html?id=9101', { waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: `Add ${product.name} to cart`, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Buy Now', exact: true }).click();
  await expect(page.locator('#guestAccountModal')).toBeVisible();
  await page.getByRole('button', { name: 'Continue as Guest', exact: true }).click();
  await expect(page.locator('#guestAccountModal')).toBeHidden();
  await page.evaluate(currentUser => { localStorage.setItem('currentUser', JSON.stringify(currentUser)); renderAccount(); renderProduct(); }, user);
  await page.getByRole('button', { name: 'Increase quantity', exact: true }).click();
  await page.getByRole('button', { name: 'Request Layaway', exact: true }).click();
  await expect(page.locator('#layawayModal')).toBeVisible();
  await expect(page.locator('#layawayAgreementText')).toContainText('3 months');
  await expect(page.locator('#productQty')).toHaveValue('1');
  await expect(page.locator('#productSubtotal')).toContainText('17,990');
});

test('unavailable products, image fallback and missing IDs', async ({ page }) => {
  await setup(page, { products: [{ ...product, stock: 0, variants: '[]', images: '[]', image: '/missing-photo.png' }] });
  await page.goto('http://localhost:3000/customer/product.html?id=9101', { waitUntil: 'networkidle' });
  await expect(page.locator('.stock-pill')).toHaveText('Unavailable');
  await expect(page.getByRole('button', { name: 'Buy Now', exact: true })).toBeDisabled();
  await expect(page.locator('#productQty')).toBeDisabled();
  await expect(page.locator('#productZoomButton')).toBeDisabled();
  await expect(page.locator('.product-gallery-stage .image-unavailable')).toBeVisible();
  await expect(page.locator('#relatedProductsSection')).toBeHidden();
  await page.goto('http://localhost:3000/customer/product.html?id=404', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Product not found', exact: true })).toBeVisible();
  await expect(page.locator('#productReviewsSection')).toBeHidden();
});

test('loading state and product/review retry', async ({ page }) => {
  await setup(page);
  let attempts = 0;
  let releaseFirstResponse;
  const firstResponse = new Promise(resolve => { releaseFirstResponse = resolve; });
  await page.route('**/products', async route => {
    attempts++;
    if (attempts === 1) {
      await firstResponse;
      return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
    }
    return route.fulfill({ json: [product] });
  });
  await page.route('**/reviews/product/**', route => route.fulfill({ status: 503, json: { message: 'Unavailable' } }));
  await page.goto('http://localhost:3000/customer/product.html?id=9101', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#productPageBody')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('status')).toHaveText('Loading product...');
  releaseFirstResponse();
  await expect(page.getByRole('heading', { name: 'Unable to load this product', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.product-details h1')).toHaveText(product.name);
  await expect(page.locator('#productReviews')).toContainText('Reviews are unavailable right now');
  await page.route('**/reviews/product/**', route => route.fulfill({ json: reviews }));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('.review-item')).toHaveCount(2);
  await expect(page.locator('#productPageBody')).toHaveAttribute('aria-busy', 'false');
});

test('real catalog images render at desktop and mobile', async ({ page }) => {
  await page.route('**/reviews/product/**', route => route.fulfill({ json: [] }));
  await page.route('**/notifications/customer/**', route => route.fulfill({ json: [] }));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('http://localhost:3000/customer/product.html?id=29', { waitUntil: 'networkidle' });
    await expect(page.locator('.product-details h1')).toHaveText('NovaCam Pro 5G Smartphone');
    expect(await page.locator('#mainImage').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: `test-results/product-real-${width}.png`, fullPage: true });
  }
});

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
async function setup(page, options = {}) {
  const writes = [], errors = [];
  let attempts = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('currentUser', JSON.stringify({ id: 11, name: 'Chris Mananes', role: 'customer' })));
  await page.route('**/delivery-chat/**', route => route.fulfill({ json: { threads: [], unread_count: 0 } }));
  await page.route('**/orders/customer/11', route => route.fulfill({ json: [{ id: 56, product_name: options.long ? 'HyperCharge Premium Ultra Fast 65W Charger With Multiple USB-C And USB-A Ports' : 'HyperCharge 65W GaN Charger', variant_name: 'Dual USB-C', quantity: 1, product_image: '/assets/hero-iphone-style.png', status: options.pending ? 'pending' : 'delivered', total_price: 1161 }] }));
  await page.route('**/reviews', route => { writes.push(route.request().postDataBuffer().toString()); attempts++; return route.fulfill({ status: options.retry && attempts === 1 ? 503 : 200, json: { message: options.retry && attempts === 1 ? 'Please try again.' : 'Review submitted.' } }); });
  await page.goto('http://localhost:3000/customer/review.html?order_id=56');
  return { writes, errors, photo: fs.readFileSync(path.join(__dirname, '../public/assets/hero-iphone-style.png')) };
}
for (const width of [320, 390, 768, 1440]) {
  test(`review page is clean and responsive at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { errors } = await setup(page, { long: true });
    await expect(page.getByRole('button', { name: 'Submit Review' })).toBeEnabled();
    await expect(page.locator('[data-delivery-inbox]')).toHaveCount(0);
    const purchase = await page.locator('.review-purchase').boundingBox();
    const form = await page.locator('#reviewForm').boundingBox();
    if (width > 700) expect(purchase.x + purchase.width).toBeLessThan(form.x);
    else {
      expect(purchase.y + purchase.height).toBeLessThan(form.y);
      const image = await page.locator('.review-product-image').boundingBox();
      const copy = await page.locator('.order-copy').boundingBox();
      expect(copy.x - image.x - image.width).toBeGreaterThanOrEqual(13);
    }
    await expect(page.getByRole('radio')).toHaveCount(5);
    await expect(page.getByRole('radio', { name: '5 stars' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: '3 stars' }).click();
    await expect(page.locator('#ratingDescription')).toHaveText('Good');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('radio', { name: '2 stars' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#orderBox')).not.toContainText('Order ID');
    await expect.poll(() => page.locator('#orderBox img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await expect(page.locator('.shell')).toHaveCSS('border-top-width', '0px');
    await expect(page.locator('.review-card')).toHaveCSS('box-shadow', 'none');
    await page.screenshot({ path: `test-results/customer-review-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
test('photo previews can be removed and failed submissions preserve the draft', async ({ page }) => {
  const { photo, writes, errors } = await setup(page, { retry: true });
  await page.getByLabel('Your Review').fill('Good quality charger.');
  await page.getByRole('radio', { name: '4 stars' }).click();
  await page.locator('#images').setInputFiles([{ name: 'one.png', mimeType: 'image/png', buffer: photo }, { name: 'two.png', mimeType: 'image/png', buffer: photo }]);
  await expect(page.locator('#imagePreview img')).toHaveCount(2);
  await expect(page.locator('#reviewPhotoCount')).toHaveText('2 of 5 added');
  await page.getByRole('button', { name: 'Remove photo 1' }).click();
  await expect(page.locator('#imagePreview img')).toHaveCount(1);
  await expect(page.locator('#reviewPhotoCount')).toHaveText('1 of 5 added');
  await page.getByRole('button', { name: 'Submit Review' }).click();
  await expect(page.getByRole('alert')).toHaveText('Please try again.');
  await expect(page.getByLabel('Your Review')).toHaveValue('Good quality charger.');
  await expect(page.getByRole('button', { name: 'Submit Review' })).toBeEnabled();
  expect(writes[0]).toContain('filename="two.png"');
  expect(writes[0]).not.toContain('filename="one.png"');
  expect(writes[0]).toContain('\r\n4\r\n');
  await page.getByRole('button', { name: 'Submit Review' }).click();
  await expect(page).toHaveURL(/customer\/profile.html/);
  expect(writes).toHaveLength(2);
  expect(errors).toEqual([]);
});
test('photo limit and invalid uploads do not overwrite accepted photos', async ({ page }) => {
  const { photo } = await setup(page);
  await page.locator('#images').setInputFiles(Array.from({ length: 6 }, (_, i) => ({ name: `${i}.png`, mimeType: 'image/png', buffer: photo })));
  await expect(page.getByRole('alert')).toHaveText('You can add up to 5 photos.');
  await expect(page.locator('#imagePreview img')).toHaveCount(0);
  await page.locator('#images').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') });
  await expect(page.getByRole('alert')).toContainText('Choose image files');
});
test('undelivered orders cannot submit a review', async ({ page }) => {
  const { writes } = await setup(page, { pending: true });
  await expect(page.locator('#orderBox')).toContainText('Only delivered orders');
  await expect(page.getByRole('button', { name: 'Submit Review' })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

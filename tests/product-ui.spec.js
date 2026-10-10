const { test, expect } = require('@playwright/test');

const products = [
  {
    id: 9101,
    name: 'iPhone 15 Pro Max 256GB',
    description: 'Premium smartphone with titanium build, pro camera system, and all-day battery life.',
    price: 68990,
    stock: 8,
    category: 'Phones',
    image: '/assets/hero-iphone-style.png',
    images: JSON.stringify(['/assets/hero-iphone-style.png', '/assets/hero-iphone-style.png']),
    variants: JSON.stringify([
      { name: 'Natural Titanium - 256GB', price: 68990, stock: 4 },
      { name: 'Black Titanium - 512GB', price: 78990, stock: 3 }
    ]),
    average_rating: 4.8,
    review_count: 12
  },
  {
    id: 9102,
    name: 'Wireless Noise Cancelling Earbuds',
    description: 'Compact earbuds with clean audio, ANC, and pocket-friendly charging case.',
    price: 2490,
    stock: 14,
    category: 'Audio',
    image: '/assets/hero-iphone-style.png',
    images: JSON.stringify(['/assets/hero-iphone-style.png']),
    variants: JSON.stringify([]),
    average_rating: 4.5,
    review_count: 7
  }
];

const user = {
  id: 777001,
  role: 'customer',
  name: 'Test Customer',
  email: 'customer@example.com'
};

test.describe('product page redesign', () => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 1000 }
  ]) {
    test(`product layout at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript(currentUser => localStorage.setItem('currentUser', JSON.stringify(currentUser)), user);
      await page.route('**/products', route => route.fulfill({ json: products }));
      await page.route('**/auth/profile/**', route => route.fulfill({ json: user }));
      await page.route('**/reviews/product/**', route => route.fulfill({ json: [] }));
      await page.route('**/notifications/customer/**', route => route.fulfill({ json: [] }));

      const errors = [];
      page.on('pageerror', error => errors.push(error.message));

      await page.goto('http://localhost:3000/customer/product.html?id=9101', { waitUntil: 'networkidle' });

      await expect(page.locator('.product-details h1')).toContainText('iPhone 15 Pro Max');
      await expect(page.locator('.variant-option')).toHaveCount(2);
      await expect(page.locator('.review-panel')).toBeVisible();
      await expect(page.locator('.mini-product')).toHaveCount(1);

      await page.locator('.variant-option').nth(1).click();
      await expect(page.locator('.product-price')).toContainText('78,990');

      await page.getByRole('button', { name: 'Add iPhone 15 Pro Max 256GB to cart', exact: true }).click();
      await expect(page.locator('#cartPanel')).not.toHaveClass(/d-none/);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
      expect(errors).toEqual([]);
    });
  }
});

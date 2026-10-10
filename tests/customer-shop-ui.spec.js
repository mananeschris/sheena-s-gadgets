const { test, expect } = require('@playwright/test');

const products = [
  {
    id: 9001,
    name: 'iPhone 15 Pro Max 256GB',
    description: 'Premium smartphone with titanium build, pro camera system, and all-day battery life.',
    price: 68990,
    stock: 8,
    category: 'Phones',
    image: '/assets/hero-iphone-style.png',
    images: JSON.stringify(['/assets/hero-iphone-style.png']),
    variants: JSON.stringify([
      { name: 'Natural Titanium - 256GB', price: 68990, stock: 4 },
      { name: 'Black Titanium - 512GB', price: 78990, stock: 4 }
    ]),
    average_rating: 4.8,
    review_count: 12
  },
  {
    id: 9002,
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

test.describe('customer shop redesign', () => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'laptop', width: 1280, height: 900 },
    { name: 'tablet', width: 1024, height: 900 },
    { name: 'mobile', width: 390, height: 1000 }
  ]) {
    test(`shop layout at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.route('**/products', route => route.fulfill({ json: products }));
      await page.route('**/notifications/customer/**', route => route.fulfill({ json: [] }));

      const errors = [];
      page.on('pageerror', error => errors.push(error.message));

      await page.addInitScript(() => {
        localStorage.setItem('currentUser', JSON.stringify({
          id: 101,
          name: 'Chris Joseph B. Mananes',
          email: 'customer@example.com',
          role: 'customer'
        }));
        localStorage.removeItem('cart');
      });

      await page.goto('http://localhost:3000/customer/shop.html', { waitUntil: 'networkidle' });

      await expect(page.locator('.hero h1')).toContainText("Sheena's Gadgets");
      await expect(page.locator('.product-card')).toHaveCount(2);
      await expect(page.locator('.shop-toolbar')).toHaveCSS('position', 'static');
      if (viewport.width > 1200) {
        await expect(page.locator('.nav-actions')).toHaveCSS('flex-wrap', 'nowrap');
        await expect(page.locator('#logoutButton')).toBeVisible();
        expect(await page.locator('#accountLabel').evaluate(el => getComputedStyle(el).color)).not.toBe('rgb(221, 221, 221)');
      }
      if (viewport.width > 720) {
        const layout = await page.locator('.store-nav').evaluate(nav => {
          const brand = nav.querySelector('.brand').getBoundingClientRect();
          const actions = nav.querySelector('.nav-actions');
          const boxes = [...actions.children].map(el => el.getBoundingClientRect()).filter(r => r.width);
          return {
            brandClear: brand.right <= boxes[0].left || brand.bottom <= boxes[0].top,
            controlsClear: boxes.every((r, i) => !i || r.left >= boxes[i - 1].right),
            controlsInside: boxes.every(r => r.right <= innerWidth && r.left >= 0),
            sameRow: boxes.every(r => Math.abs((r.top + r.bottom) / 2 - (boxes[0].top + boxes[0].bottom) / 2) < 2)
          };
        });
        expect(layout).toEqual({ brandClear: true, controlsClear: true, controlsInside: true, sameRow: true });
      }
      await page.screenshot({ path: `test-results/shop-header-${viewport.name}.png` });
      await expect(page.locator('#cartPanel')).toHaveClass(/d-none/);

      await page.locator('.cart-add').last().click();
      await expect(page.locator('#cartPanel')).not.toHaveClass(/d-none/);
      await expect(page.locator('.cart-item')).toHaveCount(1);
      await expect(page.locator('.cart-thumb img')).toBeVisible();

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
      expect(errors).toEqual([]);
    });
  }
});

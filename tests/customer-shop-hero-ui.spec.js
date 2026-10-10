const { test, expect } = require('@playwright/test');

const products = [
  { id: 91, name: 'NovaCam Pro 5G Smartphone', price: 17990, stock: 10, category: 'Phones', image: '/assets/hero-iphone-style.png' },
  { id: 92, name: 'Wireless Earbuds', price: 2490, stock: 6, category: 'Audio', image: '/assets/hero-iphone-style.png' }
];

for (const viewport of [
  { width: 320, height: 667 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 2560, height: 1080 }
]) {
  test(`shop hero framing and actions at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => localStorage.setItem('currentUser', JSON.stringify({ id: 101, role: 'customer', name: 'Chris Joseph B. Mananes' })));
    await page.route('**/products', route => route.fulfill({ json: products }));
    await page.route('**/notifications/customer/**', route => route.fulfill({ json: [] }));
    await page.goto('http://localhost:3000/customer/shop.html', { waitUntil: 'networkidle' });
    const hero = page.getByRole('region', { name: "Sheena's Gadgets" });
    await expect(hero.getByRole('heading', { level: 1 })).toContainText('& Accessories Shop');
    await expect(page.locator('#heroProductCount')).toHaveText('2');
    await expect(page.locator('#heroStockCount')).toHaveText('2');
    await expect(page.locator('.hero-panel')).toHaveCount(0);
    const picture = hero.getByRole('img');
    expect(await picture.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await picture.evaluate(img => getComputedStyle(img).filter)).toBe('none');
    const boxes = await page.evaluate(() => {
      const hero = document.querySelector('.shop-hero').getBoundingClientRect();
      const image = document.querySelector('.hero-art').getBoundingClientRect();
      const title = document.querySelector('#shopHeroTitle').getBoundingClientRect();
      const copy = document.querySelector('.hero-text').getBoundingClientRect();
      const actions = document.querySelector('.hero-actions').getBoundingClientRect();
      return {
        imageCoversHero: Math.abs(image.width - hero.width) < 1 && Math.abs(image.height - hero.height) < 1,
        textInside: title.left >= hero.left && title.right <= hero.right,
        textClear: title.bottom <= copy.top && copy.bottom <= actions.top,
        catalogTop: document.querySelector('#products').getBoundingClientRect().top,
        overflow: document.documentElement.scrollWidth > innerWidth
      };
    });
    expect(boxes.imageCoversHero).toBe(true);
    expect(boxes.textInside).toBe(true);
    expect(boxes.textClear).toBe(true);
    expect(boxes.catalogTop).toBeLessThan(viewport.height - 24);
    expect(boxes.overflow).toBe(false);
    await page.screenshot({ path: `test-results/shop-hero-${viewport.width}.png` });
    const services = page.getByRole('region', { name: 'Shop services' });
    await expect(services.locator('.shop-service > svg')).toHaveCount(3);
    expect((await services.boundingBox()).height).toBeLessThan(125);
    await expect(services).toContainText('COD, GCash & installment');

    const searchAction = hero.getByRole('button', { name: 'Search products in the catalog', exact: true });
    await expect(searchAction).toHaveAttribute('title', 'Search Products');
    await searchAction.click();
    const search = page.getByRole('searchbox', { name: 'Search products', exact: true });
    await expect(search).toBeFocused();
    await expect.poll(() => search.evaluate(el => {
      const box = el.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight;
    })).toBe(true);
    await search.fill('earbuds');
    await expect(page.locator('.product-card')).toHaveCount(1);
    await hero.getByRole('link', { name: 'Browse Products', exact: true }).click();
    await expect(page).toHaveURL(/#products$/);
  });
}

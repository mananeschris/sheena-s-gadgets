const { test, expect } = require('@playwright/test');

const products = [{ id: 981, name: 'NovaCam Smartphone', category: 'Phones', price: 17990, stock: 10, image: '/assets/hero-iphone-style.png' }];
const customer = { id: 101, role: 'customer', name: 'Chris Joseph Benjamin Alexander Mananes', email: 'customer@example.com' };

async function openPage(page, target, loggedIn) {
  await page.addInitScript(user => {
    if (sessionStorage.getItem('headerTestInitialized')) return;
    sessionStorage.setItem('headerTestInitialized', 'true');
    localStorage.removeItem('cart');
    if (user) localStorage.setItem('currentUser', JSON.stringify(user));
    else localStorage.removeItem('currentUser');
  }, loggedIn ? customer : null);
  await page.route('**/products', route => route.fulfill({ json: products }));
  await page.route('**/auth/profile/**', route => route.fulfill({ json: customer }));
  await page.route('**/reviews/product/**', route => route.fulfill({ json: [] }));
  await page.route('**/notifications/customer/**', route => route.fulfill({ json: [] }));
  await page.goto(`http://localhost:3000/customer/${target === 'shop' ? 'shop.html' : 'product.html?id=981'}`, { waitUntil: 'networkidle' });
}

for (const target of ['shop', 'product']) {
  for (const width of [320, 390, 768, 1024, 1440]) {
    test(`${target} customer header at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await openPage(page, target, true);
      const nav = page.getByRole('navigation', { name: 'Customer navigation' });
      await expect(nav.locator('.brand-copy')).toContainText("Sheena's");
      expect(await nav.locator('.brand-copy').evaluate(el => {
        const name = el.querySelector('strong').getBoundingClientRect();
        const detail = el.querySelector('small').getBoundingClientRect();
        return detail.top >= name.bottom;
      })).toBe(true);
      expect(await nav.locator('.brand-logo').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      await expect(page.locator('#accountAvatar')).toHaveText('CM');
      await expect(page.locator('#profileLink')).toHaveAccessibleName(`Profile: ${customer.name}`);
      await expect(page.locator('#loginLink')).toBeHidden();
      await expect(page.locator('#signupLink')).toBeHidden();
      for (const id of ['cartButton', 'notificationButton', 'profileLink', 'logoutButton']) {
        await expect(page.locator(`#${id}`)).toBeVisible();
      }
      const layout = await nav.evaluate(el => {
        const actions = [...el.querySelector('.nav-actions').children].map(child => child.getBoundingClientRect()).filter(box => box.width);
        return {
          clear: actions.every((box, index) => !index || box.left >= actions[index - 1].right),
          inside: actions.every(box => box.left >= 0 && box.right <= innerWidth),
          overflow: document.documentElement.scrollWidth > innerWidth
        };
      });
      expect(layout).toEqual({ clear: true, inside: true, overflow: false });
      if (width > 850) await expect(page.locator('#accountLabel')).toHaveText(customer.name);
      else await expect(page.locator('.nav-account-copy')).toBeHidden();
      await page.locator('#cartButton').hover();
      await expect.poll(() => page.locator('#cartButton').evaluate(el => getComputedStyle(el, '::after').visibility)).toBe('visible');
      await page.locator('#cartButton').click();
      await expect(page.locator('#cartPanel')).toBeVisible();
      await page.locator('#cartButton').click();
      await page.locator('#notificationButton').click();
      await expect(page.locator('#notificationPanel')).toBeVisible();
      await page.locator('#notificationButton').click();
      await page.screenshot({ path: `test-results/customer-header-${target}-${width}.png` });
      expect(errors).toEqual([]);
    });
  }
  test(`${target} guest header and logout`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await openPage(page, target, true);
    await page.evaluate(() => logoutCustomer());
    await expect(page.locator('#loginLink')).toBeVisible();
    await expect(page.locator('#signupLink')).toBeVisible();
    await expect(page.locator('#profileLink')).toBeHidden();
    await expect(page.locator('#cartButton')).toBeHidden();
    await expect(page.locator('#notificationButton')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `test-results/customer-header-${target}-guest.png` });
  });
}

test('shared logo is an SG mark on customer pages', async ({ page }) => {
  const response = await page.request.get('http://localhost:3000/assets/sheena-mark.svg');
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain('SG monogram');
  for (const path of ['/customer/profile.html', '/checkout.html', '/customer/order.html', '/auth.html']) {
    const html = await (await page.request.get('http://localhost:3000' + path)).text();
    expect(html).toContain('/assets/sheena-mark.svg');
  }
});

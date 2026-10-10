const { test, expect } = require('@playwright/test');

const plans = [
  { id: 91, product_name: 'NovaCam Pro 5G Smartphone', variant_name: 'Midnight Black 256GB', quantity: 1, total_amount: 17990, amount_paid: 3990, balance: 14000, due_date: '2027-01-15', status: 'active' },
  { id: 92, product_name: 'SlatePad 10.4 Tablet', quantity: 1, total_amount: 14990, amount_paid: 14990, balance: 0, status: 'ready_for_release' },
  { id: 93, product_name: 'Wireless Earbuds', total_amount: 2490, amount_paid: 500, balance: 1990, status: 'cancelled' },
  { id: 94, product_name: 'Travel Charger', total_amount: 1000, amount_paid: 0, balance: 1000, status: 'pending_downpayment', payment_checkout_url: '/payment-result.html?payment=94' },
  { id: 95, product_name: 'Tablet Keyboard', total_amount: 3000, amount_paid: 3000, balance: 0, status: 'delivered' }
];

for (const width of [1440, 390]) {
  test(`layaway overview and payment at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.addInitScript(() => localStorage.setItem('currentUser', JSON.stringify({
      id: 101, name: 'Chris Joseph B. Mananes', email: 'customer@example.com', role: 'customer'
    })));
    await page.route('**/layaways/customer/101', route => route.fulfill({ json: plans }));
    await page.goto('http://localhost:3000/customer/profile.html#layaways', { waitUntil: 'networkidle' });
    await expect(page.locator('.layaway-plan')).toHaveCount(5);
    await expect(page.locator('#layawayOverview')).toContainText('15,000.00');
    await expect(page.locator('.layaway-plan').first().locator('h3')).toHaveText(plans[0].product_name);
    await expect(page.getByRole('button', { name: 'Make Payment' })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Pay Downpayment' })).toHaveCount(1);
    await expect(page.locator('.layaway-plan').filter({ hasText: 'Cancelled' }).locator('button, a')).toHaveCount(0);
    await page.locator('#layawaysSection').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/layaways-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.locator('#layawayFilter').selectOption('ready');
    await expect(page.locator('.layaway-plan')).toHaveCount(1);
    await expect(page.locator('.layaway-plan')).toContainText('SlatePad 10.4 Tablet');
    await expect(page.locator('.layaway-plan progress')).toHaveAttribute('value', '14990');
    await page.locator('#layawayFilter').selectOption('completed');
    await expect(page.locator('.layaway-plan')).toContainText('Tablet Keyboard');
    await page.locator('#layawayFilter').selectOption('ongoing');
    await expect(page.locator('.layaway-plan')).toHaveCount(2);
    await page.getByRole('button', { name: 'Make Payment' }).click();
    await expect(page.getByRole('dialog')).toContainText(plans[0].product_name);
    const amount = page.getByRole('spinbutton', { name: 'Payment amount' });
    await expect(amount).toHaveAttribute('max', '14000');
    await amount.fill('15000');
    expect(await amount.evaluate(el => el.validity.rangeOverflow)).toBe(true);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => { layaways = []; renderLayaways(); });
    await expect(page.locator('#layawayList')).toContainText('No layaway plans yet');
    await expect(page.locator('#layawayFilter')).toBeHidden();
    await expect(page.locator('#layawayOverview')).toBeHidden();
    await page.route('**/layaways/customer/101', route => route.fulfill({ status: 500, json: { message: 'Unavailable' } }));
    await page.evaluate(() => loadLayaways());
    await expect(page.locator('#layawayList')).toContainText('Unable to load layaway plans');
    await page.route('**/layaways/customer/101', route => route.fulfill({ json: plans }));
    await page.getByRole('button', { name: 'Try Again' }).click();
    await expect(page.getByRole('button', { name: 'Make Payment' })).toBeVisible();
    await page.route('**/layaways/91/payments/checkout', route => route.fulfill({ json: { payment_checkout_url: '/payment-result.html?test=layaway' } }));
    await page.route('**/payment-result.html?test=layaway', route => route.fulfill({ contentType: 'text/html', body: '<title>Payment test</title>' }));
    await page.getByRole('button', { name: 'Make Payment' }).click();
    await amount.fill('500');
    const request = page.waitForRequest(req => req.url().includes('/layaways/91/payments/checkout') && req.method() === 'POST');
    await page.getByRole('button', { name: 'Continue to Payment' }).click();
    expect((await request).postDataJSON()).toEqual({ user_id: 101, amount: 500, payment_method: 'gcash' });
    await page.waitForURL('**/payment-result.html?test=layaway');
  });
}

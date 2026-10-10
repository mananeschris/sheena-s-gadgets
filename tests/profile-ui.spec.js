const { test, expect } = require('@playwright/test');

const user = {
  id: 777001,
  role: 'customer',
  name: 'Chris Joseph B. Mananes',
  email: 'customer@example.com',
  phone: '09123456789'
};

const orders = [
  {
    id: 42,
    order_reference: 'SG-1042',
    product_id: 9001,
    product_name: 'iPhone 15 Pro Max 256GB',
    variant_name: 'Natural Titanium - 256GB',
    quantity: 1,
    total_price: 68990,
    status: 'processing',
    payment_method: 'gcash',
    payment_status: 'paid',
    created_at: '2026-09-01T08:00:00Z',
    product_image: '/assets/hero-iphone-style.png',
    items: [{ product_name: 'iPhone 15 Pro Max 256GB', variant_name: 'Natural Titanium - 256GB', quantity: 1, unit_price: 68990, subtotal: 68990, product_image: '/assets/hero-iphone-style.png' }]
  },
  {
    id: 43,
    product_name: 'NovaCam Pro 5G Smartphone',
    quantity: 1,
    total_price: 17990,
    status: 'pending',
    payment_method: 'gcash',
    payment_provider: 'manual_gcash',
    payment_status: 'for_verification',
    payment_proof_image: '/assets/gcash-qr-placeholder.svg',
    created_at: '2026-09-02T08:00:00Z',
    product_image: '/assets/hero-iphone-style.png',
    items: [{ product_name: 'NovaCam Pro 5G Smartphone', quantity: 1, unit_price: 17990, subtotal: 17990 }]
  },
  {
    id: 44,
    product_name: 'SlatePad 10.4 Tablet',
    quantity: 1,
    total_price: 14990,
    status: 'pending',
    payment_method: 'gcash',
    payment_provider: 'manual_gcash',
    payment_status: 'paid',
    created_at: '2026-09-03T08:00:00Z',
    product_image: '/assets/hero-iphone-style.png',
    items: [{ product_name: 'SlatePad 10.4 Tablet', quantity: 1, unit_price: 14990, subtotal: 14990 }]
  },
  {
    id: 45,
    product_name: 'Legacy GCash Order',
    quantity: 1,
    total_price: 1200,
    status: 'pending',
    payment_method: 'gcash',
    payment_provider: 'manual_gcash',
    payment_status: 'pending_payment',
    created_at: '2026-09-04T08:00:00Z',
    product_image: '/assets/hero-iphone-style.png',
    items: [{ product_name: 'Legacy GCash Order', quantity: 1, unit_price: 1200, subtotal: 1200 }]
  }
];

const addresses = [{
  id: 81,
  label: 'Home',
  recipient_name: 'Chris Joseph B. Mananes',
  phone: '09123456789',
  address: 'Sogod',
  city: 'Bacacay',
  province: 'Albay',
  postal_code: '4509',
  is_default: 1
}];

test.describe('profile order center redesign', () => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'tablet', width: 768, height: 1000 },
    { name: 'mobile', width: 390, height: 1000 }
  ]) {
    test(`profile layout at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript(currentUser => localStorage.setItem('currentUser', JSON.stringify(currentUser)), user);
      await page.route('**/auth/profile/**', route => route.fulfill({ json: user }));
      await page.route('**/orders/customer/**', route => route.fulfill({ json: orders }));
      await page.route('**/customer/addresses/**', route => route.fulfill({ json: addresses }));
      await page.route('**/notifications/customer/**', route => route.fulfill({ json: [] }));
      await page.route('**/installments/**', route => route.fulfill({ json: [] }));
      await page.route('**/soa/**', route => route.fulfill({ json: { statement: null } }));
      await page.route('**/products', route => route.fulfill({ json: [] }));

      const errors = [];
      page.on('pageerror', error => errors.push(error.message));

      await page.goto('http://localhost:3000/customer/profile.html', { waitUntil: 'networkidle' });

      await expect(page.locator('.profile-navigation')).toBeVisible();
      await expect(page.locator('.profile-nav-group')).toHaveCount(4);
      await expect(page.locator('.profile-navigation a svg')).toHaveCount(9);
      await expect(page.locator('.customer-avatar svg')).toBeVisible();
      await expect(page.locator('#ordersList')).toContainText('iPhone 15 Pro Max');
      await expect(page.locator('#totalOrders')).toContainText('4');
      await expect(page.locator('#ordersList')).toContainText('Waiting for Admin Approval');
      await expect(page.locator('#ordersList')).toContainText('Order Placed');
      await expect(page.locator('[data-filter="proof-needed"]')).toHaveCount(0);
      await page.locator('[data-filter="to-pay"]').click();
      await expect(page.locator('#ordersList')).toContainText('Legacy GCash Order');
      await expect(page.locator('#ordersList')).toContainText('Payment Needed');
      await page.locator('[data-filter="all"]').click();
      await expect(page.locator('.profile-main-header h1')).toHaveText('Account Center');
      await page.screenshot({ path: `test-results/profile-redesign-${viewport.name}.png`, fullPage: true });

      await page.locator('[data-profile-view="payments"]').click();
      await expect(page.locator('#paymentActivitySection')).toBeVisible();
      await expect(page.locator('#statementSection')).toBeVisible();
      await expect(page.locator('#installmentsSection')).toBeHidden();
      await page.screenshot({ path: `test-results/profile-payments-${viewport.name}.png`, fullPage: true });

      await page.locator('[data-profile-view="installments"]').click();
      await expect(page.locator('#installmentsSection')).toBeVisible();
      await expect(page.locator('#paymentActivitySection')).toBeHidden();

      await page.locator('[data-profile-view="addresses"]').click();
      await expect(page.locator('#addressBookSection')).toBeVisible();
      await page.locator('.address-card').getByRole('button', { name: /Delete/ }).click();
      await expect(page.locator('#appDialogLayer')).toBeVisible();
      await expect(page.locator('#appDialogTitle')).toHaveText('Delete saved address?');
      await expect(page.locator('#appDialogDetails')).toContainText('Home');
      await page.locator('#appDialogLayer .app-dialog-cancel').click();
      await expect(page.locator('#appDialogLayer')).toBeHidden();
      await page.locator('[data-profile-view="account"]').click();
      await expect(page.locator('#accountSettingsSection')).toBeVisible();
      await expect(page.locator('#accountSettingsSection .settings-section-title > svg')).toHaveCount(3);
      await page.screenshot({ path: `test-results/profile-account-${viewport.name}.png`, fullPage: true });

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
      expect(errors).toEqual([]);
    });
  }
});

test('saving a location opened from checkout returns to checkout', async ({ page }) => {
  await page.addInitScript(currentUser => {
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    localStorage.setItem('checkout', JSON.stringify({ product_id: 999999, quantity: 1 }));
  }, user);
  await page.route('**/auth/profile/**', route => route.fulfill({ json: { user } }));
  await page.route('**/orders/customer/**', route => route.fulfill({ json: [] }));
  await page.route('**/notifications/customer/**', route => route.fulfill({ json: [] }));
  await page.route('**/installments/**', route => route.fulfill({ json: [] }));
  await page.route('**/soa/**', route => route.fulfill({ json: { statement: null } }));
  await page.route('**/products', route => route.fulfill({ json: [] }));
  await page.route('**/customer/addresses**', async route => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ json: { message: 'Address saved.', addresses: [] } });
      return;
    }
    await route.fulfill({ json: [] });
  });

  await page.goto('http://localhost:3000/customer/profile.html?returnTo=%2Fcheckout.html#addresses');
  await expect(page.locator('#addressBookSection')).toBeVisible();
  await page.locator('#addressLabel').fill('Home');
  await page.locator('#addressRecipient').fill(user.name);
  await page.locator('#addressPhone').fill(user.phone);
  await page.locator('#addressLine').fill('Sogod, Bacacay, Albay');
  await page.evaluate(() => {
    document.getElementById('addressLatitude').value = '13.294';
    document.getElementById('addressLongitude').value = '123.79';
  });

  const checkoutNavigation = page.waitForURL(url => url.pathname === '/checkout.html', { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Save Address' }).click();
  await checkoutNavigation;
  expect(new URL(page.url()).pathname).toBe('/checkout.html');
});

test('deleting the last saved address removes it from the address book', async ({ page }) => {
  await page.addInitScript(currentUser => localStorage.setItem('currentUser', JSON.stringify(currentUser)), user);
  await page.route('**/auth/profile/**', route => route.fulfill({ json: { user } }));
  await page.route('**/orders/customer/**', route => route.fulfill({ json: [] }));
  await page.route('**/notifications/customer/**', route => route.fulfill({ json: [] }));
  await page.route('**/installments/**', route => route.fulfill({ json: [] }));
  await page.route('**/soa/**', route => route.fulfill({ json: { statement: null } }));
  await page.route('**/products', route => route.fulfill({ json: [] }));

  let remainingAddresses = [{ ...addresses[0], latitude: 13.294, longitude: 123.79 }];
  await page.route('**/customer/addresses/**', async route => {
    if (route.request().method() === 'DELETE') {
      remainingAddresses = [];
      await route.fulfill({ json: { message: 'Address deleted.', addresses: [] } });
      return;
    }
    await route.fulfill({ json: remainingAddresses });
  });

  await page.goto('http://localhost:3000/customer/profile.html#addresses');
  await expect(page.locator('.address-card')).toHaveCount(1);
  await page.locator('.address-card').getByRole('button', { name: /Delete/ }).click();
  await page.locator('#appDialogLayer .app-dialog-submit').click();
  await expect(page.locator('.address-card')).toHaveCount(0);
  await expect(page.locator('#addressList')).toContainText('No saved address yet');
});

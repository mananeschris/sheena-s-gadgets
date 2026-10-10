const { test, expect } = require('@playwright/test');
const { mockStoreSession } = require('./helpers/store-session-ui.cjs');

const adminUser = { id: 1, role: 'admin', name: 'Admin User', email: 'admin@example.com' };
const orders = [
  {
    id: 34,
    product_name: 'Aster X1 5G Smartphone',
    quantity: 1,
    total_price: 8990,
    status: 'pending',
    payment_method: 'gcash',
    payment_provider: 'manual_gcash',
    payment_status: 'for_verification',
    gcash_reference: 'GCASH123456789',
    payment_proof_image: '/assets/gcash-qr-placeholder.svg',
    payment_submitted_at: '2026-09-15T10:00:00.000Z',
    customer_name: 'Chris',
    customer_email: 'customer@example.com',
    created_at: '2026-09-15T09:40:00.000Z',
    product_image: '/assets/hero-iphone-style.png',
    items: [
      {
        product_name: 'Aster X1 5G Smartphone',
        variant_name: 'Graphite Black - 8GB/128GB',
        quantity: 1,
        unit_price: 8990,
        subtotal: 8990,
        product_image: '/assets/hero-iphone-style.png'
      }
    ]
  }
];

async function setupAdminDashboard(page, routeOrders = orders) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(user => localStorage.setItem('currentUser', JSON.stringify(user)), adminUser);
  await page.route('**/products**', route => route.fulfill({ json: [] }));
  await page.route('**/orders**', route => route.fulfill({ json: routeOrders }));
  await page.route('**/admin/alerts**', route => route.fulfill({ json: [] }));
  await page.route('**/admin/inventory-movements**', route => route.fulfill({ json: [] }));
  await page.route('**/vouchers/admin/all**', route => route.fulfill({ json: [] }));
  await page.route('**/admin/customers**', route => route.fulfill({ json: [] }));
  await page.route('**/installments/schedules**', route => route.fulfill({ json: [] }));
  await page.route('**/installments**', route => route.fulfill({ json: [] }));
  await page.route('**/admin/collections**', route => route.fulfill({ json: [] }));
  await page.route('**/admin/layaways**', route => route.fulfill({ json: [] }));
  await page.route('**/admin/riders/assignments**', route => route.fulfill({ json: [] }));
  await page.route('**/admin/riders**', route => route.fulfill({ json: [] }));
  await page.route('**/admin/staff**', route => route.fulfill({ json: [] }));
  await page.route('**/admin/finance**', route => route.fulfill({ json: {} }));
  await page.route('**/admin/audit-logs**', route => route.fulfill({ json: [] }));
}

test('admin can review submitted GCash proof from order modal', async ({ page }) => {
  await setupAdminDashboard(page);
  const errors = [];
  const dialogs = [];
  let approved = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });
  await page.route('**/payments/gcash/34/verify', async route => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    const payload = request.postDataJSON();
    expect(payload.decision).toBe('approved');
    approved = true;
    await route.fulfill({
      json: {
        message: 'Payment approved.',
        payment_status: 'paid',
        payment_provider: 'manual_gcash',
        gcash_reference: 'GCASH123456789',
        payment_proof_image: '/assets/gcash-qr-placeholder.svg',
        payment_verified_at: '2026-09-15T10:30:00.000Z',
        payment_verified_by_name: 'Admin User'
      }
    });
  });

  await mockStoreSession(page);
  await page.goto('http://localhost:3000/admin/dashboard.html?section=orders', { waitUntil: 'networkidle' });
  await page.locator('[data-section="orders"]').click();
  await expect(page.locator('#orders')).toHaveClass(/active/);
  await expect(page.locator('#orders')).toContainText('GCash');
  await page.evaluate(() => window.viewOrder(34));

  await expect(page.locator('#orderModal')).toBeVisible();
  await expect(page.locator('.payment-review-card')).toContainText('GCash Payment');
  await expect(page.locator('.payment-review-card')).toContainText('GCASH123456789');
  await expect(page.locator('.payment-review-amount')).toContainText('₱8,990.00');
  await expect(page.locator('.payment-proof-preview')).toContainText('Open submitted receipt');
  await expect(page.locator('button', { hasText: 'Approve Payment' })).toBeVisible();
  await expect(page.locator('button', { hasText: 'Reject Payment' })).toBeVisible();
  await expect(page.locator('#orders')).toContainText('Check it before processing');
  await expect(page.locator('#ordersTable .order-actions').getByRole('button', { name: 'Process Order', exact: true })).toHaveCount(0);

  await page.locator('button', { hasText: 'Approve Payment' }).click();
  await expect(page.locator('#appDialogLayer')).toBeVisible();
  await expect(page.locator('#appDialogTitle')).toHaveText('Approve GCash payment proof?');
  await expect(page.locator('#appDialogDetails')).toContainText('Order ID 000034');
  await page.locator('#appDialogLayer .app-dialog-submit').click();
  await expect.poll(() => approved).toBe(true);
  await expect.poll(() => dialogs.some(message => message.includes('Payment approved'))).toBe(true);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test('admin does not see an uncommitted GCash checkout', async ({ page }) => {
  const waitingForProof = [{
    ...orders[0],
    payment_status: 'pending_payment',
    gcash_reference: null,
    payment_reference: null,
    payment_proof_image: null,
    payment_submitted_at: null
  }];
  await setupAdminDashboard(page, waitingForProof);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await mockStoreSession(page);
  await page.goto('http://localhost:3000/admin/dashboard.html?section=orders', { waitUntil: 'networkidle' });
  await page.locator('[data-section="orders"]').click();
  await expect(page.locator('#orders')).toHaveClass(/active/);
  await expect(page.locator('#ordersTable')).toContainText('No orders found.');
  await expect(page.locator('#ordersTable')).not.toContainText('Aster X1 5G Smartphone');
  await expect(page.locator('#orderModal')).toBeHidden();

  expect(errors).toEqual([]);
});

test('admin can type a reason when rejecting GCash proof', async ({ page }) => {
  await setupAdminDashboard(page);
  const errors = [];
  let submittedPayload = null;
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/payments/gcash/34/verify', async route => {
    submittedPayload = route.request().postDataJSON();
    await route.fulfill({
      json: {
        message: 'Payment proof rejected.',
        payment_status: 'rejected',
        payment_rejection_reason: submittedPayload.rejection_reason
      }
    });
  });

  await mockStoreSession(page);
  await page.goto('http://localhost:3000/admin/dashboard.html?section=orders', { waitUntil: 'networkidle' });
  await page.evaluate(() => window.viewOrder(34));
  await expect(page.locator('#orderModal')).toBeVisible();
  await expect(page.locator('#paymentStatusFilter option[value="rejected"]')).toHaveText('Rejected Payments');
  await page.locator('button', { hasText: 'Reject Payment' }).click();

  const reason = page.locator('#appDialogLayer textarea[name="reason"]');
  await expect(reason).toBeFocused();
  await expect(page.locator('#appDialogLayer .app-dialog-submit')).toHaveText('Reject Payment');
  await reason.fill('The reference number does not match the uploaded receipt.');
  await expect(reason).toHaveValue('The reference number does not match the uploaded receipt.');
  await page.locator('#appDialogLayer .app-dialog-submit').click();

  await expect.poll(() => submittedPayload?.rejection_reason).toBe('The reference number does not match the uploaded receipt.');
  expect(submittedPayload.decision).toBe('rejected');
  expect(errors).toEqual([]);
});

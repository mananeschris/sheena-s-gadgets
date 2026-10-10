const { test, expect } = require('@playwright/test');

const order = {
  id: 34,
  product_id: 28,
  product_name: 'Aster X1 5G Smartphone',
  product_image: '/assets/hero-iphone-style.png',
  product_images: JSON.stringify(['/assets/hero-iphone-style.png']),
  quantity: 1,
  variant_name: 'Graphite Black - 8GB/128GB',
  variant_price: 8990,
  total_price: 8990,
  status: 'pending',
  payment_method: 'gcash',
  payment_provider: 'manual_gcash',
  payment_status: 'pending_payment',
  created_at: '2026-09-15T10:00:00.000Z',
  recipient_name: 'Test Customer',
  delivery_contact: '09123456789',
  delivery_address: 'Bacacay, Albay',
  items: [
    {
      product_name: 'Aster X1 5G Smartphone',
      variant_name: 'Graphite Black - 8GB/128GB',
      quantity: 1,
      unit_price: 8990,
      subtotal: 8990,
      product_image: '/assets/hero-iphone-style.png'
    }
  ],
  status_history: []
};

test.describe('order GCash proof UI', () => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 1000 }
  ]) {
    test(`shows payment proof guidance at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.addInitScript(() => {
        localStorage.setItem('currentUser', JSON.stringify({
          id: 101,
          name: 'Test Customer',
          email: 'customer@example.com',
          role: 'customer'
        }));
      });

      await page.route('**/payments/gcash/config', route => route.fulfill({
        json: {
          account_name: "Sheena's Gadgets & Accessories Shop",
          account_number: '09123456789',
          qr_image: '/assets/gcash-qr-placeholder.svg',
          instructions: [
            'Send the exact order amount to the store GCash account.',
            'Enter the reference number from GCash.',
            'Upload a clear screenshot of your payment.'
          ]
        }
      }));
      let proofSubmitted = false;
      await page.route('**/orders/customer/101', route => route.fulfill({
        json: [
          proofSubmitted
            ? {
                ...order,
                payment_status: 'for_verification',
                gcash_reference: '1234567890123',
                payment_proof_image: '/uploads/payments/test-proof.png',
                payment_submitted_at: '2026-09-15T10:15:00.000Z'
              }
            : order
        ]
      }));
      await page.route('**/payments/gcash/34/submit', async route => {
        const request = route.request();
        expect(request.method()).toBe('POST');
        proofSubmitted = true;
        await route.fulfill({
          json: {
            message: 'GCash proof uploaded. The store will check it shortly.',
            payment_status: 'for_verification',
            payment_provider: 'manual_gcash',
            gcash_reference: '1234567890123',
            payment_proof_image: '/uploads/payments/test-proof.png'
          }
        });
      });
      await page.route('**/soa/order/34?user_id=101', route => route.fulfill({ json: { statement: null } }));
      await page.route('**/notifications/customer/**', route => route.fulfill({ json: [] }));

      const errors = [];
      const dialogs = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', async dialog => {
        dialogs.push(dialog.message());
        await dialog.accept();
      });

      await page.goto('http://localhost:3000/customer/order.html?order_id=34', { waitUntil: 'networkidle' });

      await expect(page.locator('#paymentNotice')).toContainText('GCash proof needed');
      await expect(page.locator('.gcash-proof-card')).toContainText('Upload payment proof');
      await expect(page.locator('.gcash-amount')).toContainText('₱8,990.00');
      await expect(page.locator('.gcash-account-box')).toContainText('0955 856 ****');
      await expect(page.locator('.gcash-account-box')).toContainText('SH***A M** C.');
      await expect(page.locator('#gcashReferenceInput')).toBeVisible();
      await expect(page.locator('#gcashProofInput')).toBeVisible();

      await page.locator('#gcashReferenceInput').fill('1234567890123');
      await page.locator('#gcashProofInput').setInputFiles({
        name: 'gcash-proof.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
          'base64'
        )
      });
      await page.locator('#gcashProofSubmit').click();
      await expect(page.locator('#paymentNotice')).toContainText('Payment is being checked');
      await expect(page.locator('#paymentCard')).toContainText('Checking GCash');
      await expect(page.locator('#paymentCard')).toContainText('View screenshot');
      await expect.poll(() => dialogs.some(message => message.includes('GCash proof uploaded'))).toBe(true);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
      expect(errors).toEqual([]);
    });
  }
});

test('rejected payment can be re-uploaded until the order is cancelled', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    localStorage.setItem('currentUser', JSON.stringify({
      id: 101,
      name: 'Test Customer',
      email: 'customer@example.com',
      role: 'customer'
    }));
  });

  let currentOrder = {
    ...order,
    payment_status: 'rejected',
    payment_rejection_reason: 'The reference number does not match the uploaded receipt.',
    payment_verified_at: '2026-09-15T10:30:00.000Z',
    payment_verified_by_name: 'Admin User'
  };

  await page.route('**/payments/gcash/config', route => route.fulfill({
    json: {
      account_name: "Sheena's Gadgets & Accessories Shop",
      account_number: '09123456789',
      qr_image: '/assets/gcash-qr-placeholder.svg',
      instructions: ['Upload a clear and valid payment screenshot.']
    }
  }));
  await page.route('**/orders/customer/101', route => route.fulfill({ json: [currentOrder] }));
  await page.route('**/soa/order/34?user_id=101', route => route.fulfill({ json: { statement: null } }));
  await page.route('**/notifications/customer/**', route => route.fulfill({ json: [] }));

  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:3000/customer/order.html?order_id=34', { waitUntil: 'networkidle' });

  await expect(page.locator('#paymentNotice')).toContainText('Payment proof rejected');
  await expect(page.locator('#paymentNotice')).toContainText('reference number does not match');
  await expect(page.locator('.gcash-proof-card')).toContainText('Upload new payment proof');
  await expect(page.locator('#gcashProofSubmit')).toHaveText('Re-upload GCash Proof');

  currentOrder = { ...currentOrder, status: 'cancelled' };
  await page.reload({ waitUntil: 'networkidle' });

  await expect(page.locator('#paymentCard')).toContainText('GCash Proof Rejected');
  await expect(page.locator('#paymentCard')).toContainText('reference number does not match');
  await expect(page.locator('.gcash-proof-card')).toHaveCount(0);
  expect(errors).toEqual([]);
});

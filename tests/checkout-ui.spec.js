const { test, expect } = require('@playwright/test');

const user = { id: 999999, role: 'customer', name: 'Test Customer', email: 'test@example.com', phone: '09171234567' };
const savedAddress = { id: 1, label: 'Home', recipient_name: user.name, phone: user.phone, address: 'Sogod', city: 'Bacacay', province: 'Albay', landmark: 'Near market', latitude: 13.294, longitude: 123.79, is_default: 1 };
const product = {
  id: 999999, name: 'SlatePad 10.4 Tablet', price: 15990, stock: 20,
  description: '10.4-inch tablet for streaming, note-taking, video calls, and everyday work.',
  image: '/assets/hero-iphone-style.png',
  variants: JSON.stringify([
    { name: 'WiFi - 4GB/64GB', price: 12990, stock: 10 },
    { name: 'LTE - 8GB/128GB', price: 15990, stock: 10 }
  ])
};

for (const width of [1440, 768, 390]) {
  test('checkout layout and controls at ' + width, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.addInitScript(({ user }) => {
      localStorage.setItem('currentUser', JSON.stringify(user));
      localStorage.setItem('checkout', JSON.stringify({ product_id: 999999, quantity: 1, variant_index: 1 }));
    }, { user });
    await page.route('**/products', route => route.fulfill({ json: [product] }));
    await page.route('**/auth/profile/*', route => route.fulfill({ json: { user } }));
    await page.route('**/customer/addresses/*', route => route.fulfill({ json: [savedAddress] }));
    await page.route('**/vouchers', route => route.fulfill({ json: [] }));
    await page.route('**/orders**', route => route.abort());
    await page.goto('http://localhost:3000/checkout.html');
    await expect(page.locator('.checkout-shop-link')).toHaveAttribute('aria-label', 'Continue shopping');
    await expect(page.locator('.checkout-shop-link svg')).toBeVisible();
    await expect(page.locator('.variant-choice')).toHaveCount(2);
    await expect(page.locator('.delivery-location-review')).toBeVisible();
    await expect(page.locator('#savedAddressSelect')).toBeDisabled();
    await expect(page.locator('#customerAddress')).toHaveAttribute('readonly', '');
    await expect(page.locator('#customerAddress')).toHaveValue('Sogod, Bacacay, Albay');
    await expect(page.locator('#placeOrderBtn')).toBeDisabled();
    await page.locator('#confirmDeliveryLocationBtn').click();
    await expect(page.locator('#placeOrderBtn')).toBeEnabled();
    await page.locator('.variant-choice').first().click();
    await expect(page.locator('#summaryVariant')).toHaveText('WiFi - 4GB/64GB');
    await page.locator('#shippingRegion').selectOption('local');
    const region = await page.locator('#shippingRegion').boundingBox();
    const note = await page.locator('#deliveryNote').boundingBox();
    expect(Math.abs(region.height - note.height)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/checkout-' + width + '.png', fullPage: true });
    await page.locator('#payment_method').selectOption('installment');
    await page.getByRole('button', { name: 'Apply for Installment', exact: true }).click();
    await expect(page.locator('#installmentModal')).toBeVisible();
    await page.screenshot({ path: 'test-results/installment-' + width + '.png', fullPage: true });
    await page.locator('#installmentModal .modal-footer .btn-outline-dark').click();
    await expect(page.locator('#installmentModal')).toBeHidden();
    await page.locator('#payment_method').selectOption('cod');
    await page.locator('#placeOrderBtn').click();
    await expect(page.locator('#appDialogLayer')).toBeVisible();
    await expect(page.locator('#appDialogTitle')).toHaveText('Place this order?');
    await expect(page.locator('#appDialogDetails')).toContainText('Sogod, Bacacay, Albay');
    await page.locator('#appDialogLayer').evaluate(layer => Promise.all(layer.getAnimations({ subtree: true }).map(animation => animation.finished)));
    await page.screenshot({ path: 'test-results/checkout-confirm-' + width + '.png' });
    await page.locator('#appDialogLayer .app-dialog-cancel').click();
    await expect(page.locator('#appDialogLayer')).toBeHidden();
    await page.evaluate(() => showSuccess({ order_id: 58, subtotal: 12990, discount: 0, total: 12990, shipping_fee: 0, payment_method: 'cod', payment_status: 'to_collect', delivery: { recipient_name: 'Test Customer' } }));
    await expect(page.locator('#successModal')).toBeVisible();
    await expect(page.locator('#successModal')).toHaveCSS('opacity', '1');
    await expect(page.locator('#orderSuccessText')).toContainText('Pay on delivery');
    await expect(page.locator('#orderSuccessText')).not.toContainText('to_collect');
    await expect(page.locator('#orderSuccessText .checkout-photo img')).toBeVisible();
    await expect(page.locator('#orderSuccessView')).toBeVisible();
    const result = await page.locator('#successModal .modal-content').boundingBox();
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.x + result.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: 'test-results/checkout-success-' + width + '.png' });
    expect(errors).toEqual([]);
    await context.close();
  });
}

test('checkout requires a saved pin before allowing an order', async ({ page }) => {
  await page.addInitScript(currentUser => {
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    localStorage.setItem('checkout', JSON.stringify({ product_id: 999999, quantity: 1, variant_index: 1 }));
  }, user);
  await page.route('**/products', route => route.fulfill({ json: [product] }));
  await page.route('**/auth/profile/*', route => route.fulfill({ json: { user } }));
  await page.route('**/customer/addresses/*', route => route.fulfill({ json: [{ ...savedAddress, latitude: null, longitude: null }] }));
  await page.route('**/vouchers', route => route.fulfill({ json: [] }));
  await page.goto('http://localhost:3000/checkout.html');

  await expect(page.locator('#placeOrderBtn')).toBeDisabled();
  await expect(page.locator('#confirmDeliveryLocationBtn')).toBeDisabled();
  await expect(page.locator('#deliveryLocationBadge')).toHaveText('Pin required');
  await expect(page.locator('#deliveryLocationTitle')).toHaveText('Delivery pin required');
  await expect(page.locator('#deliveryLocationAddress')).not.toContainText('Sogod');
  await expect(page.locator('#deliveryLocationMapPreview')).toBeHidden();
  await expect(page.locator('#customerAddress')).toHaveAttribute('readonly', '');
  await expect(page.getByRole('link', { name: 'Change Location in Account Settings' })).toHaveAttribute('href', '/customer/profile.html?returnTo=%2Fcheckout.html#addresses');
});

test('checkout only displays vouchers valid for the current quantity and item', async ({ page }) => {
  await page.addInitScript(currentUser => {
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    localStorage.setItem('checkout', JSON.stringify({ product_id: 999999, quantity: 1, variant_index: 1 }));
  }, user);
  await page.route('**/products', route => route.fulfill({ json: [product] }));
  await page.route('**/auth/profile/*', route => route.fulfill({ json: { user } }));
  await page.route('**/customer/addresses/*', route => route.fulfill({ json: [savedAddress] }));
  await page.route('**/vouchers', route => route.fulfill({ json: [
    { code: 'SAVE10', discount_type: 'percent', discount_value: 10, min_quantity: 2 },
    { code: 'PHONE-ONLY', discount_type: 'fixed', discount_value: 500 }
  ] }));
  await page.route('**/vouchers/validate', async route => {
    const request = route.request().postDataJSON();
    await route.fulfill({ json: {
      valid: request.code === 'SAVE10' && request.items[0].quantity >= 2,
      message: 'Voucher is not applicable.'
    } });
  });

  await page.goto('http://localhost:3000/checkout.html');
  await expect(page.locator('#voucherList')).toBeHidden();
  await page.locator('#qty').fill('2');
  await expect(page.locator('#voucherList')).toBeVisible();
  await expect(page.locator('#voucherList .voucher-card')).toHaveCount(1);
  await expect(page.locator('#voucherList')).toContainText('SAVE10');
  await expect(page.locator('#voucherList')).not.toContainText('PHONE-ONLY');
});

test('GCash checkout creates an order only with proof and reference submitted', async ({ page }) => {
  await page.addInitScript(currentUser => {
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    localStorage.setItem('checkout', JSON.stringify({ product_id: 999999, quantity: 1, variant_index: 1 }));
  }, user);
  await page.route('**/products', route => route.fulfill({ json: [product] }));
  await page.route('**/auth/profile/*', route => route.fulfill({ json: { user } }));
  await page.route('**/customer/addresses/*', route => route.fulfill({ json: [savedAddress] }));
  await page.route('**/vouchers', route => route.fulfill({ json: [] }));
  await page.route('**/payments/gcash/config', route => route.fulfill({ json: { account_name: 'Test Store', account_number: '09*****1234' } }));

  let submittedRequest;
  await page.route('**/orders', async route => {
    submittedRequest = route.request();
    await route.fulfill({ json: {
      order_id: 1234,
      payment_method: 'gcash',
      payment_status: 'for_verification',
      requires_payment_proof: true,
      subtotal: 15990,
      total: 15990,
      delivery: { recipient_name: 'Test Customer' }
    } });
  });

  await page.goto('http://localhost:3000/checkout.html');
  await page.locator('#customerName').fill('Test Customer');
  await page.locator('#customerContact').fill('09171234567');
  await page.locator('#confirmDeliveryLocationBtn').click();
  await page.locator('#shippingRegion').selectOption('local');
  await page.locator('#payment_method').selectOption('gcash');
  await expect(page.locator('#checkoutGcashQr')).toBeHidden();
  await expect(page.locator('#totalText')).toBeHidden();
  await expect(page.locator('#placeOrderBtn')).toHaveText('Submit Order Details');
  await page.locator('#placeOrderBtn').click();
  await expect(page.locator('#gcashProofInput')).toBeVisible();
  await expect(page.locator('#checkoutGcashQr')).toBeVisible();
  await expect(page.locator('.checkout-gcash-review')).toHaveCount(0);
  await expect(page.locator('#totalText')).toBeHidden();
  await expect(page.locator('#summaryNote')).toContainText('After sending payment');
  await page.getByRole('button', { name: 'Zoom GCash QR code' }).click();
  await expect(page.locator('#gcashQrZoomModal')).toBeVisible();
  await expect(page.locator('#gcashQrZoomImage')).toHaveAttribute('src', /gcash-store-qr-code/);
  await page.locator('#gcashQrZoomModal .btn-close').click();
  await expect(page.locator('#gcashQrZoomModal')).toBeHidden();
  const paymentBox = await page.locator('#paymentUI').boundingBox();
  const qrBox = await page.locator('#checkoutGcashQr').boundingBox();
  const proofBox = await page.locator('#gcashProofInput').boundingBox();
  expect(qrBox.x).toBeGreaterThanOrEqual(paymentBox.x);
  expect(qrBox.x + qrBox.width).toBeLessThanOrEqual(paymentBox.x + paymentBox.width + 1);
  expect(proofBox.x + proofBox.width).toBeLessThanOrEqual(paymentBox.x + paymentBox.width + 1);
  await page.screenshot({ path: 'test-results/checkout-gcash-layout.png', fullPage: true });
  await page.locator('#placeOrderBtn').click();
  await expect(page.locator('#gcashSubmitError')).toContainText('valid GCash reference');
  await expect(page.locator('#appDialogLayer')).toBeHidden();

  await page.locator('#gcashReferenceInput').fill('12345678');
  await page.locator('#gcashProofInput').setInputFiles({
    name: 'receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from('test-image-content')
  });
  await page.locator('#placeOrderBtn').click();
  await expect(page.locator('#appDialogTitle')).toHaveText('Submit GCash payment proof?');
  await expect(page.locator('#appDialogLayer .app-dialog-submit')).toHaveText('Submit Proof');
  await page.locator('#appDialogLayer .app-dialog-submit').click();
  await expect.poll(() => Boolean(submittedRequest)).toBe(true);
  expect(submittedRequest.headers()['content-type']).toContain('multipart/form-data');
  const multipart = submittedRequest.postDataBuffer().toString();
  expect(multipart).toContain('12345678');
  expect(multipart).toContain('receipt.png');
  expect(multipart).toContain('13.294');
  expect(multipart).toContain('123.79');
  expect(multipart).toContain('Near market');
  await expect(page.locator('#orderSuccessTitle')).toHaveText('Waiting for Admin Approval');
  await expect(page.locator('#orderSuccessText')).toContainText('Subtotal');
  await expect(page.locator('#orderSuccessText')).toContainText('Total');
  await expect(page.locator('#orderSuccessText')).toContainText('Pending review');
  await expect(page.locator('#orderSuccessText')).not.toContainText('for_verification');
});

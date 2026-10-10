const { test, expect } = require('@playwright/test');

const user = { id: 101, role: 'customer', name: 'Chris Joseph B. Mananes', phone: '09171234567' };
const address = { id: 1, label: 'Home', recipient_name: user.name, phone: user.phone, address: 'Sogod', city: 'Bacacay', province: 'Albay', landmark: 'Near the market', latitude: 13.294, longitude: 123.79, is_default: 1 };
const product = {
  id: 9101, name: 'SlatePad 10.4 Tablet', price: 14990, stock: 6,
  image: '/uploads/catalog/photos/slatepad-10-4-tablet.png',
  variants: JSON.stringify([{ name: 'WiFi - 6GB/128GB', price: 14990, stock: 4 }, { name: 'LTE - 8GB/128GB', price: 16990, stock: 2 }])
};
const secondProduct = { id: 9102, name: 'NovaCam Pro 5G Smartphone', price: 17990, stock: 4, image: '/uploads/catalog/photos/novacam-pro-5g-smartphone.png' };

async function setup(page, options = {}) {
  await page.addInitScript(({ user, checkout }) => {
    localStorage.setItem('currentUser', JSON.stringify(user));
    localStorage.setItem('checkout', JSON.stringify(checkout));
  }, { user, checkout: options.checkout || { product_id: 9101, variant_index: 0, quantity: 1 } });
  await page.route('**/products', route => route.fulfill({ json: options.products || [product, secondProduct] }));
  await page.route('**/auth/profile/*', route => route.fulfill({ json: { user } }));
  await page.route('**/customer/addresses/*', route => route.fulfill({ json: [options.address || address] }));
  await page.route('**/vouchers', route => route.fulfill({ json: [] }));
  await page.route('**/payments/gcash/config', route => route.fulfill({ json: { account_name: 'SH***A M** C.', account_number: '0955 856 ****', qr_image: '/assets/gcash-store-qr-code.png' } }));
  await page.route('**/orders', route => route.abort());
}

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`checkout sections and controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await setup(page);
    await page.goto('http://localhost:3000/checkout.html');
    await expect(page.locator('#productInfo')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.product-preview h3')).toHaveText(product.name);
    await expect(page.locator('.checkout-photo img')).toHaveCSS('object-fit', 'contain');
    await expect.poll(() => page.locator('.checkout-photo img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(page.locator('.checkout-shop-link svg')).toBeVisible();
    await expect(page.locator('#summaryDiscountRow')).toBeHidden();
    await expect(page.locator('#checkoutDecreaseQty')).toBeDisabled();
    await page.getByRole('button', { name: 'Increase quantity', exact: true }).click();
    await expect(page.locator('#qty')).toHaveValue('2');
    await expect(page.locator('#subtotalText')).toContainText('29,980');
    await page.locator('.variant-choice').nth(1).click();
    await expect(page.locator('.variant-choice').nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#subtotalText')).toContainText('33,980');
    await expect(page.locator('#checkoutIncreaseQty')).toBeDisabled();
    await page.locator('#confirmDeliveryLocationBtn').click();
    await expect(page.locator('#placeOrderBtn')).toBeEnabled();
    await expect(page.locator('#placeOrderBtn span')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(page.locator('#checkoutPaymentStep')).toHaveAttribute('aria-current', 'step');
    await page.locator('.checkout-delivery-summary summary').click();
    await expect(page.locator('#summaryAddress')).toHaveText('Sogod, Bacacay, Albay');
    const geometry = await page.evaluate(() => {
      const main = document.querySelector('.checkout-main').getBoundingClientRect();
      const aside = document.querySelector('.checkout-side').getBoundingClientRect();
      return {
        separate: main.right <= aside.left || main.bottom <= aside.top,
        fieldsInside: [...document.querySelectorAll('.checkout-main input:not([type=hidden]), .checkout-main select, .checkout-main textarea')].filter(el => el.getBoundingClientRect().width).every(el => {
          const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth;
        }),
        overflow: document.documentElement.scrollWidth > innerWidth,
        flatSections: [...document.querySelectorAll('.checkout-main > .panel')].every(el => getComputedStyle(el).boxShadow === 'none' && getComputedStyle(el).borderRadius === '0px')
      };
    });
    expect(geometry).toEqual({ separate: true, fieldsInside: true, overflow: false, flatSections: true });
    await page.screenshot({ path: `test-results/checkout-redesign-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('GCash staged layout, masked account, QR zoom and retained proof', async ({ page }) => {
  await setup(page);
  let orderRequests = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/orders') orderRequests++; });
  await page.goto('http://localhost:3000/checkout.html');
  await page.locator('#confirmDeliveryLocationBtn').click();
  await page.locator('#payment_method').selectOption('gcash');
  await expect(page.locator('#checkoutSummary')).toBeHidden();
  await expect(page.locator('#checkoutGcashQr')).toHaveCount(0);
  await expect(page.locator('#checkoutDetailsStep')).toHaveAttribute('aria-current', 'step');
  await page.locator('#placeOrderBtn').click();
  await expect(page.locator('#checkoutPaymentStep')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#checkoutGcashName')).toHaveText('SH***A M** C.');
  await expect(page.locator('#checkoutGcashNumber')).toHaveText('0955 856 ****');
  await page.locator('#gcashReferenceInput').fill('12345678');
  await page.locator('#gcashProofInput').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: Buffer.from('image-content') });
  await page.locator('#deliveryNote').fill('Call upon arrival');
  await expect(page.locator('#gcashReferenceInput')).toHaveValue('12345678');
  expect(await page.locator('#gcashProofInput').evaluate(input => input.files[0].name)).toBe('receipt.png');
  for (const width of [1440, 768, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const box = await page.locator('#paymentUI').boundingBox();
    for (const selector of ['#checkoutGcashQr', '#gcashProofInput', '#gcashReferenceInput', '.checkout-gcash-zoom-button']) {
      const child = await page.locator(selector).boundingBox();
      expect(child.x).toBeGreaterThanOrEqual(box.x);
      expect(child.x + child.width).toBeLessThanOrEqual(box.x + box.width + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `test-results/checkout-redesign-gcash-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Zoom GCash QR code', exact: true }).click();
  await expect(page.locator('#gcashQrZoomModal')).toBeVisible();
  expect(await page.locator('#gcashQrZoomImage').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: 'Close QR zoom', exact: true }).click();
  await page.getByRole('button', { name: 'Back to order details', exact: true }).click();
  await expect(page.locator('#checkoutDetailsStep')).toHaveAttribute('aria-current', 'step');
  await expect(page.locator('#checkoutGcashQr')).toHaveCount(0);
  expect(orderRequests).toBe(0);
});

test('cart checkout keeps all items and hides the single-item quantity', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await setup(page, { checkout: { mode: 'cart', items: [{ product_id: 9101, variant_index: 0, quantity: 2 }, { product_id: 9102, quantity: 1 }] } });
  await page.goto('http://localhost:3000/checkout.html');
  await expect(page.locator('.product-preview')).toHaveCount(2);
  await expect(page.locator('#qty')).toBeHidden();
  await expect(page.locator('#quantitySectionTitle')).toHaveText('Savings');
  await expect(page.locator('#subtotalText')).toContainText('47,970');
  await expect(page.locator('#installmentOption')).toBeDisabled();
  await page.locator('#confirmDeliveryLocationBtn').click();
  await expect(page.locator('#placeOrderBtn')).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: 'test-results/checkout-redesign-cart.png', fullPage: true });
});

test('invalid quantities stay blocked across delivery and payment changes', async ({ page }) => {
  await setup(page);
  await page.goto('http://localhost:3000/checkout.html');
  await page.locator('#qty').fill('99');
  await page.locator('#confirmDeliveryLocationBtn').click();
  await expect(page.locator('#placeOrderBtn')).toBeDisabled();
  await page.locator('#payment_method').selectOption('gcash');
  await expect(page.locator('#placeOrderBtn')).toBeDisabled();
  await page.locator('#deliveryNote').fill('Contact me');
  await expect(page.locator('#placeOrderBtn')).toBeDisabled();
  await page.locator('#qty').fill('1.5');
  await expect(page.locator('#placeOrderBtn')).toBeDisabled();
  await page.locator('#qty').fill('2');
  await expect(page.locator('#placeOrderBtn')).toBeEnabled();
});

test('voucher feedback, discount visibility and removal', async ({ page }) => {
  await setup(page);
  await page.route('**/vouchers/validate', async route => {
    const body = route.request().postDataJSON();
    await route.fulfill({ json: body.code === 'SAVE500' ? {
      valid: true, normalized_code: 'SAVE500', voucher_code: 'SAVE500', discount: 500,
      order_subtotal: 14990, checkout_type: 'regular'
    } : { valid: false, message: 'This code is not applicable.' } });
  });
  await page.goto('http://localhost:3000/checkout.html');
  await page.locator('#voucher').fill('INVALID');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('#voucherFeedback')).toHaveText('This code is not applicable.');
  await page.locator('#voucher').fill('SAVE500');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('#summaryDiscountRow')).toBeVisible();
  await expect(page.locator('#voucherFeedback')).toContainText('500');
  await expect(page.locator('#totalText')).toContainText('14,490');
  await page.getByRole('button', { name: 'Remove voucher', exact: true }).click();
  await expect(page.locator('#summaryDiscountRow')).toBeHidden();
  await expect(page.locator('#clearCheckoutVoucher')).toBeHidden();
  await expect(page.locator('#totalText')).toContainText('14,990');
});

test('checkout loading failure can retry without losing delivery details', async ({ page }) => {
  await setup(page);
  let release;
  let attempts = 0;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/products', async route => {
    if (++attempts === 1) { await pending; return route.fulfill({ status: 503, json: { message: 'Unavailable' } }); }
    return route.fulfill({ json: [product] });
  });
  await page.goto('http://localhost:3000/checkout.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#productInfo')).toHaveAttribute('aria-busy', 'true');
  await page.locator('#confirmDeliveryLocationBtn').click();
  await expect(page.locator('#placeOrderBtn')).toBeDisabled();
  release();
  await expect(page.locator('#productInfo')).toContainText('Unable to load your items');
  await expect(page.locator('#placeOrderBtn')).toHaveText('Items Unavailable');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.product-preview h3')).toHaveText(product.name);
  await expect(page.locator('#customerAddress')).toHaveValue('Sogod, Bacacay, Albay');
  await expect(page.locator('#placeOrderBtn')).toBeEnabled();
});

test('missing pin and missing image stay clear and do not allow submission', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await setup(page, { products: [{ ...product, image: '' }], address: { ...address, latitude: null, longitude: null } });
  await page.goto('http://localhost:3000/checkout.html');
  await expect(page.locator('.checkout-empty-photo')).toBeVisible();
  await expect(page.locator('#deliveryLocationMapPreview')).toBeHidden();
  await expect(page.locator('#confirmDeliveryLocationBtn')).toBeDisabled();
  await expect(page.locator('#placeOrderBtn')).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Change Location in Account Settings', exact: true })).toHaveAttribute('href', '/customer/profile.html?returnTo=%2Fcheckout.html#addresses');
});

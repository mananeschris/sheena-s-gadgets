const { test, expect } = require('@playwright/test');

const user = { id: 101, role: 'customer', name: 'Chris Joseph B. Mananes' };
const image = '/assets/hero-iphone-style.png';
const baseOrder = {
  id: 34, product_id: 28, product_name: 'NovaCam Pro 5G Smartphone',
  product_image: image, quantity: 1, variant_price: 17990, total_price: 17990,
  variant_name: 'Midnight Black - 12GB/256GB', status: 'pending',
  payment_method: 'gcash', payment_provider: 'manual_gcash', payment_status: 'for_verification',
  gcash_reference: '1234567890123', payment_proof_image: image,
  created_at: '2026-10-07T12:12:00Z', recipient_name: user.name,
  delivery_contact: '09123456789', delivery_address: 'Bacacay, Albay', shipping_region: 'local',
  status_history: [{ status: 'pending', note: 'Payment proof submitted for review.', actor_name: user.name, created_at: '2026-10-07T12:12:00Z' }]
};
const statement = {
  order_id: 34, total_price: 17990, total_paid: 17990, balance: 0,
  schedules: [{ id: 901, installment_no: 1, due_date: '2026-11-07', amount_due: 8995, amount_paid: 8995, balance: 0, status: 'paid', payment_status: 'paid' }],
  payments: [{ id: 1, entry_no: 1, amount_paid: 8995, balance: 0, paid_at: '2026-11-07' }]
};

async function setup(page, overrides = {}) {
  let order = { ...baseOrder, ...overrides };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.addInitScript(user => localStorage.setItem('currentUser', JSON.stringify(user)), user);
  // Every business endpoint is mocked; UI checks never mutate the actual database.
  await page.route('**/orders/**', route => route.fulfill({ json: [] }));
  await page.route('**/orders/customer/101', route => route.fulfill({ json: [order] }));
  await page.route('**/payments/gcash/config', route => route.fulfill({ json: { qr_image: '/assets/gcash-store-qr-code.png', instructions: ['Send the exact amount and upload a clear payment screenshot.'] } }));
  await page.route('**/payments/gcash/*/submit', route => route.fulfill({ status: 400, json: { message: 'Mock-only request' } }));
  await page.route('**/soa/order/**', route => route.fulfill({ json: { statement } }));
  await page.route('**/notifications/customer/**', route => route.fulfill({ json: [] }));
  await page.goto('http://localhost:3000/customer/order.html?order_id=34');
  await expect(page.locator('#orderShell')).toBeVisible();
  return { errors, update: next => { order = { ...order, ...next }; } };
}

for (const width of [320, 390, 768, 1440]) {
  test(`order workspace is compact and readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    const { errors } = await setup(page);
    await expect(page.locator('#orderTitle')).toHaveText(baseOrder.product_name);
    await expect(page.locator('#orderReferenceLabel')).toContainText('000034');
    await expect(page.locator('#orderItemCount')).toHaveText('1 item');
    await expect(page.locator('#accountLabel')).toContainText('Chris');
    await expect(page.locator('#trackingTimeline .tracking-node svg')).toHaveCount(5);
    await expect(page.locator('.tracking-step-large.current')).toHaveAttribute('aria-current', 'step');
    expect(await page.locator('.tracking-step-large.current').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    expect(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundImage)).toBe('none');
    await expect(page.locator('#orderStatusPill')).toHaveText('Waiting for Admin Approval');
    await expect(page.locator('.gcash-proof-card')).toHaveCount(0);
    await expect.poll(() => page.locator('.order-item-row img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(page.locator('#statusHistory')).toBeHidden();
    await page.locator('#orderHistoryDisclosure summary').click();
    await expect(page.locator('#statusHistory')).toContainText('Payment proof submitted for review');
    await page.locator('#orderHistoryDisclosure summary').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('#orderShell').evaluate(shell => [...shell.querySelectorAll('h1, h2, h3, .detail-row strong, .btn')].every(el => {
      const bounds = el.getBoundingClientRect();
      return !el.getClientRects().length || (bounds.left >= 0 && bounds.right <= innerWidth && el.scrollWidth <= el.clientWidth + 1);
    }))).toBe(true);
    expect(await page.locator('.panel-head h2').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(18);
    const left = await page.locator('.order-main-left').boundingBox();
    const right = await page.locator('.order-side-column').boundingBox();
    if (width > 800) expect(right.x).toBeGreaterThan(left.x + left.width);
    else expect(right.y).toBeGreaterThan(left.y);
    await page.screenshot({ path: `test-results/customer-order-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });

  test(`GCash QR zoom and focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    const { errors } = await setup(page, { payment_status: 'rejected', payment_rejection_reason: 'Reference does not match.' });
    await expect(page.locator('#gcashProofSubmit')).toHaveText('Re-upload GCash Proof');
    await expect(page.locator('.gcash-account-box')).toContainText('SH***A M** C.');
    await expect(page.locator('.gcash-account-box')).toContainText('0955 856 ****');
    const zoom = page.getByRole('button', { name: 'Zoom in on GCash QR code' });
    await zoom.click();
    await expect(page.locator('#gcashQrModal')).toBeVisible();
    await expect(page.locator('#gcashQrModalClose')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#gcashQrModalClose')).toBeFocused();
    const preview = await page.locator('.gcash-qr-box img').boundingBox();
    const enlarged = await page.locator('#gcashQrModalImage').boundingBox();
    expect(enlarged.width).toBeGreaterThan(preview.width);
    expect(await page.locator('.gcash-qr-modal-card').evaluate(el => {
      const rect = el.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
    })).toBe(true);
    await page.screenshot({ path: `test-results/customer-order-qr-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(zoom).toBeFocused();
    await expect(page.locator('#gcashQrModal')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('cancellation modal accepts reason, traps focus, shows error and retries', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const { update, errors } = await setup(page, { payment_method: 'cod', payment_provider: null, payment_status: 'to_collect', status_history: [] });
  await expect(page.locator('#orderHistoryDisclosure')).toBeHidden();
  let attempts = 0;
  await page.route('**/orders/34/cancellation-request', route => {
    expect(route.request().postDataJSON()).toEqual({ user_id: 101, reason: 'Selected the wrong variant.' });
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 400, json: { message: 'Please retry this request.' } });
    update({ cancellation_request_status: 'pending' });
    return route.fulfill({ json: { message: 'Submitted' } });
  });
  const trigger = page.getByRole('button', { name: 'Request Cancel' });
  await trigger.click();
  await page.locator('#orderRequestText').fill('Selected the wrong variant.');
  await expect(page.locator('#orderRequestText')).toBeFocused();
  await page.locator('#orderRequestSubmit').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close form' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#orderRequestSubmit')).toBeFocused();
  await page.locator('#orderRequestSubmit').click();
  await expect(page.locator('#orderRequestError')).toHaveText('Please retry this request.');
  await page.locator('#orderRequestSubmit').click();
  await expect(page.locator('#orderRequestModal')).toBeHidden();
  await expect(trigger).toHaveCount(0);
  expect(attempts).toBe(2);
  expect(errors).toEqual([]);
});

test('completed order keeps warranty repair and review actions', async ({ page }) => {
  const { errors } = await setup(page, { status: 'delivered', payment_status: 'paid', warranty_expires_at: '2099-10-07', delivered_at: '2026-10-09T10:00:00Z' });
  await expect(page.locator('#repairPanel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request Cancel' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Write Review' })).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Request Repair' });
  await trigger.click();
  await page.getByLabel('Repair issue', { exact: true }).fill('Screen flickers while charging.');
  await page.keyboard.press('Escape');
  await expect(page.locator('#orderRequestModal')).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.route('**/orders/34/repair-request', route => {
    expect(route.request().postDataJSON()).toEqual({ user_id: 101, issue: 'Screen flickers while charging.' });
    return route.fulfill({ json: { message: 'Submitted' } });
  });
  await trigger.click();
  await page.getByLabel('Repair issue', { exact: true }).fill('Screen flickers while charging.');
  await page.locator('#orderRequestSubmit').click();
  await expect(page.locator('#orderRequestModal')).toBeHidden();
  expect(errors).toEqual([]);
});

test('cancelled order disables uploads and requests', async ({ page }) => {
  const { errors } = await setup(page, { status: 'cancelled', payment_status: 'rejected', cancellation_admin_note: 'Cancelled by the shop.' });
  await expect(page.locator('.cancelled-state')).toContainText('Cancelled by the shop');
  await expect(page.locator('.gcash-proof-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Request Cancel|Request Repair|Write Review/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('multiple products show item quantity and downloadable receipt', async ({ page }) => {
  const { errors } = await setup(page, { items: [
    { product_name: 'NovaCam Pro', product_image: image, quantity: 2, unit_price: 17990, subtotal: 35980 },
    { product_name: 'Fast Charger', product_image: image, quantity: 1, unit_price: 1290, subtotal: 1290 }
  ], total_price: 37270 });
  await expect(page.locator('#orderTitle')).toHaveText('2 products');
  await expect(page.locator('#orderItemCount')).toHaveText('3 items');
  await expect(page.locator('.order-item-row')).toHaveCount(2);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download receipt', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/000034-receipt\.txt$/);
  expect(errors).toEqual([]);
});

for (const width of [390, 1440]) {
  test(`installment summary handles zero balance at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { errors } = await setup(page, { payment_method: 'installment', payment_status: 'installment_completed', installment_application_status: 'approved', installment_terms: 2, installment_balance: 0, installment_monthly: 8995, installment_downpayment: 0 });
    await expect(page.locator('#installmentDetails .detail-row').filter({ hasText: 'Balance' })).toContainText('₱0.00');
    await expect(page.locator('#installmentStatementPanel')).toBeVisible();
    await expect(page.locator('.soa-table tbody tr')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Prepare GCash' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/customer-order-installment-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('failed order load offers working retry', async ({ page }) => {
  await setup(page);
  await page.route('**/orders/customer/101', route => route.fulfill({ status: 503, json: { message: 'Try again shortly.' } }));
  await page.getByRole('button', { name: 'Refresh order' }).click();
  await expect(page.locator('#errorState')).toContainText('Try again shortly');
  await page.route('**/orders/customer/101', route => route.fulfill({ json: [baseOrder] }));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('#orderShell')).toBeVisible();
  await expect(page.locator('#errorState')).toBeHidden();
});

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { mockStoreSession } = require('./helpers/store-session-ui.cjs');

async function fixture(page, role = 'rider', options = {}) {
  const photo = fs.readFileSync(path.join(__dirname, '../public/assets/hero-iphone-style.png'));
  const writes = [], errors = [];
  let delivered = false, seen = false, attempts = 0, loggedIn = !options.staleSession;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(role => localStorage.setItem('currentUser', JSON.stringify({ id: role === 'admin' ? 202 : 201, name: 'Test User', role, email: 'rider@example.com' })), role);
  if (options.nativeCamera) await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Android Mobile' }));
  if (options.camera) await page.addInitScript(({ error, delayed }) => {
    window.cameraStops = 0;
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      if (error) throw new DOMException('Test camera unavailable', error);
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fafafa'; context.fillRect(0, 0, 640, 480);
      context.fillStyle = '#222'; context.fillRect(220, 110, 200, 250);
      context.fillStyle = '#fff'; context.font = '20px sans-serif'; context.fillText('Delivery photo', 250, 245);
      const stream = canvas.captureStream(15);
      stream.getTracks().forEach(track => {
        const stop = track.stop.bind(track);
        track.stop = () => { window.cameraStops++; stop(); };
      });
      if (delayed) await new Promise(resolve => { window.resolveCamera = resolve; });
      return stream;
    } });
  }, { error: options.cameraError, delayed: options.delayedCamera });
  await page.route('**/*', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/auth/login' && options.staleSession) {
      const body = request.postDataJSON();
      if (body.password !== 'CorrectPassword!1') return route.fulfill({ status: 400, json: { message: 'Invalid password' } });
      loggedIn = true;
      return route.fulfill({ json: { user: { id: options.wrongAccount ? 202 : 201, name: 'Test User', email: 'rider@example.com', role: options.wrongAccount ? 'admin' : 'rider' } } });
    }
    if (path.endsWith('/delivery-proof') && request.method() === 'POST') {
      writes.push(request); attempts++;
      if (!loggedIn) return route.fulfill({ status: 401, json: { message: 'Sign in again to access delivery proof.' } });
      if (options.retry && attempts === 1) return route.fulfill({ status: 503, json: { message: 'Upload failed. Please retry.' } });
      delivered = true; return route.fulfill({ json: { status: 'delivered' } });
    }
    if (path === '/rider/assignments') return route.fulfill({ json: { items: [{ id: 5, order_id: 34, status: delivered ? 'delivered' : 'out_for_delivery', customer_display_name: 'Chris Mananes', delivery_display_address: 'Bacacay, Albay', payment_method: 'gcash', payment_status: 'paid', total_price: 17990, items: [{ product_name: 'Test Phone', product_image: '/assets/hero-iphone-style.png', quantity: 1 }] }] } });
    if (path === '/admin/riders/delivery-notifications') return route.fulfill({ json: { items: seen ? [] : [{ type: 'delivery_proof', assignment_id: 5, order_id: 34, title: 'Test Phone: Delivered', detail: 'Rider submitted a delivery photo.', section: 'riders', created_at: new Date().toISOString() }] } });
    if (path === '/admin/riders/assignments/5/proof') return options.photoError ? route.fulfill({ status: 404, json: { message: 'Photo unavailable' } }) : route.fulfill({ contentType: 'image/png', body: photo });
    if (path === '/admin/riders/assignments/5/proof/seen') { writes.push(request); seen = true; return route.fulfill({ json: { success: true } }); }
    if (request.method() !== 'GET') { writes.push(request); return route.fulfill({ status: 400, json: { message: 'Unexpected write' } }); }
    if (path === '/admin/alerts') return route.fulfill({ json: { summary: { total: 0 }, items: [] } });
    if (path.startsWith('/delivery-chat/')) return route.fulfill({ json: { threads: [], unread_count: 0 } });
    if (path === '/products' || path === '/products/categories' || path === '/orders' || path === '/installments' || /^\/(admin|vouchers|installments)\//.test(path) && !path.endsWith('.html')) return route.fulfill({ json: [] });
    return route.continue();
  });
  if (role === 'admin') await mockStoreSession(page, { deliveryNotifications: false });
  await page.goto(`http://localhost:3000/${role === 'rider' ? 'rider' : 'admin'}/dashboard.html`);
  return { photo, writes, errors };
}

for (const width of [320, 390, 1440]) {
  test(`required rider proof and retry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { photo, writes, errors } = await fixture(page, 'rider', { retry: true });
    await page.getByRole('button', { name: 'Delivered', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.proof-product')).toHaveText('Test Phone');
    await expect(dialog.locator('.proof-recipient')).toHaveText('Chris Mananes');
    await expect(dialog.getByRole('button', { name: 'Add delivery photo' })).toBeVisible();
    await page.screenshot({ path: `test-results/delivery-proof-empty-${width}.png` });
    await expect(dialog.getByRole('button', { name: /Submit Proof/ })).toBeDisabled();
    expect(writes).toHaveLength(0);
    await page.locator('#deliveryProofPhoto').setInputFiles({ name: 'invalid.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('bad image') });
    await expect(dialog.getByRole('alert')).toContainText('could not be opened');
    await expect(dialog.getByRole('button', { name: /Submit Proof/ })).toBeDisabled();
    await page.locator('#deliveryProofPhoto').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: photo });
    await expect(dialog.getByRole('img')).toBeVisible();
    await expect(dialog.locator('.proof-file-name')).toHaveText('proof.png');
    await expect(dialog.getByRole('button', { name: /Submit Proof/ })).toBeEnabled();
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/delivery-proof-rider-${width}.png` });
    await dialog.getByRole('button', { name: /Submit Proof/ }).click();
    await expect(dialog.getByRole('alert')).toContainText('Upload failed');
    await expect(dialog.getByRole('img')).toBeVisible();
    await expect(page.locator('.delivery-card .status-badge')).toContainText('Out for Delivery');
    await dialog.getByRole('button', { name: /Submit Proof/ }).click();
    await expect(dialog).not.toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[0].headers()['x-actor-id']).toBe('201');
    expect(writes[0].postDataBuffer().toString()).toContain('name="delivery_proof"');
    expect(errors).toEqual([]);
  });
  test(`admin notification opens proof at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { writes, errors } = await fixture(page, 'admin');
    await expect(page.locator('#adminActionCenter')).toContainText('Test Phone: Delivered');
    await page.locator('#notificationButton').click();
    await page.locator('#adminNotificationList').getByRole('button', { name: 'View Delivery Proof' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('img')).toBeVisible();
    await expect.poll(() => writes.length).toBe(1);
    await expect(page.locator('#adminActionCenter')).not.toContainText('Test Phone: Delivered');
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/delivery-proof-admin-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('cancel does not complete delivery and invalid file sizes are blocked', async ({ page }) => {
  const { writes } = await fixture(page);
  await page.getByRole('button', { name: 'Delivered', exact: true }).click();
  await page.locator('#deliveryProofPhoto').setInputFiles({ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('5 MB');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(writes).toHaveLength(0);
});

test('failed admin photo does not acknowledge notification', async ({ page }) => {
  const { writes } = await fixture(page, 'admin', { photoError: true });
  await page.locator('#adminActionCenter').getByRole('button', { name: 'View Delivery Proof' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('unavailable');
  expect(writes).toHaveLength(0);
  await expect(page.locator('#adminActionCenter')).toContainText('Test Phone: Delivered');
});

test('remove and camera selection preserve required photo validation', async ({ page }) => {
  const { photo, writes } = await fixture(page, 'rider', { nativeCamera: true });
  await page.getByRole('button', { name: 'Delivered', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'Take Photo' }).click();
  await (await chooser).setFiles({ name: 'camera.png', mimeType: 'image/png', buffer: photo });
  await expect(dialog.getByRole('img')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Submit Proof' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Remove photo' }).click();
  await expect(dialog.getByRole('img')).not.toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Submit Proof' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Add delivery photo' })).toBeVisible();
  expect(writes).toHaveLength(0);
});

for (const width of [320, 1440]) {
  test(`live camera captures and returns to proof at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { writes, errors } = await fixture(page, 'rider', { camera: true });
    await page.getByRole('button', { name: 'Delivered', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Take Photo' }).click();
    await expect(dialog.getByRole('button', { name: 'Capture Photo' })).toBeEnabled();
    await expect(dialog.locator('video')).toBeVisible();
    await page.screenshot({ path: `test-results/delivery-camera-${width}.png` });
    await dialog.getByRole('button', { name: 'Capture Photo' }).click();
    await expect(dialog.getByRole('img')).toBeVisible();
    await expect(dialog.locator('.proof-camera-view')).not.toBeVisible();
    await expect(dialog.locator('.proof-file-name')).toContainText('delivery-5-');
    await expect(dialog.getByRole('button', { name: 'Submit Proof', exact: true })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.cameraStops)).toBe(1);
    expect(writes).toHaveLength(0);
    expect(errors).toEqual([]);
  });
}

test('camera permission failure preserves the selected proof', async ({ page }) => {
  const { photo, writes } = await fixture(page, 'rider', { camera: true, cameraError: 'NotAllowedError' });
  await page.getByRole('button', { name: 'Delivered', exact: true }).click();
  await page.locator('#deliveryProofPhoto').setInputFiles({ name: 'existing.png', mimeType: 'image/png', buffer: photo });
  await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
  await page.getByRole('button', { name: 'Take Photo' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Camera access was denied');
  await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit Proof', exact: true })).toBeEnabled();
  expect(writes).toHaveLength(0);
});

test('back and close stop camera without completing the delivery', async ({ page }) => {
  const { writes } = await fixture(page, 'rider', { camera: true });
  await page.getByRole('button', { name: 'Delivered', exact: true }).click();
  await page.getByRole('button', { name: 'Take Photo' }).click();
  await expect(page.getByRole('button', { name: 'Capture Photo' })).toBeEnabled();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Submit Proof', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.cameraStops)).toBe(1);
  await page.getByRole('button', { name: 'Take Photo' }).click();
  await expect(page.getByRole('button', { name: 'Capture Photo' })).toBeEnabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.cameraStops)).toBe(2);
  expect(writes).toHaveLength(0);
});

test('camera permission resolving after modal closes releases the stream', async ({ page }) => {
  await fixture(page, 'rider', { camera: true, delayedCamera: true });
  await page.getByRole('button', { name: 'Delivered', exact: true }).click();
  await page.getByRole('button', { name: 'Take Photo' }).click();
  await expect.poll(() => page.evaluate(() => typeof window.resolveCamera)).toBe('function');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.resolveCamera());
  await expect.poll(() => page.evaluate(() => window.cameraStops)).toBe(1);
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

for (const width of [320, 1440]) {
  test(`expired session recovers without losing the delivery photo at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { photo, writes, errors } = await fixture(page, 'rider', { staleSession: true });
    await page.getByRole('button', { name: 'Delivered', exact: true }).click();
    await page.locator('#deliveryProofPhoto').setInputFiles({ name: 'kept.png', mimeType: 'image/png', buffer: photo });
    await page.getByRole('button', { name: 'Submit Proof', exact: true }).click();
    const auth = page.locator('.proof-auth-view');
    await expect(auth).toBeVisible();
    await expect(auth.getByLabel('Email', { exact: true })).toHaveValue('rider@example.com');
    await auth.getByLabel('Password', { exact: true }).fill('WrongPassword');
    await auth.getByRole('button', { name: 'Sign In & Submit' }).click();
    await expect(auth.getByRole('alert')).toHaveText('Invalid password');
    expect(writes).toHaveLength(1);
    await expect(auth.getByLabel('Password', { exact: true })).toHaveValue('');
    await auth.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
    await expect(page.locator('.proof-file-name')).toHaveText('kept.png');
    await page.getByRole('button', { name: 'Submit Proof', exact: true }).click();
    await auth.getByLabel('Password', { exact: true }).fill('CorrectPassword!1');
    await page.screenshot({ path: `test-results/proof-session-recovery-${width}.png` });
    await auth.getByRole('button', { name: 'Sign In & Submit' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(writes).toHaveLength(2);
    expect(writes[1].postDataBuffer().toString()).toContain('filename="kept.png"');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('currentUser'))).not.toContain('CorrectPassword');
    expect(errors).toEqual([]);
  });
}

test('session recovery rejects a different account without resubmitting the proof', async ({ page }) => {
  const { photo, writes } = await fixture(page, 'rider', { staleSession: true, wrongAccount: true });
  await page.getByRole('button', { name: 'Delivered', exact: true }).click();
  await page.locator('#deliveryProofPhoto').setInputFiles({ name: 'kept.png', mimeType: 'image/png', buffer: photo });
  await page.getByRole('button', { name: 'Submit Proof', exact: true }).click();
  const auth = page.locator('.proof-auth-view');
  await auth.getByLabel('Password', { exact: true }).fill('CorrectPassword!1');
  await auth.getByRole('button', { name: 'Sign In & Submit' }).click();
  await expect(auth.getByRole('alert')).toContainText('same account');
  expect(writes).toHaveLength(1);
});

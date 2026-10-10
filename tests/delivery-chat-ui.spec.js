const { test, expect } = require('@playwright/test');
const photo = '/assets/hero-iphone-style.png';
const initialThread = { id: 10, order_id: 34, assignment_id: 5, customer_id: 101, rider_id: 201, customer_name: 'Chris Joseph B. Mananes', rider_name: 'Juan Dela Cruz', product_name: 'NovaCam Pro 5G Smartphone', product_image: photo, delivery_status: 'assigned', can_send: true, is_current: true, unread_count: 1, last_message: 'Good morning. Confirming your landmark.', last_message_at: '2026-10-09T08:00:00Z' };

async function setup(page, role = 'customer', options = {}) {
  const user = { id: role === 'rider' ? 201 : 101, role, name: role === 'rider' ? initialThread.rider_name : initialThread.customer_name };
  const errors = [], payloads = [];
  const state = { threads: options.empty ? [] : [{ ...initialThread, ...options.thread }], messages: [{ id: 1, sender_id: role === 'rider' ? 101 : 201, body: 'Good morning. Confirming your landmark.', created_at: '2026-10-09T08:00:00Z' }], peerReadId: 0, failSend: options.failSend, denied: options.denied };
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(user => { if (user) localStorage.setItem('currentUser', JSON.stringify(user)); else localStorage.removeItem('currentUser'); }, options.guest ? null : user);
  await page.route('**/delivery-chat/**', async route => {
    const request = route.request(), url = new URL(request.url());
    if (state.denied) return route.fulfill({ status: 401, json: { message: 'Sign in again to use delivery messages.' } });
    if (url.pathname.endsWith('/threads')) return route.fulfill({ json: { threads: state.threads, unread_count: state.threads.reduce((sum, item) => sum + item.unread_count, 0) } });
    const id = Number(url.pathname.match(/threads\/(\d+)/)?.[1]);
    const thread = state.threads.find(item => item.id === id);
    if (!thread) return route.fulfill({ status: 404, json: { message: 'Conversation is no longer available.' } });
    if (url.pathname.endsWith('/read')) { thread.unread_count = 0; return route.fulfill({ json: { success: true } }); }
    if (request.method() === 'POST') {
      const data = request.postDataJSON(); payloads.push(data);
      let message = state.messages.find(item => item.client_id === data.client_id);
      if (!message) { message = { id: state.messages.length + 1, sender_id: user.id, body: data.body, created_at: new Date().toISOString(), client_id: data.client_id }; state.messages.push(message); }
      if (state.failSend) { state.failSend = false; return route.fulfill({ status: 503, json: { message: 'Connection interrupted. Retry your message.' } }); }
      thread.last_message = data.body;
      return route.fulfill({ json: { message } });
    }
    const after = Number(url.searchParams.get('after_id'));
    const before = Number(url.searchParams.get('before_id'));
    return route.fulfill({ json: { thread, messages: state.messages.filter(item => (!after || item.id > after) && (!before || item.id < before)), has_more: false, peer_read_id: state.peerReadId } });
  });
  await page.route('**/notifications/customer/**', route => route.fulfill({ json: [] }));
  const product = { id: 28, name: initialThread.product_name, price: 17990, stock: 4, category: 'Phones', image: photo };
  const order = { id: 34, product_id: 28, product_name: product.name, product_image: photo, quantity: 1, total_price: 17990, status: 'processing', payment_method: 'gcash', payment_status: 'paid', created_at: '2026-10-09', recipient_name: user.name, delivery_address: 'Bacacay, Albay', delivery_contact: '09123456789' };
  await page.route('**/orders/customer/**', route => route.fulfill({ json: [order] }));
  await page.route('**/payments/gcash/config', route => route.fulfill({ json: {} }));
  await page.route('**/products', route => route.fulfill({ json: [product] }));
  await page.route('**/reviews/product/**', route => route.fulfill({ json: [] }));
  await page.route('**/auth/profile/**', route => route.fulfill({ json: { user } }));
  await page.route('**/customer/addresses/**', route => route.fulfill({ json: [] }));
  await page.route('**/installments/customer/**', route => route.fulfill({ json: [] }));
  await page.route('**/layaways/customer/**', route => route.fulfill({ json: [] }));
  await page.route('**/soa/101', route => route.fulfill({ json: { statements: [] } }));
  await page.route('**/rider/assignments?**', route => route.fulfill({ json: { items: [{ id: 5, order_id: 34, order_status: 'shipped', status: 'assigned', assigned_at: '2026-10-09', customer_display_name: initialThread.customer_name, customer_display_phone: '09123456789', delivery_display_address: 'Bacacay, Albay', delivery_latitude: 13.3, delivery_longitude: 123.8, payment_method: 'installment', payment_status: 'installment_downpayment_paid', total_price: 17990, items: [{ product_name: product.name, product_image: photo, quantity: 1 }] }] } }));
  return { state, errors, payloads, user };
}

async function openPage(page, role = 'customer', target = 'order') {
  await page.goto(`http://localhost:3000/${role === 'rider' ? 'rider/dashboard.html' : target === 'product' ? 'customer/product.html?id=28' : target === 'shop' ? 'customer/shop.html' : 'customer/order.html?order_id=34'}`);
  await expect(page.locator('[data-delivery-inbox]')).toBeVisible();
}

for (const role of ['customer', 'rider']) {
  for (const width of [320, 390, 768, 1440]) {
    test(`${role} delivery inbox and sending at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const { errors, payloads } = await setup(page, role);
      await openPage(page, role);
      await expect(page.locator('[data-chat-count]')).toHaveText('1');
      if (role === 'rider') await page.screenshot({ path: `test-results/rider-workspace-${width}.png`, fullPage: true });
      await page.locator('[data-delivery-inbox]').click();
      await expect(page.locator('.chat-conversation')).toHaveCount(1);
      await page.locator('.chat-conversation').click();
      await expect(page.locator('#chatPeer')).toHaveText(role === 'rider' ? initialThread.customer_name : initialThread.rider_name);
      await expect(page.locator('#chatPeerRole')).toHaveText(role === 'rider' ? 'Customer' : 'Delivery rider');
      await expect(page.locator('#chatDeliveryStatus svg')).toHaveCount(1);
      await expect(page.locator('#chatConversationCount')).toHaveText('1');
      expect(await page.locator('#chatClose').evaluate(el => getComputedStyle(el).color)).toBe('rgb(221, 221, 221)');
      await expect(page.locator('#chatProductName')).toHaveText(initialThread.product_name);
      await expect(page.locator('#chatMessages')).toContainText('Confirming your landmark');
      await expect(page.locator('[data-chat-count]')).toBeHidden();
      await page.getByLabel('Message', { exact: true }).fill('Near the barangay hall. Thank you!');
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await expect(page.locator('.chat-message.own')).toContainText('Near the barangay hall');
      await expect(page.locator('.chat-message.own')).toContainText('Sent');
      await expect(page.locator('.chat-message.own small svg')).toHaveCount(1);
      expect(await page.locator('.chat-message.own p').evaluate(el => getComputedStyle(el).color)).toBe('rgb(255, 255, 255)');
      await expect(page.locator('#chatMessageInput')).toHaveValue('');
      expect(payloads).toHaveLength(1);
      const bounds = await page.locator('#deliveryChatDialog').evaluate(el => {
        const rect = el.getBoundingClientRect(); return { inside: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, noOverflow: el.scrollWidth <= el.clientWidth };
      });
      expect(bounds).toEqual({ inside: true, noOverflow: true });
      const overflow = await page.evaluate(() => [...document.body.querySelectorAll('*')].filter(el => {
        const rect = el.getBoundingClientRect(); return el.getClientRects().length && rect.right > innerWidth + 1;
      }).map(el => `${el.tagName}.${el.className}`).slice(0, 12));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), overflow.join(', ')).toBe(true);
      await expect.poll(() => page.locator('#chatProductPhoto').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      await page.screenshot({ path: `test-results/chat-${role}-${width}.png` });
      await page.keyboard.press('Escape');
      await expect(page.locator('#deliveryChatDialog')).not.toBeVisible();
      await expect(page.locator('[data-delivery-inbox]')).toBeFocused();
      expect(errors).toEqual([]);
    });
  }
}

test('order and rider shortcuts select the corresponding delivery', async ({ page }) => {
  await setup(page);
  await openPage(page);
  await expect(page.getByRole('button', { name: 'Chat Rider' })).toBeVisible();
  await page.getByRole('button', { name: 'Chat Rider' }).click();
  await expect(page.locator('#chatPeer')).toHaveText(initialThread.rider_name);
});

test('send retry preserves draft and client ID without duplicate messages', async ({ page }) => {
  const { payloads, errors } = await setup(page, 'customer', { failSend: true });
  await openPage(page);
  await page.getByRole('button', { name: 'Chat Rider' }).click();
  await page.getByLabel('Message', { exact: true }).fill('Please call when you arrive.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('#chatError')).toContainText('Connection interrupted');
  await expect(page.locator('#chatMessageInput')).toHaveValue('Please call when you arrive.');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.chat-message.own')).toHaveCount(1);
  expect(payloads[0].client_id).toBe(payloads[1].client_id);
  expect(errors).toEqual([]);
});

test('received messages and read indicators update without navigating away', async ({ page }) => {
  const { state, errors } = await setup(page);
  await openPage(page);
  await page.getByRole('button', { name: 'Chat Rider' }).click();
  await page.getByLabel('Message', { exact: true }).fill('Hello');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.chat-message.own')).toContainText('Sent');
  state.peerReadId = 2;
  state.messages.push({ id: 3, sender_id: 201, body: '<script>window.chatXss=true</script>', created_at: '2026-10-09' });
  await page.getByRole('button', { name: 'Refresh messages' }).click();
  await expect(page.locator('.chat-message.own')).toContainText('Read');
  await expect(page.locator('.chat-message.own small svg')).toHaveAttribute('data-lucide', 'check-check');
  await expect(page.locator('#chatMessages')).toContainText('<script>window.chatXss=true</script>');
  expect(await page.evaluate(() => window.chatXss)).toBeUndefined();
  expect(errors).toEqual([]);
});

for (const deliveryStatus of ['delivered', 'cancelled', 'failed_attempt']) {
  test(`${deliveryStatus} conversation has correct send availability`, async ({ page }) => {
    await setup(page, 'customer', { thread: { delivery_status: deliveryStatus, can_send: deliveryStatus === 'failed_attempt' } });
    await openPage(page);
    await page.getByRole('button', { name: 'Chat Rider' }).click();
    if (deliveryStatus === 'failed_attempt') await expect(page.locator('#chatComposer')).toBeVisible();
    else { await expect(page.locator('#chatComposer')).toBeHidden(); await expect(page.locator('#chatClosed')).toContainText('read-only'); }
  });
}

test('reassignment preserves customer history and removes unavailable rider thread', async ({ page }) => {
  const { state } = await setup(page, 'rider');
  await openPage(page, 'rider');
  await page.getByRole('button', { name: 'Chat Customer' }).click();
  await expect(page.locator('#chatMessages')).toContainText('Confirming your landmark');
  state.threads = [];
  await page.getByRole('button', { name: 'Refresh messages' }).click();
  await expect(page.locator('#chatWorkspace')).toBeHidden();
  await expect(page.locator('#chatError')).toContainText('no longer available');
});

test('old login asks for fresh authentication without exposing messages', async ({ page }) => {
  await setup(page, 'customer', { denied: true });
  await openPage(page);
  await page.locator('[data-delivery-inbox]').click();
  await expect(page.locator('#chatError')).toContainText('Sign in again');
  await expect(page.locator('#chatError a')).toBeVisible();
  await expect(page.locator('.chat-conversation')).toHaveCount(0);
});

test('empty inbox hides order shortcut', async ({ page }) => {
  await setup(page, 'customer', { empty: true });
  await openPage(page);
  await expect(page.getByRole('button', { name: 'Chat Rider' })).toBeHidden();
  await page.locator('[data-delivery-inbox]').click();
  await expect(page.locator('#chatConversations')).toContainText('No delivery conversations yet');
});

for (const target of ['shop', 'product']) {
  test(`${target} exposes the shared inbox and hides it for guests`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 850 });
    await setup(page);
    await openPage(page, 'customer', target);
    await page.locator('[data-delivery-inbox]').click();
    await expect(page.locator('.chat-conversation')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { localStorage.removeItem('currentUser'); window.DeliveryChat.refresh(); });
    await expect(page.locator('[data-delivery-inbox]')).toBeHidden();
  });
}

for (const target of ['profile', 'checkout']) {
  test(`${target} shares the inbox on small screens`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    const { errors } = await setup(page);
    await page.goto(`http://localhost:3000/${target === 'checkout' ? 'checkout.html?product_id=28' : `customer/${target}.html${target === 'review' ? '?order_id=34' : ''}`}`);
    await expect(page.locator('[data-delivery-inbox]')).toBeVisible();
    expect(await page.locator('[data-delivery-inbox]').evaluate(el => { const rect = el.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; })).toBe(true);
    await page.locator('[data-delivery-inbox]').click();
    await expect(page.locator('.chat-conversation')).toHaveCount(1);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

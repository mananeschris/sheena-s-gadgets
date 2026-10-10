const { test, expect } = require('@playwright/test');
const express = require('express');
const path = require('path');
let server, origin;

test.beforeAll(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '../public')));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });

async function setup(page, loggedIn = true) {
  if (loggedIn) await page.addInitScript(() => localStorage.setItem('currentUser', JSON.stringify({ id: 101, role: 'customer', name: 'Customer' })));
  await page.route('**/products**', route => route.fulfill({ json: [] }));
  await page.route('**/notifications/**', route => route.fulfill({ json: [] }));
  await page.route('**/delivery-chat/**', route => route.fulfill({ json: { conversations: [] } }));
  await page.route('**/ai-assistant/status', route => route.fulfill({ json: { available: true } }));
  await page.goto(origin + '/customer/shop.html');
  await page.getByRole('button', { name: 'Open AI shopping assistant', exact: true }).click();
}

for (const width of [390, 1440]) {
  test(`conversation, bounded history and plain-text replies at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    let body;
    await page.route('**/ai-assistant/messages', route => {
      body = route.request().postDataJSON();
      return route.fulfill({ json: { reply: '<img src=x onerror=alert(1)> Please contact the shop.' } });
    });
    await setup(page);
    await expect(page.locator('#shopAssistantInput')).toBeEnabled();
    await page.locator('[data-ai-question]').first().click();
    await expect(page.locator('.shop-ai-message').last()).toContainText('<img src=x');
    expect(body.messages[0].role).toBe('user');
    await expect(page.locator('#shopAssistantMessages img')).toHaveCount(0);
    await page.locator('#shopAssistantInput').fill('Do you offer warranty?');
    await page.getByRole('button', { name: 'Send question', exact: true }).click();
    await expect(page.locator('#shopAssistantThinking')).toHaveCount(0);
    expect(body.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(await page.locator('#shopAssistantDialog').evaluate(el => {
      const rect = el.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && el.scrollWidth <= el.clientWidth;
    })).toBe(true);
    await page.screenshot({ path: `test-results/shop-assistant-${width}.png` });
    await page.getByRole('button', { name: 'Start a new chat' }).click();
    await expect(page.locator('.shop-ai-message')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#shopAssistantDialog')).not.toBeVisible();
    await expect(page.locator('#shopAssistantLauncher')).toBeFocused();
  });
}

test('offline AI blocks generation while retaining human support and retry', async ({ page }) => {
  await setup(page);
  await page.route('**/ai-assistant/status', route => route.fulfill({ json: { available: false } }));
  await page.getByRole('button', { name: 'Check assistant availability' }).click();
  await expect(page.locator('#shopAssistantInput')).toBeDisabled();
  await expect(page.locator('#shopAssistantNotice')).toContainText('offline');
  await expect(page.getByRole('button', { name: 'Contact the shop', exact: true })).toBeEnabled();
  await page.route('**/ai-assistant/status', route => route.fulfill({ json: { available: true } }));
  await page.getByRole('button', { name: 'Check assistant availability' }).click();
  await expect(page.locator('#shopAssistantInput')).toBeEnabled();
});

test('guests must sign in before asking questions', async ({ page }) => {
  await setup(page, false);
  await expect(page.locator('#shopAssistantInput')).toBeDisabled();
  await expect(page.locator('#shopAssistantSignIn')).toBeVisible();
});

test('provider errors preserve the draft for retry without a fake AI response', async ({ page }) => {
  await page.route('**/ai-assistant/messages', route => route.fulfill({ status: 503, json: { message: 'Assistant unavailable.' } }));
  await setup(page);
  await expect(page.locator('#shopAssistantInput')).toBeEnabled();
  await page.locator('#shopAssistantInput').fill('Please explain GCash payments.');
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(page.locator('#shopAssistantNotice')).toHaveText('Assistant unavailable.');
  await expect(page.locator('#shopAssistantInput')).toHaveValue('Please explain GCash payments.');
  await expect(page.locator('#shopAssistantThinking')).toHaveCount(0);
  await expect(page.locator('.shop-ai-message.assistant')).toHaveCount(1);
});

test('expired session clears the conversation and disables sending', async ({ page }) => {
  await page.route('**/ai-assistant/messages', route => route.fulfill({ status: 401, json: { message: 'Sign in again.' } }));
  await setup(page);
  await expect(page.locator('#shopAssistantInput')).toBeEnabled();
  await page.locator('#shopAssistantInput').fill('My private concern');
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(page.locator('#shopAssistantNotice')).toHaveText('Sign in again.');
  await expect(page.locator('#shopAssistantInput')).toBeDisabled();
  await expect(page.locator('#shopAssistantInput')).toHaveValue('');
  await expect(page.locator('#shopAssistantMessages')).not.toContainText('My private concern');
  await expect(page.locator('#shopAssistantSignIn')).toBeVisible();
});

test('Gemini shows its data-use disclosure within the mobile dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await setup(page);
  await page.route('**/ai-assistant/status', route => route.fulfill({ json: { available: true, provider: 'gemini' } }));
  await page.getByRole('button', { name: 'Check assistant availability' }).click();
  await expect(page.locator('#shopAssistantPrivacy')).toBeVisible();
  await expect(page.locator('#shopAssistantPrivacy')).toContainText('sent to Google Gemini');
  await expect(page.locator('#shopAssistantPrivacy a')).toHaveAttribute('href', 'https://ai.google.dev/gemini-api/terms');
  expect(await page.locator('#shopAssistantDialog').evaluate(el => {
    const bounds = el.getBoundingClientRect();
    return bounds.right <= innerWidth && bounds.bottom <= innerHeight && el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight + 1;
  })).toBe(true);
});

test('signing out in another tab clears chat and aborts pending generation', async ({ page, context }) => {
  let release;
  await page.route('**/ai-assistant/messages', route => new Promise(resolve => {
    release = () => route.fulfill({ json: { reply: 'Old account response' } }).catch(() => {}).finally(resolve);
  }));
  await setup(page);
  await expect(page.locator('#shopAssistantInput')).toBeEnabled();
  await page.locator('#shopAssistantInput').fill('My private concern');
  await page.getByRole('button', { name: 'Send question', exact: true }).click();
  await expect(page.locator('#shopAssistantThinking')).toBeVisible();
  await expect.poll(() => Boolean(release)).toBe(true);
  const peer = await context.newPage();
  await peer.goto(origin + '/terms.html');
  await peer.evaluate(() => localStorage.removeItem('currentUser'));
  await expect(page.locator('#shopAssistantDialog')).not.toBeVisible();
  await release();
  await expect(page.locator('#shopAssistantMessages')).not.toContainText('My private concern');
  await expect(page.locator('#shopAssistantMessages')).not.toContainText('Old account response');
});

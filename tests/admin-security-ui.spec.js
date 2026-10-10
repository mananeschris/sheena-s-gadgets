const { test, expect } = require('@playwright/test');
const { mockStoreSession } = require('./helpers/store-session-ui.cjs');
const admin = { id: 1, role: 'admin', name: 'Verified Admin', email: 'admin@example.com' };

async function setup(page, options = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (location.pathname === '/admin/dashboard.html') localStorage.setItem('currentUser', JSON.stringify({ id: 999, role: 'admin', name: 'Forged browser identity' }));
  });
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/admin/alerts') return route.fulfill({ json: { summary: {}, items: [] } });
    if (path === '/admin/finance') return route.fulfill({ json: {} });
    if (path.startsWith('/admin/') && !path.endsWith('.html') || ['/orders','/products','/products/categories','/installments','/installments/schedules','/vouchers/admin/all'].includes(path)) return route.fulfill({ json: [] });
    return route.continue();
  });
  await mockStoreSession(page, { user: options.user || admin, remaining_seconds: options.remaining_seconds ?? 900 });
  await page.goto('http://localhost:3000/admin/dashboard.html', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toHaveAttribute('data-session-ready', 'true');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('currentUser')).id)).toBe((options.user || admin).id);
  return errors;
}

for (const width of [390, 1440]) {
  test(`security settings and password confirmation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = await setup(page);
    let attempts = 0;
    await page.route('**/auth/admin/password', route => {
      attempts++;
      expect(route.request().postDataJSON()).toEqual({ password: 'NewAdminPassword1!' });
      return route.fulfill(attempts === 1 ? { status: 428, json: { requires_reauthentication: true } } : { json: { message: 'Password updated.' } });
    });
    await page.route('**/auth/admin/reauth/start', route => {
      expect(route.request().postDataJSON()).toMatchObject({ password: 'OldAdminPassword1!', email: admin.email });
      return route.fulfill({ json: { message: 'Enter your emailed security code.' } });
    });
    await page.route('**/auth/admin/reauth/verify', route => {
      const valid = route.request().postDataJSON().code === '123456';
      return route.fulfill({ status: valid ? 200 : 400, json: { message: valid ? 'Identity confirmed.' : 'Invalid security code.' } });
    });
    await page.evaluate(() => AdminSecurity.openSettings());
    await expect(page.locator('#adminSecurityModal')).toBeVisible();
    await expect(page.locator('#adminSecurityModal')).toHaveCSS('opacity', '1');
    await expect(page.locator('#adminPasswordForm button')).toHaveCSS('background-color', 'rgb(23, 23, 23)');
    await page.screenshot({ path: `test-results/admin-security-${width}.png` });
    await page.locator('#adminNewPassword').fill('NewAdminPassword1!');
    await page.locator('#adminConfirmPassword').fill('DifferentPassword1!');
    await page.locator('#adminPasswordForm button').click();
    await expect(page.locator('#adminSecurityMessage')).toHaveText('Passwords do not match.');
    await page.locator('#adminConfirmPassword').fill('NewAdminPassword1!');
    await page.locator('#adminPasswordForm button').click();
    await expect(page.locator('#adminReauthPassword')).toBeFocused();
    await expect(page.locator('#adminSecurityModal')).toBeHidden();
    await page.locator('#adminReauthPassword').fill('OldAdminPassword1!');
    await page.locator('#adminReauthSubmit').click();
    await expect(page.locator('#adminReauthCode')).toBeFocused();
    await page.locator('#adminReauthCode').fill('000000');
    await page.locator('#adminReauthSubmit').click();
    await expect(page.locator('#adminReauthMessage')).toHaveText('Invalid security code.');
    await page.screenshot({ path: `test-results/admin-reauth-${width}.png` });
    await page.locator('#adminReauthCode').fill('123456');
    await page.locator('#adminReauthSubmit').click();
    await expect(page.locator('#adminSecurityMessage')).toHaveText('Password updated.');
    await expect(page.locator('#adminSecurityModal')).toBeVisible();
    expect(attempts).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('Password1!');
    expect(errors).toEqual([]);
  });
}

test('sensitive request retries once with its original body and cancellation prevents the write', async ({ page }) => {
  await setup(page);
  let writes = 0;
  await page.route('**/admin/staff', route => {
    writes++;
    expect(route.request().postDataJSON()).toEqual({ name: 'New Staff' });
    return route.fulfill({ status: 428, json: { requires_reauthentication: true } });
  });
  await page.evaluate(() => { window.pendingSensitive = fetch('/admin/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'New Staff' }) }); });
  await expect(page.locator('#adminReauthModal')).toBeVisible();
  await page.locator('#adminReauthModal').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(async () => (await window.pendingSensitive).status)).toBe(428);
  expect(writes).toBe(1);
});

test('idle warning counts down and Stay Signed In renews the deadline', async ({ page }) => {
  const errors = await setup(page, { remaining_seconds: 90 });
  await expect(page.locator('#adminIdleModal')).toBeVisible();
  await expect(page.locator('#adminIdleCountdown')).toContainText('1:');
  await page.screenshot({ path: 'test-results/admin-idle-warning.png', fullPage: true });
  await page.route('**/auth/session', route => route.fulfill({ json: { user: admin, remaining_seconds: 900 } }));
  await page.getByRole('button', { name: 'Stay Signed In' }).click();
  await expect(page.locator('#adminIdleModal')).toBeHidden();
  expect(errors).toEqual([]);
});

test('logout calls server revocation before removing browser identity', async ({ page }) => {
  await setup(page);
  let called = false;
  await page.route('**/auth/logout', route => { called = true; return route.fulfill({ json: { message: 'Signed out.' } }); });
  await page.evaluate(() => logoutAdmin());
  await expect(page).toHaveURL(/\/auth.html\?returnTo=/);
  expect(called).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('currentUser'))).toBeNull();
});

test('security logs shortcut resets conflicting filters and opens only security events', async ({ page }) => {
  await setup(page);
  await page.route('**/admin/audit-logs**', route => route.fulfill({ json: [
    { id: 1, actor_name: admin.name, actor_role: 'admin', action: 'login_success', entity_type: 'account_security', entity_id: 1, created_at: '2026-10-10T08:00:00Z' },
    { id: 2, actor_name: admin.name, actor_role: 'admin', action: 'create_product', entity_type: 'product', entity_id: 5, created_at: '2026-10-10T08:00:00Z' }
  ] }));
  await page.locator('#auditSearch').evaluate(element => { element.value = 'conflicting search'; });
  await page.evaluate(() => AdminSecurity.openSettings());
  await page.getByRole('button', { name: 'Security Logs', exact: true }).click();
  await expect(page.locator('#auditEntityFilter')).toHaveValue('account_security');
  await expect(page.locator('#auditSearch')).toHaveValue('');
  await expect(page.locator('#auditLogTable')).toContainText('Login Success');
  await expect(page.locator('#auditLogTable')).not.toContainText('Create Product');
});

test('admin signin uses the admin challenge endpoint before dashboard routing', async ({ page }) => {
  let verified = false;
  await page.route('**/auth/login', route => route.fulfill({ json: { requires_two_factor: true, requires_admin_verification: true, email: admin.email } }));
  await page.route('**/auth/admin/verify-login', route => {
    verified = true;
    expect(route.request().postDataJSON()).toEqual({ email: admin.email, code: '123456' });
    return route.fulfill({ json: { user: admin } });
  });
  await page.route('**/admin/dashboard.html', route => route.fulfill({ contentType: 'text/html', body: '<h1>Verified Dashboard</h1>' }));
  await page.goto('http://localhost:3000/auth.html');
  await page.locator('#email').fill(admin.email);
  await page.locator('#password').fill('AdminPassword1!');
  await page.locator('#submitButton').click();
  await expect(page.locator('#twoFactorForm')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('currentUser'))).toBeNull();
  await page.locator('#twoFactorCode').fill('123456');
  await page.locator('#twoFactorButton').click();
  await expect(page).toHaveURL('http://localhost:3000/admin/dashboard.html');
  expect(verified).toBe(true);
});

const { test,expect } = require('@playwright/test');
const { mockStoreSession } = require('./helpers/store-session-ui.cjs');
const token = 'a'.repeat(64);
const user = { id: 10,name: 'New Shop Assistant',email: 'assistant@example.com',role: 'staff' };
async function activation(page,{ invalid=false,fail=false }={}) {
  const writes = [];
  await page.route('**/account-invitations/**',route => {
    const path = new URL(route.request().url()).pathname; const body = route.request().postDataJSON();
    writes.push({ path,body });
    if (fail) return route.fulfill({ status: 503,json: { message: 'Unable to check invitation. Please try again.' } });
    if (invalid) return route.fulfill({ status: 400,json: { message: 'This invitation is invalid or expired. Ask the admin for a new invitation.' } });
    return route.fulfill({ json: path.endsWith('inspect') ? { user } : { message: 'Account activated. Sign in with your email and new password.' } });
  });
  await page.goto(`http://localhost:3000/activate-account.html#token=${token}`,{ waitUntil: 'networkidle' });
  return writes;
}
for (const width of [1440,768,390,320]) test(`activation form, icons and image fit at ${width}px`,async ({ page },info) => {
  await page.setViewportSize({ width,height: 900 }); const errors = []; page.on('pageerror',error => errors.push(error.message));
  await activation(page);
  await expect(page.getByRole('heading',{ name: 'Activate Account',exact: true })).toBeVisible();
  await expect(page.locator('#activationEmail')).toHaveText(user.email);
  expect(new URL(page.url()).hash).toBe('');
  expect(await page.locator('.activation-header img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#activationSubmit svg')).toBeVisible();
  await page.screenshot({ path: info.outputPath(`activation-${width}.png`),fullPage: true,animations: 'disabled' });
  expect(errors).toEqual([]);
});
test('mismatch is blocked, visibility toggles, successful activation clears passwords and offers sign in',async ({ page }) => {
  const writes = await activation(page);
  await page.getByLabel('New Password',{ exact: true }).fill('EmployeePassword1!');
  await page.getByLabel('Confirm Password',{ exact: true }).fill('DifferentPassword1!');
  await page.locator('#activationSubmit').click();
  await expect(page.locator('#activationError')).toHaveText('Passwords do not match.'); expect(writes).toHaveLength(1);
  await page.getByRole('button',{ name: 'Show password',exact: true }).click();
  await expect(page.locator('#activationPassword')).toHaveAttribute('type','text');
  await page.getByLabel('Confirm Password',{ exact: true }).fill('EmployeePassword1!');
  await page.locator('#activationSubmit').click();
  await expect(page.getByRole('heading',{ name: 'Account Activated' })).toBeVisible();
  await expect(page.locator('#activationForm')).toBeHidden();
  await expect(page.locator('#activationPassword')).toHaveValue('');
  await expect(page.getByRole('link',{ name: 'Sign In',exact: true })).toHaveAttribute('href','/auth.html');
  expect(writes[1].body).toEqual({ token,password: 'EmployeePassword1!' });
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(token);
});
test('invalid links have no password form, server failures offer retry, reduced motion is respected',async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await activation(page,{ invalid: true });
  await expect(page.locator('#activationForm')).toBeHidden();
  await expect(page.locator('#activationStatus')).toContainText('invalid or expired');
  await expect(page.locator('main')).toHaveCSS('animation-name','none');
  await page.goto('about:blank');
  await activation(page,{ fail: true });
  await expect(page.getByRole('button',{ name: 'Retry',exact: true })).toBeVisible();
  await page.route('**/account-invitations/inspect',route => route.fulfill({ json: { user } }));
  await page.getByRole('button',{ name: 'Retry',exact: true }).click();
  await expect(page.locator('#activationForm')).toBeVisible();
});

test('admin invites without choosing passwords, resends invitations and excludes inactive riders',async ({ page }) => {
  const writes = []; const admin = { id: 1,name: 'Admin',email: 'admin@example.com',role: 'admin' };
  let staff = [{ ...user,account_status: 'pending_activation' }];
  const riders = [{ id: 20,name: 'Active Rider',email: 'active@example.com',phone: '09123456789',account_status: 'active' },{ id: 21,name: 'Pending Rider',email: 'pending@example.com',account_status: 'pending_activation' },{ id: 22,name: 'Disabled Rider',email: 'disabled@example.com',account_status: 'disabled' }];
  await page.route('**/*',route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (['/products','/products/categories','/orders','/installments','/installments/schedules','/vouchers/admin/all'].includes(path)) return route.fulfill({ json: [] });
    if (path === '/admin/staff' && req.method() === 'GET') return route.fulfill({ json: staff });
    if (path === '/admin/riders' && req.method() === 'GET') return route.fulfill({ json: riders });
    if (path.startsWith('/admin/staff') && ['POST','PUT'].includes(req.method())) {
      const body = req.postDataJSON(); writes.push({ path,body });
      if (path.endsWith('status')) staff = staff.map(user => ({ ...user,account_status: body.status === 'disabled' ? 'disabled' : 'pending_activation' }));
      return route.fulfill({ status: path === '/admin/staff' ? 201 : 200,json: { message: 'Invitation sent.' } });
    }
    if (path.startsWith('/admin/') && !path.endsWith('.html')) return route.fulfill({ json: path.endsWith('alerts') ? { summary: {},items: [] } : [] });
    if (path.startsWith('/dashboard/')) return route.fulfill({ json: [] });
    return route.continue();
  });
  await mockStoreSession(page,{ user: admin });
  await page.goto('http://localhost:3000/admin/dashboard.html',{ waitUntil: 'networkidle' });
  await page.evaluate(() => showSection('staff'));
  await expect(page.locator('#staffPassword')).toHaveCount(0);
  await page.getByLabel('Staff Name',{ exact: true }).fill('New Assistant');
  await page.getByLabel('Staff Email',{ exact: true }).fill('new@example.com');
  await page.getByRole('button',{ name: 'Invite Staff',exact: true }).click();
  await expect(page.locator('#staffMessage')).toHaveText('Invitation sent.');
  expect(writes[0].body).toEqual({ name: 'New Assistant',email: 'new@example.com' });
  await page.getByRole('button',{ name: 'Resend Invitation',exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  await page.getByRole('button',{ name: 'Disable',exact: true }).click();
  await page.locator('#appDialogForm').getByRole('button',{ name: 'Disable Account',exact: true }).click();
  await expect(page.locator('#staffTable')).toContainText('Disabled');
  await page.evaluate(() => showSection('riders'));
  await expect(page.locator('#riderPassword')).toHaveCount(0);
  await expect(page.locator('#riderTable')).toContainText('Pending Activation');
  await expect(page.locator('#deliveryRiderSelect option')).toHaveCount(2);
  await expect(page.locator('#deliveryRiderSelect')).toContainText('Active Rider');
  await expect(page.locator('#deliveryRiderSelect')).not.toContainText('Pending Rider');
});

const { test, expect } = require('@playwright/test');

for (const width of [320, 390, 768, 1440]) {
  test(`recovery and reset screens at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/auth/forgot-password', route => {
      expect(route.request().postDataJSON()).toEqual({ email: 'customer@example.com' });
      return route.fulfill({ json: { message: 'If an account uses that email, a password reset link will be sent.' } });
    });
    await page.goto('http://localhost:3000/auth.html');
    await expect(page.locator('.shop-link span')).toBeVisible();
    await expect(page.locator('#submitButton')).toBeInViewport();
    await page.locator('#email').fill('customer@example.com');
    await page.locator('#forgotPasswordLink').click();
    await expect(page.locator('#authForm')).toBeHidden();
    await expect(page.locator('#recoveryEmail')).toHaveValue('customer@example.com');
    await page.locator('#recoveryButton').click();
    await expect(page.locator('#recoveryMessage')).toContainText('If an account uses that email');
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
    await page.screenshot({ path: `test-results/auth-forgot-${width}.png`, fullPage: true });
    await page.locator('#forgotPasswordForm .auth-back').click();
    await expect(page.locator('#formTitle')).toHaveText('Welcome Back');

    const token = 'a'.repeat(64);
    let calls = 0;
    await page.route('**/auth/reset-password', route => {
      calls++;
      expect(route.request().postDataJSON()).toEqual({ token, password: 'NewPassword1!' });
      return route.fulfill({ json: { message: 'Password updated. Sign in with your new password.' } });
    });
    await page.goto(`http://localhost:3000/auth.html?mode=reset&token=${token}`);
    await expect(page.locator('#resetPasswordForm')).toBeVisible();
    await page.locator('#newPassword').fill('NewPassword1!');
    await page.locator('#confirmPassword').fill('DifferentPassword1!');
    await page.locator('#resetButton').click();
    await expect(page.locator('#resetMessage')).toHaveText('Passwords do not match.');
    expect(calls).toBe(0);
    await page.locator('#confirmPassword').fill('NewPassword1!');
    await page.locator('#resetPasswordForm .password-toggle').first().click();
    await expect(page.locator('#newPassword')).toHaveAttribute('type', 'text');
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
    await page.screenshot({ path: `test-results/auth-reset-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#resetButton').click();
    await expect(page.locator('#message')).toHaveText('Password updated. Sign in with your new password.');
    await expect(page).toHaveURL('http://localhost:3000/auth.html');
    await expect(page.locator('#password')).toHaveValue('');
    await expect(page.locator('#newPassword')).toHaveValue('');
    expect(await page.evaluate(() => localStorage.getItem('currentUser'))).toBeNull();
    expect(errors).toEqual([]);
  });
}

test('invalid and expired reset links offer a new link', async ({ page }) => {
  await page.goto('http://localhost:3000/auth.html?mode=reset&token=invalid');
  await expect(page.locator('#resetMessage')).toContainText('invalid or expired');
  await expect(page.locator('#resetButton')).toBeDisabled();
  await page.getByRole('button', { name: 'Request a New Reset Link' }).click();
  await expect(page.locator('#forgotPasswordForm')).toBeVisible();
  await expect(page).toHaveURL('http://localhost:3000/auth.html');
  await page.route('**/auth/reset-password', route => route.fulfill({ status: 400, json: { message: 'This reset link is invalid or expired. Request a new link.' } }));
  await page.goto(`http://localhost:3000/auth.html?mode=reset&token=${'b'.repeat(64)}`);
  await page.locator('#newPassword').fill('NewPassword1!');
  await page.locator('#confirmPassword').fill('NewPassword1!');
  await page.locator('#resetButton').click();
  await expect(page.locator('#resetMessage')).toContainText('invalid or expired');
  await expect(page.locator('#resetButton')).toBeEnabled();
});

test('recovery request disables duplicate and back actions and handles network errors', async ({ page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/auth/forgot-password', async route => { calls++; await pending; return route.abort(); });
  await page.goto('http://localhost:3000/auth.html?mode=forgot');
  await page.locator('#recoveryEmail').fill('customer@example.com');
  await page.locator('#recoveryButton').click();
  await expect(page.locator('#forgotPasswordForm .auth-back')).toBeDisabled();
  await page.evaluate(() => submitRecovery({ preventDefault() {} }, 'forgot'));
  expect(calls).toBe(1);
  release();
  await expect(page.locator('#recoveryMessage')).toContainText('Unable to connect');
  await expect(page.locator('#recoveryButton')).toBeEnabled();
});

test('remember email stores only email after successful two-factor sign-in', async ({ page }) => {
  await page.route('**/customer/shop.html', route => route.fulfill({ contentType: 'text/html', body: '<h1>Shop</h1>' }));
  await page.route('**/auth/login', route => route.fulfill({ json: { requires_two_factor: true, email: 'customer@example.com' } }));
  await page.route('**/auth/verify-two-factor', route => route.fulfill({ json: { user: { id: 101, role: 'customer' } } }));
  await page.goto('http://localhost:3000/auth.html');
  await page.locator('#email').fill('customer@example.com');
  await page.locator('#password').fill('StrongPassword1!');
  await page.locator('#rememberEmail').check();
  await page.locator('#submitButton').click();
  expect(await page.evaluate(() => localStorage.getItem('rememberedLoginEmail'))).toBeNull();
  await page.locator('#twoFactorCode').fill('123456');
  await page.locator('#twoFactorButton').click();
  await expect(page).toHaveURL('http://localhost:3000/customer/shop.html');
  expect(await page.evaluate(() => localStorage.getItem('rememberedLoginEmail'))).toBe('customer@example.com');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('StrongPassword1!');
  await page.goto('http://localhost:3000/auth.html');
  await expect(page.locator('#email')).toHaveValue('customer@example.com');
  await expect(page.locator('#rememberEmail')).toBeChecked();
  await expect(page.locator('#password')).toHaveValue('');
  await page.locator('#rememberEmail').uncheck();
  await page.reload();
  await expect(page.locator('#email')).toHaveValue('');
  await expect(page.locator('#rememberEmail')).not.toBeChecked();
});

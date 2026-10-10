const { test, expect } = require('@playwright/test');

test.describe('auth redesign', () => {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'tablet', width: 768, height: 1000 },
    { name: 'small-mobile', width: 320, height: 1000 },
    { name: 'mobile', width: 390, height: 1000 }
  ]) {
    test(`login and register layout at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));

      await page.goto('http://localhost:3000/auth.html', { waitUntil: 'networkidle' });

      await expect(page.locator('#formTitle')).toHaveText('Welcome Back');
      await expect(page.locator('.portal-badge')).toContainText('Shop Account');
      await expect(page.locator('#loginTab')).toHaveClass(/active/);
      await expect.poll(() => page.locator('.auth-scene img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
      await page.screenshot({ path: `test-results/auth-login-${viewport.name}.png`, fullPage: true });

      await page.locator('#authForm .password-toggle').click();
      await expect(page.locator('#password')).toHaveAttribute('type', 'text');
      await expect(page.locator('#authForm .password-toggle')).toHaveAttribute('aria-label', 'Hide password');
      await expect(page.locator('#authForm .password-toggle svg')).toBeVisible();
      await page.locator('#authForm .password-toggle').click();
      await expect(page.locator('#password')).toHaveAttribute('type', 'password');

      await page.locator('#registerTab').click();
      await expect(page.locator('body')).toHaveClass(/register-mode/);
      await expect(page.locator('#name')).toBeVisible();
      await expect(page.locator('#phone')).toBeVisible();
      await expect(page.locator('#registerTab')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#loginTab')).toHaveAttribute('aria-pressed', 'false');
      await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
      await page.screenshot({ path: `test-results/auth-register-${viewport.name}.png`, fullPage: true });

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);
      expect(errors).toEqual([]);
    });
  }
});

async function registerDetails(page) {
  await page.locator('#name').fill('Test Customer');
  await page.locator('#email').fill('customer@example.com');
  await page.locator('#password').fill('StrongPassword1!');
  await page.locator('#birthday').fill('2000-01-01');
  await page.locator('#phone').fill('09123456789');
  await page.locator('#postal_code').fill('4509');
  await page.locator('#address').fill('P-6 Sogod');
  await page.locator('#city').fill('Bacacay');
  await page.locator('#province').fill('Albay');
}

for (const width of [320, 390, 768, 1440]) {
  test(`registration, email verification, and resend at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    const payloads = [];
    let verified = false;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/auth/register', route => {
      payloads.push(route.request().postDataJSON());
      return route.fulfill({ json: { requires_verification: true, email: 'customer@example.com' } });
    });
    await page.route('**/auth/resend-verification', route => route.fulfill({ json: { message: 'A new code was sent.' } }));
    await page.route('**/auth/verify-email', route => {
      const payload = route.request().postDataJSON();
      expect(payload.email).toBe('customer@example.com');
      verified = payload.code === '123456';
      return route.fulfill({ status: verified ? 200 : 400, json: { message: verified ? 'Email verified. Please sign in.' : 'Invalid verification code.' } });
    });
    await page.goto('http://localhost:3000/auth.html?mode=register');
    await registerDetails(page);
    await page.locator('#submitButton').click();
    await expect(page.locator('#formTitle')).toHaveText('Verify your email');
    await expect(page.locator('#authForm')).toBeHidden();
    await expect(page.locator('#authTabs')).toBeHidden();
    await expect(page.locator('#verificationEmailLabel')).toHaveText('customer@example.com');
    await expect(page.locator('#verificationCode')).toBeFocused();
    expect(payloads[0]).toMatchObject({ name: 'Test Customer', phone: '09123456789', city: 'Bacacay' });
    await expect(page.locator('#verifyButton svg')).toBeVisible();
    await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
    await page.screenshot({ path: `test-results/auth-verify-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#verificationCode').fill('111111');
    await page.locator('#verifyButton').click();
    await expect(page.locator('#verificationMessage')).toHaveText('Invalid verification code.');
    await expect(page.locator('#verifyButton')).toBeEnabled();
    await page.locator('#resendButton').click();
    await expect(page.locator('#verificationMessage')).toHaveText('A new code was sent.');
    await expect(page.locator('#resendButton svg')).toBeVisible();
    await page.locator('#verificationCode').fill('123456');
    await page.locator('#verifyButton').click();
    await expect(page.locator('#formTitle')).toHaveText('Welcome Back');
    await expect(page.locator('#verificationForm')).toBeHidden();
    await expect(page.locator('#message')).toHaveText('Email verified. Please sign in.');
    await expect(page.locator('#email')).toHaveValue('customer@example.com');
    await expect(page.locator('#password')).toHaveValue('');
    expect(await page.evaluate(() => localStorage.getItem('currentUser'))).toBeNull();
    expect(verified).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('sign-in errors and in-flight controls retain icons and prevent duplicate submissions', async ({ page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/auth/login', async route => {
    requests++;
    await pending;
    return route.fulfill({ status: 401, json: { message: 'Incorrect email or password.' } });
  });
  await page.goto('http://localhost:3000/auth.html');
  await page.locator('#email').fill('customer@example.com');
  await page.locator('#password').fill('WrongPassword1!');
  await page.locator('#submitButton').click();
  await expect(page.locator('#submitButton')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#submitButton')).toBeDisabled();
  await expect(page.locator('#registerTab')).toBeDisabled();
  await page.evaluate(() => submitAuth({ preventDefault() {} }));
  expect(requests).toBe(1);
  release();
  await expect(page.locator('#message')).toHaveText('Incorrect email or password.');
  await expect(page.locator('#submitButton')).toBeEnabled();
  await expect(page.locator('#submitButton svg')).toBeVisible();
  await expect(page.locator('#registerTab')).toBeEnabled();
});

test('two-factor security code, errors, and back navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.route('**/auth/login', route => route.fulfill({ json: { requires_two_factor: true, email: 'customer@example.com' } }));
  await page.route('**/auth/verify-two-factor', route => route.fulfill({ status: 400, json: { message: 'Invalid security code.' } }));
  await page.goto('http://localhost:3000/auth.html');
  await page.locator('#email').fill('customer@example.com');
  await page.locator('#password').fill('StrongPassword1!');
  await page.locator('#submitButton').click();
  await expect(page.locator('#formTitle')).toHaveText('Confirm it is you');
  await expect(page.locator('#authForm')).toBeHidden();
  await expect(page.locator('#twoFactorCode')).toBeFocused();
  await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
  await page.screenshot({ path: 'test-results/auth-two-factor-mobile.png', fullPage: true });
  await page.locator('#twoFactorCode').fill('111111');
  await page.locator('#twoFactorButton').click();
  await expect(page.locator('#twoFactorMessage')).toHaveText('Invalid security code.');
  await expect(page.locator('#twoFactorButton svg')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Sign In', exact: true }).click();
  await expect(page.locator('#authForm')).toBeVisible();
  await expect(page.locator('#email')).toBeFocused();
  await expect(page.locator('#password')).toHaveValue('');
});

test('unverified sign-in presents the code screen with a working back action', async ({ page }) => {
  await page.route('**/auth/login', route => route.fulfill({ status: 403, json: { requires_verification: true, email: 'customer@example.com', message: 'Verify your email first.' } }));
  await page.goto('http://localhost:3000/auth.html');
  await page.locator('#email').fill('customer@example.com');
  await page.locator('#password').fill('StrongPassword1!');
  await page.locator('#submitButton').click();
  await expect(page.locator('#verificationForm')).toBeVisible();
  await expect(page.locator('#twoFactorForm')).toBeHidden();
  await page.getByRole('button', { name: 'Back to Sign In', exact: true }).click();
  await expect(page.locator('#verificationForm')).toBeHidden();
  await expect(page.locator('#authForm')).toBeVisible();
  await expect(page.locator('#email')).toHaveValue('customer@example.com');
});

for (const role of ['customer', 'admin', 'rider', 'staff']) {
  test(`sign-in preserves ${role} routing`, async ({ page }) => {
    const destination = role === 'customer' ? '/customer/shop.html' : `/${role}/dashboard.html`;
    await page.route(`**${destination}`, route => route.fulfill({ contentType: 'text/html', body: '<h1>Destination</h1>' }));
    await page.route('**/auth/login', route => route.fulfill({ json: { user: { id: 101, name: 'Test User', role } } }));
    await page.goto('http://localhost:3000/auth.html');
    await page.locator('#email').fill('customer@example.com');
    await page.locator('#password').fill('StrongPassword1!');
    await page.locator('#submitButton').click();
    await expect(page).toHaveURL(`http://localhost:3000${destination}`);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('currentUser')).role)).toBe(role);
  });
}

test('successful two-factor verification keeps the checkout return URL', async ({ page }) => {
  const returnTo = '/checkout.html?product_id=28';
  await page.route('**/checkout.html?product_id=28', route => route.fulfill({ contentType: 'text/html', body: '<h1>Checkout</h1>' }));
  await page.route('**/auth/login', route => route.fulfill({ json: { requires_two_factor: true, email: 'customer@example.com' } }));
  await page.route('**/auth/verify-two-factor', route => {
    expect(route.request().postDataJSON()).toEqual({ email: 'customer@example.com', code: '123456' });
    return route.fulfill({ json: { user: { id: 101, name: 'Test Customer', role: 'customer' } } });
  });
  await page.goto(`http://localhost:3000/auth.html?returnTo=${encodeURIComponent(returnTo)}`);
  await page.locator('#email').fill('customer@example.com');
  await page.locator('#password').fill('StrongPassword1!');
  await page.locator('#submitButton').click();
  await page.locator('#twoFactorCode').fill('123456');
  await page.locator('#twoFactorButton').click();
  await expect(page).toHaveURL(`http://localhost:3000${returnTo}`);
});

test('verification requests lock resend and back buttons until the response arrives', async ({ page }) => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/auth/register', route => route.fulfill({ json: { requires_verification: true, email: 'customer@example.com' } }));
  await page.route('**/auth/verify-email', async route => {
    await pending;
    return route.fulfill({ status: 400, json: { message: 'Invalid code.' } });
  });
  await page.goto('http://localhost:3000/auth.html?mode=register');
  await registerDetails(page);
  await page.locator('#submitButton').click();
  await page.locator('#verificationCode').fill('111111');
  await page.locator('#verifyButton').click();
  await expect(page.locator('#resendButton')).toBeDisabled();
  await expect(page.locator('#verificationForm .auth-back')).toBeDisabled();
  await expect(page.locator('#verificationForm')).toHaveAttribute('aria-busy', 'true');
  release();
  await expect(page.locator('#verificationMessage')).toHaveText('Invalid code.');
  await expect(page.locator('#resendButton')).toBeEnabled();
  await expect(page.locator('#verificationForm .auth-back')).toBeEnabled();
});

const { test, expect } = require('@playwright/test');

const user = { id: 101, name: 'Chris Joseph B. Mananes', email: 'customer@example.com', phone: '09123456789', birthday: '2000-05-20', gender: 'Male', role: 'customer', email_2fa_enabled: false };

for (const width of [1440, 390]) {
  test(`account forms and security at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.addInitScript(value => localStorage.setItem('currentUser', JSON.stringify(value)), user);
    let releaseProfile;
    let savedProfile;
    await page.route('**/auth/profile/101', async route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { user } });
      savedProfile = route.request().postDataJSON();
      await new Promise(resolve => { releaseProfile = resolve; });
      await route.fulfill({ json: { user: { ...user, ...savedProfile }, message: 'Profile updated successfully' } });
    });
    await page.goto('http://localhost:3000/customer/profile.html#account', { waitUntil: 'networkidle' });
    await expect(page.locator('#profileName')).toHaveValue(user.name);
    await expect(page.locator('#profileEmail')).toHaveAttribute('readonly', '');
    await expect(page.locator('#emailSecurityState')).toHaveText('Disabled');
    await expect(page.locator('.settings-form')).toHaveCount(3);
    await page.locator('#accountSettingsSection').scrollIntoViewIfNeeded();
    await page.locator('#accountSettingsSection').screenshot({ path: `test-results/account-settings-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.locator('#profileName').fill('Chris Mananes');
    await page.locator('#profileName').press('Enter');
    await expect(page.locator('#saveProfileButton')).toBeDisabled();
    await expect(page.locator('#saveProfileButton')).toContainText('Saving...');
    releaseProfile();
    await expect(page.locator('#accountProfileStatus')).toContainText('Profile updated successfully');
    await expect(page.locator('#saveProfileButton')).toBeEnabled();
    expect(savedProfile).toEqual({ name: 'Chris Mananes', email: user.email, phone: user.phone, birthday: user.birthday, gender: user.gender });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('currentUser')).name)).toBe('Chris Mananes');
    await page.locator('#currentProfilePassword').fill('Original!123');
    await page.locator('#newProfilePassword').fill('Updated!123');
    await page.locator('#confirmProfilePassword').fill('Different!123');
    await page.getByRole('button', { name: 'Show new password', exact: true }).click();
    await expect(page.locator('#newProfilePassword')).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Hide new password', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Update Password', exact: true }).click();
    await expect(page.locator('#accountPasswordStatus')).toContainText('do not match');
    await page.locator('#confirmProfilePassword').fill('Updated!123');
    let passwordPayload;
    await page.route('**/auth/profile/101/password', route => {
      passwordPayload = route.request().postDataJSON();
      return route.fulfill({ json: { message: 'Password updated successfully' } });
    });
    await page.getByRole('button', { name: 'Update Password', exact: true }).click();
    await expect(page.locator('#accountPasswordStatus')).toContainText('Password updated successfully');
    expect(passwordPayload).toEqual({ current_password: 'Original!123', new_password: 'Updated!123', confirm_password: 'Updated!123' });
    await expect(page.locator('#newProfilePassword')).toHaveValue('');
    await expect(page.locator('#newProfilePassword')).toHaveAttribute('type', 'password');
    await page.getByRole('switch').check();
    await expect(page.locator('#emailSecurityState')).toHaveText('Disabled');
    await page.locator('#emailTwoFactorPassword').fill('Incorrect!123');
    await page.route('**/auth/profile/101/email-two-factor', route => route.fulfill({ status: 400, json: { message: 'Current password is incorrect.' } }));
    await page.getByRole('button', { name: 'Save Security Setting' }).click();
    await expect(page.locator('#emailTwoFactorStatus')).toContainText('Current password is incorrect');
    await expect(page.locator('#saveSecurityButton')).toBeEnabled();
    await expect(page.locator('#emailSecurityState')).toHaveText('Disabled');
    let securityPayload;
    await page.route('**/auth/profile/101/email-two-factor', route => {
      securityPayload = route.request().postDataJSON();
      return route.fulfill({ json: { enabled: true, message: 'Email sign-in verification enabled.' } });
    });
    await page.locator('#emailTwoFactorPassword').fill('Updated!123');
    await page.getByRole('button', { name: 'Save Security Setting' }).click();
    await expect(page.locator('#emailSecurityState')).toHaveText('Enabled');
    expect(securityPayload).toEqual({ enabled: true, password: 'Updated!123' });
    await expect(page.locator('#emailTwoFactorPassword')).toHaveValue('');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('currentUser')).email_2fa_enabled)).toBe(true);
  });
}

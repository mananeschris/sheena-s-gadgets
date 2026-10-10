const { test, expect } = require('@playwright/test');

const user = { id: 101, name: 'Chris Joseph B. Mananes', email: 'customer@example.com', role: 'customer' };
const address = { id: 91, label: 'Home', recipient_name: user.name, phone: '09123456789', address: 'Sogod, Bacacay', city: 'Bacacay', province: 'Albay', postal_code: '4509', landmark: 'Near the barangay hall', latitude: 13.294, longitude: 123.79, is_default: 1 };

for (const width of [1440, 390]) {
  test(`address editor and map at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.addInitScript(value => localStorage.setItem('currentUser', JSON.stringify(value)), user);
    await page.route('**/auth/profile/101', route => route.fulfill({ json: { user } }));
    let addresses = [{ ...address }];
    let savedPayload;
    await page.route('**/customer/addresses/**', route => {
      if (route.request().method() === 'PUT') {
        savedPayload = route.request().postDataJSON();
        addresses = [{ ...address, ...savedPayload }];
        return route.fulfill({ json: { message: 'Address saved.', addresses } });
      }
      if (route.request().method() === 'DELETE') {
        expect(new URL(route.request().url()).searchParams.get('user_id')).toBe('101');
        addresses = [];
        return route.fulfill({ json: { message: 'Address deleted.', addresses } });
      }
      return route.fulfill({ json: addresses });
    });
    await page.goto('http://localhost:3000/customer/profile.html#addresses', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => deliveryMapEngine === 'vector' && deliveryLocationMap.isStyleLoaded() && deliveryLocationMap.queryRenderedFeatures().length > 0);
    await expect(page.locator('#savedAddressCount')).toHaveText('1');
    await page.getByRole('button', { name: 'Edit Home' }).click();
    await expect(page.locator('#addressRecipient')).toHaveValue(user.name);
    await expect(page.locator('#addressLatitude')).toHaveValue('13.2940000');
    await expect(page.locator('.maplibregl-marker')).toBeVisible();
    const map = page.locator('#deliveryLocationMap');
    await map.click({ position: { x: 80, y: 140 } });
    expect(Number(await page.locator('#addressLatitude').inputValue())).not.toBe(13.294);
    await page.getByRole('button', { name: 'Pin map center' }).click();
    const beforeDrag = await page.locator('#addressLatitude').inputValue();
    await page.locator('.maplibregl-marker').scrollIntoViewIfNeeded();
    const marker = await page.locator('.maplibregl-marker').boundingBox();
    await page.mouse.move(marker.x + marker.width / 2, marker.y + marker.height / 2);
    await page.mouse.down();
    await page.mouse.move(marker.x + marker.width / 2 + 25, marker.y + marker.height / 2 + 20, { steps: 8 });
    await page.mouse.up();
    expect(await page.locator('#addressLatitude').inputValue()).not.toBe(beforeDrag);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 13.295, longitude: 123.791 });
    await page.getByRole('button', { name: 'Use current location' }).click();
    await expect(page.locator('#addressLatitude')).toHaveValue('13.2950000');
    await expect(page.locator('#addressLongitude')).toHaveValue('123.7910000');
    await page.getByRole('button', { name: 'Expand map', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Delivery location map' })).toBeVisible();
    await page.locator('#expandAddressMap').press('Escape');
    await expect(page.locator('.map-expanded')).toHaveCount(0);
    await page.locator('#addressBookSection').screenshot({ path: `test-results/address-book-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.getByRole('button', { name: 'Save Address', exact: true }).click();
    await expect(page.locator('#addressSaveStatus')).toHaveText('Address saved.');
    expect(savedPayload.latitude).toBe('13.2950000');
    expect(savedPayload.longitude).toBe('123.7910000');
    expect(savedPayload.user_id).toBe(101);
    await page.getByRole('button', { name: 'Delete Home' }).click();
    await page.getByRole('button', { name: 'Delete Address', exact: true }).click();
    await expect(page.locator('.saved-address-item')).toHaveCount(0);
    await expect(page.locator('#addressList')).toContainText('No saved address yet');
    await expect(page.locator('#savedAddressCount')).toHaveText('0');
  });
}

test('delivery pin remains available without vector map support', async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem('currentUser', JSON.stringify(value)), user);
  await page.route('**/maplibre-gl.js', route => route.abort());
  await page.route('**/customer/addresses/101', route => route.fulfill({ json: [address] }));
  await page.goto('http://localhost:3000/customer/profile.html#addresses', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => deliveryMapEngine === 'raster' && Boolean(deliveryLocationMap));
  await page.getByRole('button', { name: 'Pin map center' }).click();
  expect(Number(await page.locator('#addressLatitude').inputValue())).toBeCloseTo(13.294, 4);
  await expect(page.locator('.leaflet-marker-icon')).toBeVisible();
});

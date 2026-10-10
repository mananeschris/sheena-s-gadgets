const { test, expect } = require('@playwright/test');
const { mockStoreSession } = require('./helpers/store-session-ui.cjs');

const products = Array.from({ length: 18 }, (_, index) => ({
  id: index + 1,
  name: index === 0 ? 'NovaCam Pro 5G Smartphone' : `Tech Essential ${String(index + 1).padStart(2, '0')}`,
  category: index % 2 ? 'Chargers' : 'Phones',
  price: index === 0 ? 17990 : 790 + index,
  stock: index % 3 === 0 ? 0 : index % 3 === 1 ? 3 : 18,
  image: '/assets/hero-iphone-style.png',
  images: JSON.stringify(['/assets/hero-iphone-style.png']),
  variants: JSON.stringify([{ name: 'Black 256GB', stock: 0, price: 17990 }]),
  allow_installment: index === 0 ? 1 : 0,
  allow_layaway: 0,
  warranty_eligible: index < 4 ? 1 : 0,
  warranty_duration_months: index === 0 ? 18 : index < 4 ? 12 : 0,
  warranty_coverage: index === 0 ? 'Manufacturing defects' : '',
  warranty_exclusions: index === 0 ? 'Accidental damage' : ''
}));

async function setup(page, role = 'admin') {
  const state = { writes: [], saveError: false, delay: 0, categoryDeletes: [], categoryError: false };
  let categories = [{ name: 'Accessories', product_count: 0, protected: true }, { name: 'Phones', product_count: 9 }, { name: 'Chargers', product_count: 9 }, { name: 'Audio', product_count: 0 }, { name: 'Desk Accessories', product_count: 0 }];
  await page.addInitScript(role => localStorage.setItem('currentUser', JSON.stringify({ id: 1, role, name: 'Admin User' })), role);
  await page.route('**/*', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/products/categories') return route.fulfill({ status: state.categoryError ? 503 : 200, json: state.categoryError ? { message: 'Unavailable' } : categories });
    if (path.startsWith('/products/categories/') && request.method() === 'DELETE') {
      const name = decodeURIComponent(path.split('/').pop());
      state.categoryDeletes.push(name);
      if (state.categoryError) return route.fulfill({ status: 409, json: { message: 'Category is now in use.' } });
      categories = categories.filter(item => item.name !== name);
      return route.fulfill({ json: { message: 'Category deleted.', name } });
    }
    if (/^\/products(?:\/\d+)?$/.test(path)) {
      if (request.method() === 'GET') return route.fulfill({ json: products });
      const form = await new Response(request.postDataBuffer(), {
        headers: { 'Content-Type': request.headers()['content-type'] }
      }).formData();
      state.writes.push({ method: request.method(), path, data: Object.fromEntries(form) });
      if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
      return route.fulfill({ status: state.saveError ? 400 : 200, json: { message: state.saveError ? 'Please check your product settings.' : 'Product saved' } });
    }
    if (/^\/(orders|installments|vouchers)(\/|$)/.test(path) || /^\/admin\/(alerts|inventory-movements|customers|collections|layaways|riders|staff|finance)(\/|$)/.test(path)) {
      return route.fulfill({ json: path === '/admin/finance' ? {} : [] });
    }
    return route.continue();
  });
  await mockStoreSession(page);
  await page.goto('http://localhost:3000/admin/dashboard.html', { waitUntil: 'networkidle' });
  if (await page.locator('#adminNavToggle').isVisible()) await page.locator('#adminNavToggle').click();
  await page.locator('[data-section="products"]').click();
  await expect(page.locator('#productTotalCount')).toHaveText('18');
  return state;
}

async function addProduct(page) {
  await page.locator('#products').getByRole('button', { name: 'Add Product', exact: true }).click();
  await expect(page.locator('#productModal')).toBeVisible();
  await page.locator('#name').fill('Warranty Test Product');
  await page.locator('#price').fill('1290');
  await page.locator('#stock').fill('8');
}

test('category manager deletes empty categories and updates both selectors', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 850 });
  const state = await setup(page);
  await page.getByRole('button', { name: 'Manage categories', exact: true }).click();
  const modal = page.locator('#productCategoriesModal');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Delete Phones', exact: true })).toBeDisabled();
  await expect(modal.getByRole('button', { name: 'Delete Accessories', exact: true })).toBeDisabled();
  await expect(modal.getByRole('button', { name: 'Delete Audio', exact: true })).toBeEnabled();
  await modal.getByRole('button', { name: 'Delete Audio', exact: true }).click();
  await page.locator('#appDialogLayer .app-dialog-cancel').click();
  expect(state.categoryDeletes).toEqual([]);
  await modal.getByRole('button', { name: 'Delete Audio', exact: true }).click();
  await expect(page.locator('#appDialogTitle')).toHaveText('Delete this category?');
  await page.locator('#appDialogLayer .app-dialog-submit').click();
  await expect(modal.getByRole('button', { name: 'Delete Audio', exact: true })).toHaveCount(0);
  await expect(page.locator('#categoryDeleteMessage')).toHaveText('Audio deleted.');
  expect(state.categoryDeletes).toEqual(['Audio']);
  await expect(page.locator('#category option[value="Audio"]')).toHaveCount(0);
  await expect(page.locator('#productCategoryFilter option[value="Audio"]')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('categories-mobile.png') });
  const bounds = await modal.locator('.modal-content').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await modal.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh products', exact: true }).click();
  await expect(page.locator('#category option[value="Audio"]')).toHaveCount(0);
});

test('category loading and deletion errors can be retried without hiding failures', async ({ page }) => {
  const state = await setup(page);
  state.categoryError = true;
  await page.getByRole('button', { name: 'Manage categories', exact: true }).click();
  const modal = page.locator('#productCategoriesModal');
  await expect(modal).toContainText('Unable to load categories.');
  state.categoryError = false;
  await modal.getByRole('button', { name: 'Retry', exact: true }).click();
  await modal.getByRole('button', { name: 'Delete Audio', exact: true }).click();
  state.categoryError = true;
  await page.locator('#appDialogLayer .app-dialog-submit').click();
  await expect(page.locator('#categoryDeleteMessage')).toHaveText('Category is now in use.');
  await expect(page.locator('#category option[value="Audio"]')).toHaveCount(1);
});

test('staff cannot access category management', async ({ page }) => {
  await setup(page, 'staff');
  await expect(page.getByRole('button', { name: 'Manage categories', exact: true })).toHaveCount(0);
});

for (const width of [1440, 768, 390, 320]) {
  test(`catalog and warranty editor fit at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await setup(page);
    await page.locator('#products').evaluate(el => el.getAnimations({ subtree: true }).forEach(animation => animation.finish()));
    await expect(page.locator('#productTable .admin-product-card')).toHaveCount(12);
    await expect(page.locator('#productWarrantyCount')).toHaveText('4');
    const overflow = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('main *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, id: el.id, class: el.className, right: el.getBoundingClientRect().right })).slice(0, 12)
    }));
    await page.screenshot({ path: testInfo.outputPath('catalog.png'), fullPage: true });
    expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(width);
    await addProduct(page);
    await page.locator('#productWarrantyTab').click();
    await page.locator('#warrantyEligible').check();
    await expect(page.locator('#productWarrantySettings')).toBeVisible();
    await page.locator('#warrantyCoverage').fill('Manufacturing defects');
    await page.locator('#warrantyExclusions').fill('Accidental damage');
    await page.screenshot({ path: testInfo.outputPath('warranty-editor.png') });
    const bounds = await page.locator('#productModal .modal-content').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(901);
    expect(await page.locator('#productEditorForm').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(page.locator('#saveProductButton')).toBeInViewport();
    for (const tab of ['Details', 'Photos', 'Payment', 'Variants']) {
      await page.locator(`#product${tab}Tab`).click();
      if (tab === 'Payment') await page.locator('#allowLayaway').check();
      if (tab === 'Variants') await page.getByRole('button', { name: 'Add Variant', exact: true }).click();
      expect(await page.locator('#productEditorForm').evaluate(el => el.scrollWidth <= el.clientWidth), `${tab} tab overflows`).toBe(true);
      await expect(page.locator('#saveProductButton')).toBeInViewport();
      if (tab === 'Details' || tab === 'Variants') await page.screenshot({ path: testInfo.outputPath(`${tab.toLowerCase()}-editor.png`) });
    }
    expect(errors).toEqual([]);
  });
}

test('warranty filters, sorting, pagination and reset work together', async ({ page }) => {
  await setup(page);
  await page.locator('#productPagination').getByRole('button', { name: 'Next product page' }).click();
  await expect(page.locator('#productTable .admin-product-card')).toHaveCount(6);
  await page.locator('#productWarrantyFilter').selectOption('eligible');
  await expect(page.locator('#productTable .admin-product-card')).toHaveCount(4);
  await page.locator('#productSort').selectOption('name');
  await expect(page.locator('#productTable .admin-product-card').first()).toHaveAttribute('data-product-id', '1');
  await page.locator('#productSearch').fill('does not exist');
  await expect(page.locator('#productTable')).toContainText('No matching products');
  await page.locator('#products').getByRole('button', { name: 'Reset product filters', exact: true }).click();
  await expect(page.locator('#productTable .admin-product-card')).toHaveCount(12);
});

test('new product is not eligible by default and saves years as months', async ({ page }) => {
  const state = await setup(page);
  await addProduct(page);
  await page.locator('#productWarrantyTab').click();
  await expect(page.locator('#warrantyEligible')).not.toBeChecked();
  await expect(page.locator('#productWarrantySettings')).toBeHidden();
  await page.locator('#warrantyEligible').check();
  await page.locator('#warrantyUnit').selectOption('years');
  await page.locator('#warrantyDuration').fill('2');
  await page.locator('#warrantyCoverage').fill('  Manufacturing defects  ');
  await page.locator('#warrantyExclusions').fill('  Accidental damage  ');
  await expect(page.locator('#productWarrantyPreview')).toHaveText('2 years (24 months)');
  await page.locator('#saveProductButton').click();
  await expect(page.locator('#productModal')).toBeHidden();
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].data).toMatchObject({ warranty_eligible: '1', warranty_duration_months: '24', warranty_coverage: 'Manufacturing defects', warranty_exclusions: 'Accidental damage' });
});

test('editing restores warranty, photos, variants and selling options', async ({ page }) => {
  const state = await setup(page);
  await page.locator('#productSearch').fill('NovaCam');
  await page.getByRole('button', { name: 'Edit NovaCam Pro 5G Smartphone', exact: true }).click();
  await expect(page.locator('#stock')).toHaveValue('0');
  await page.locator('#productWarrantyTab').click();
  await expect(page.locator('#warrantyEligible')).toBeChecked();
  await expect(page.locator('#warrantyDuration')).toHaveValue('18');
  await expect(page.locator('#warrantyUnit')).toHaveValue('months');
  await expect(page.locator('#warrantyCoverage')).toHaveValue('Manufacturing defects');
  await page.locator('#productPhotosTab').click();
  await expect(page.locator('#imagePreview img')).toHaveCount(1);
  await page.locator('#productPaymentTab').click();
  await expect(page.locator('#allowInstallment')).toBeChecked();
  await page.locator('#productVariantsTab').click();
  await expect(page.locator('.variant-name')).toHaveValue('Black 256GB');
  await page.locator('#saveProductButton').click();
  await expect(page.locator('#productModal')).toBeHidden();
  expect(state.writes[0].method).toBe('PUT');
  expect(state.writes[0].data.warranty_duration_months).toBe('18');
  expect(state.writes[0].data.allow_installment).toBe('1');
  expect(JSON.parse(state.writes[0].data.existingImages)).toEqual(['/assets/hero-iphone-style.png']);
});

test('disabling warranty clears persisted terms and hides disabled inputs', async ({ page }) => {
  const state = await setup(page);
  await page.locator('#productSearch').fill('NovaCam');
  await page.getByRole('button', { name: 'Edit NovaCam Pro 5G Smartphone', exact: true }).click();
  await page.locator('#productWarrantyTab').click();
  await page.locator('#warrantyEligible').uncheck();
  await expect(page.locator('#warrantyDuration')).toBeDisabled();
  await page.locator('#saveProductButton').click();
  await expect(page.locator('#productModal')).toBeHidden();
  expect(state.writes[0].data).toMatchObject({ warranty_eligible: '0', warranty_duration_months: '0', warranty_coverage: '', warranty_exclusions: '' });
});

test('photo removal and upload keep previews and saved files consistent', async ({ page }) => {
  const state = await setup(page);
  await page.locator('#productSearch').fill('NovaCam');
  await page.getByRole('button', { name: 'Edit NovaCam Pro 5G Smartphone', exact: true }).click();
  await page.locator('#productPhotosTab').click();
  await page.getByRole('button', { name: 'Remove product image 1', exact: true }).click();
  await expect(page.locator('#imagePreview img')).toHaveCount(0);
  await page.locator('#image').setInputFiles('public/assets/hero-iphone-style.png');
  await expect(page.locator('#imagePreview img')).toHaveCount(1);
  expect(await page.locator('#imagePreview img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.getByRole('button', { name: 'Remove new product image 1', exact: true }).locator('svg')).toBeVisible();
  await page.locator('#saveProductButton').click();
  await expect(page.locator('#productModal')).toBeHidden();
  expect(state.writes[0].data.existingImages).toBe('[]');
  expect(state.writes[0].data.images.name).toBe('hero-iphone-style.png');
});

test('invalid duration blocks save and selects the correct tab', async ({ page }) => {
  const state = await setup(page);
  await addProduct(page);
  await page.locator('#productWarrantyTab').click();
  await page.locator('#warrantyEligible').check();
  await page.locator('#warrantyDuration').fill('0');
  await page.locator('#productDetailsTab').click();
  await page.locator('#saveProductButton').click();
  await expect(page.locator('#productWarrantyTab')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#warrantyDuration')).toBeFocused();
  await expect(page.locator('#productFormError')).toContainText('whole warranty duration');
  expect(state.writes).toHaveLength(0);
});

test('server save error preserves the draft and permits retry', async ({ page }) => {
  const state = await setup(page);
  state.saveError = true;
  await addProduct(page);
  await page.locator('#saveProductButton').click();
  await expect(page.locator('#productFormError')).toHaveText('Please check your product settings.');
  await expect(page.locator('#name')).toHaveValue('Warranty Test Product');
  await expect(page.locator('#saveProductButton')).toBeEnabled();
  state.saveError = false;
  await page.locator('#saveProductButton').click();
  await expect(page.locator('#productModal')).toBeHidden();
  expect(state.writes).toHaveLength(2);
});

test('save guard prevents duplicate submissions', async ({ page }) => {
  const state = await setup(page);
  state.delay = 600;
  await addProduct(page);
  await page.locator('#saveProductButton').click();
  await expect(page.locator('#saveProductButton')).toBeDisabled();
  await page.evaluate(() => saveProduct());
  await expect(page.locator('#productModal')).toBeHidden();
  expect(state.writes).toHaveLength(1);
});

test('keyboard navigation and reopening reset the editor', async ({ page }) => {
  await setup(page);
  await addProduct(page);
  await page.locator('#productDetailsTab').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#productPhotosTab')).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.locator('#productVariantsTab')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#productWarrantyTab').click();
  await page.locator('#warrantyEligible').check();
  await page.locator('#productModal').getByRole('button', { name: 'Cancel', exact: true }).click();
  await addProduct(page);
  await expect(page.locator('#productDetailsTab')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#productWarrantyTab').click();
  await expect(page.locator('#warrantyEligible')).not.toBeChecked();
});

test('staff can view warranty but cannot edit products', async ({ page }) => {
  await setup(page, 'staff');
  await expect(page.locator('#products').getByRole('button', { name: 'Add Product', exact: true })).toBeHidden();
  await expect(page.locator('#productTable .product-row-actions button')).toHaveCount(0);
  await page.locator('#productWarrantyFilter').selectOption('eligible');
  await expect(page.locator('#productTable .admin-product-card')).toHaveCount(4);
});

const { test,expect } = require('@playwright/test');
const { mockStoreSession } = require('./helpers/store-session-ui.cjs');
async function setup(page,{ fail=false }={}) {
  let vouchers = [{ id: 1,code: 'SAVE20',discount_type: 'fixed',discount_value: 20,is_active: 1 }];
  const deletes = [];
  await page.route('**/*',route => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (path === '/vouchers/1' && req.method() === 'DELETE') {
      deletes.push(path); if (fail) return route.fulfill({ status: 500,json: { message: 'Voucher could not be deleted.' } });
      vouchers = []; return route.fulfill({ json: { message: 'Voucher deleted' } });
    }
    if (path === '/vouchers/admin/all') return route.fulfill({ json: vouchers });
    if (['/products','/products/categories','/orders','/installments','/installments/schedules'].includes(path)) return route.fulfill({ json: [] });
    if (path.startsWith('/admin/') && !path.endsWith('.html')) return route.fulfill({ json: path.endsWith('alerts') ? { items: [],summary: {} } : [] });
    return route.continue();
  });
  await mockStoreSession(page,{ user: { id: 1,role: 'admin',name: 'Admin' } });
  await page.goto('http://localhost:3000/admin/dashboard.html',{ waitUntil: 'networkidle' });
  await page.evaluate(() => showSection('vouchers'));
  await expect(page.locator('#voucherTable')).toContainText('SAVE20');
  return deletes;
}
test('confirmed deletion removes the voucher and confirmation names the voucher code',async ({ page }) => {
  const deletes = await setup(page);
  await page.locator('#voucherTable').getByRole('button',{ name: 'Delete',exact: true }).click();
  await expect(page.locator('#appDialogDetails')).toContainText('SAVE20');
  await page.locator('#appDialogForm').getByRole('button',{ name: 'Delete Voucher',exact: true }).click();
  await expect(page.locator('#voucherTable')).not.toContainText('SAVE20');
  expect(deletes).toHaveLength(1);
});
test('cancelling deletion leaves the voucher untouched',async ({ page }) => {
  const deletes = await setup(page);
  await page.locator('#voucherTable').getByRole('button',{ name: 'Delete',exact: true }).click();
  await page.locator('#appDialogForm').getByRole('button',{ name: 'Cancel',exact: true }).click();
  await expect(page.locator('#voucherTable')).toContainText('SAVE20'); expect(deletes).toHaveLength(0);
});
test('delete failures show the backend message and keep the voucher in the list',async ({ page }) => {
  await setup(page,{ fail: true }); let message;
  page.on('dialog',async dialog => { message = dialog.message(); await dialog.accept(); });
  await page.locator('#voucherTable').getByRole('button',{ name: 'Delete',exact: true }).click();
  await page.locator('#appDialogForm').getByRole('button',{ name: 'Delete Voucher',exact: true }).click();
  await expect.poll(() => message).toBe('Voucher could not be deleted.');
  await expect(page.locator('#voucherTable')).toContainText('SAVE20');
});

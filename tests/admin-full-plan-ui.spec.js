const { test, expect } = require('@playwright/test');
const { mockStoreSession } = require('./helpers/store-session-ui.cjs');
const image = '/assets/hero-iphone-style.png';
const application = { id: 61, order_id: 34, full_name: 'Chris Joseph Mananes', customer_email: 'customer@example.com', phone: '09123456789', product_name: 'NovaCam Pro 5G Smartphone', order_total: 16000, status: 'approved', downpayment_status: 'paid', downpayment_amount: 4000, financed_amount: 12000, preferred_terms: 3, monthly_amount: 4000 };
const schedules = [
  { id: 71, order_id: 34, installment_no: 1, due_date: '2026-08-01', amount_due: 4000, amount_paid: 4000, balance: 0, status: 'paid', paid_at: '2026-08-01', payment_status: 'paid', payment_reference: 'GCASH71' },
  { id: 72, order_id: 34, installment_no: 2, due_date: '2026-09-01', amount_due: 4000, amount_paid: 1000, balance: 3000, status: 'overdue', payment_status: 'pending_verification', payment_reference: 'GCASH72' },
  { id: 73, order_id: 34, installment_no: 3, due_date: '2026-11-01', amount_due: 4000, amount_paid: 0, balance: 4000, status: 'current' }
];
const fullPlan = {
  statement: { order_id: 34, customer_name: application.full_name, customer_email: application.customer_email, product_name: application.product_name, payment_status: 'installment_active', order_status: 'processing', total_price: 16000, total_paid: 9000, balance: 7000, overdue_amount: 3000, next_due_date: '2026-09-01', next_due_amount: 3000, installment_terms: 3, installment_downpayment: 4000, installment_monthly: 4000, schedules, payments: [{ id: 81, entry_no: 1, amount_paid: 4000, balance: 12000, status: 'partial', paid_at: '2026-07-01' }, { id: 82, entry_no: 2, amount_paid: 5000, balance: 7000, status: 'partial', paid_at: '2026-08-01' }] },
  plan: { application, customer_phone: application.phone, delivery_address: 'A longer delivery address in Bacacay, Albay', items: [{ product_name: application.product_name, variant_name: 'Midnight Black 256GB', quantity: 1, product_image: image }], downpayment: { status: 'paid', reference: 'DOWNPAYMENT123', proof_image: image, verified_at: '2026-07-01' } }
};

async function setup(page, options = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(role => localStorage.setItem('currentUser', JSON.stringify({ id: 1, role, name: 'Admin User' })), options.role || 'admin');
  await page.route('**/*', route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') return route.fulfill({ status: 400, json: { message: 'Test writes blocked' } });
    if (path.startsWith('/soa/admin/plan/')) return options.planRoute ? options.planRoute(route) : route.fulfill({ json: options.plan || fullPlan });
    if (path === '/installments') return route.fulfill({ json: [application, { ...application, id: 62, order_id: 35, product_name: 'SlatePad Tablet' }] });
    if (path === '/installments/schedules') return route.fulfill({ json: schedules.map(schedule => ({ ...schedule, full_name: application.full_name, product_name: application.product_name })) });
    if (path === '/orders') return route.fulfill({ json: [{ id: 34, created_at: '2026-07-01', product_name: application.product_name, product_image: image, total_price: 16000, payment_method: 'installment', payment_status: 'installment_active', status: 'processing', customer_name: application.full_name }] });
    if (path === '/admin/alerts') return route.fulfill({ json: { summary: {}, items: [] } });
    if (['/admin/finance', '/admin/collections', '/admin/layaways', '/admin/riders/assignments'].includes(path)) return route.fulfill({ json: { data: {}, items: [], summary: {} } });
    if (['/products', '/products/categories', '/admin/customers', '/admin/staff', '/admin/riders', '/admin/inventory-movements', '/vouchers/admin/all', '/admin/audit-logs'].includes(path)) return route.fulfill({ json: [] });
    return route.continue();
  });
  await mockStoreSession(page);
  await page.goto('http://localhost:3000/admin/dashboard.html', { waitUntil: 'networkidle' });
  if (options.role !== 'staff') await page.evaluate(() => showSection('installments'));
  return errors;
}

async function openPlan(page) {
  await page.locator('#installmentTable tr').first().getByRole('button', { name: 'View Full Plan', exact: true }).click();
  await expect(page.locator('#installmentPlanModal')).toBeVisible();
  await expect(page.locator('#installmentPlanBody')).toHaveAttribute('aria-busy', 'false');
}

for (const width of [1440, 768, 390, 320]) {
  test(`full plan and all tabs fit at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 850 });
    const errors = await setup(page);
    await openPlan(page);
    await expect(page.locator('#installmentPlanTitle')).toHaveText(application.product_name);
    await expect(page.locator('.full-plan-metrics')).toContainText('9,000.00');
    await expect(page.locator('.full-plan-metrics')).toContainText('7,000.00');
    await expect(page.locator('.full-plan-metrics')).toContainText('3,000.00');
    await expect(page.locator('.full-plan-product img')).toBeVisible();
    expect(await page.locator('.full-plan-product img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    for (const [key, label] of [['overview', 'Overview'], ['schedule', 'Monthly Schedule'], ['history', 'Payment History']]) {
      await page.getByRole('tab', { name: label, exact: true }).click();
      await expect(page.locator(`#fullPlanPanel-${key}`)).toBeVisible();
      expect(await page.locator('#installmentPlanBody').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      const bounds = await page.locator('#installmentPlanModal .modal-content').boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(851);
      await page.locator('#installmentPlanBody').evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: info.outputPath(`${key}.png`) });
    }
    await expect(page.locator('#fullPlanPanel-history')).toContainText('DOWNPAYMENT123');
    await expect(page.locator('#fullPlanPanel-history')).toContainText('GCASH72');
    await expect(page.locator('#fullPlanPanel-history').getByRole('link', { name: 'View Proof', exact: true })).toHaveAttribute('href', image);
    expect(errors).toEqual([]);
  });
}

test('keyboard tabs and close controls work and separate plans do not mix', async ({ page }) => {
  await setup(page, { planRoute: route => {
    const id = Number(new URL(route.request().url()).pathname.split('/').pop());
    const data = structuredClone(fullPlan);
    data.statement.order_id = id;
    if (id === 35) { data.statement.product_name = 'SlatePad Tablet'; data.statement.total_paid = 0; data.plan.items[0].product_name = 'SlatePad Tablet'; }
    return route.fulfill({ json: data });
  } });
  await openPlan(page);
  await page.getByRole('tab', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Monthly Schedule', exact: true })).toBeFocused();
  await expect(page.locator('#fullPlanPanel-schedule tbody tr')).toHaveCount(3);
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Payment History', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Close full plan', exact: true }).click();
  await expect(page.locator('#installmentPlanModal')).toBeHidden();
  await page.locator('#installmentTable tr').nth(1).getByRole('button', { name: 'View Full Plan', exact: true }).click();
  await expect(page.locator('#installmentPlanTitle')).toHaveText('SlatePad Tablet');
  await expect(page.locator('.full-plan-product')).toContainText('SlatePad Tablet');
  await expect(page.locator('.full-plan-metrics')).not.toContainText('9,000.00');
});

test('approved but unpaid downpayment shows no fabricated schedule or collection action', async ({ page }) => {
  const plan = structuredClone(fullPlan);
  plan.plan.downpayment.status = 'pending';
  plan.statement.schedules = [];
  plan.statement.payments = [];
  plan.statement.total_paid = 0;
  plan.statement.next_due_date = null;
  await setup(page, { plan });
  await openPlan(page);
  await expect(page.locator('.full-plan-heading')).toContainText('Awaiting verified downpayment');
  await page.getByRole('tab', { name: 'Monthly Schedule', exact: true }).click();
  await expect(page.locator('#fullPlanPanel-schedule')).toContainText('No monthly schedule yet');
  await expect(page.locator('#installmentPlanModal').getByRole('button', { name: 'Record Payment', exact: true })).toHaveCount(0);
});

test('manual payment reuses the confirmation form and refreshes the same plan', async ({ page }) => {
  const data = structuredClone(fullPlan);
  await setup(page, { planRoute: route => route.fulfill({ json: data }) });
  let recorded;
  await page.route('**/installments/schedules/72/pay', route => {
    recorded = route.request().postDataJSON();
    data.statement.schedules[1] = { ...data.statement.schedules[1], amount_paid: 4000, balance: 0, status: 'paid' };
    data.statement.total_paid = 12000;
    data.statement.balance = 4000;
    return route.fulfill({ json: { message: 'Payment recorded' } });
  });
  await openPlan(page);
  await page.getByRole('tab', { name: 'Monthly Schedule', exact: true }).click();
  await page.locator('#fullPlanPanel-schedule tbody tr').nth(1).getByRole('button', { name: 'Record Payment', exact: true }).click();
  await expect(page.locator('#appDialogLayer')).toBeVisible();
  await expect(page.locator('#appDialogLayer input[name="amount"]')).toHaveValue('3000.00');
  expect(recorded).toBeUndefined();
  await page.locator('#appDialogLayer .app-dialog-submit').click();
  await expect.poll(() => recorded?.amount_paid).toBe(3000);
  await expect(page.locator('.full-plan-metrics')).toContainText('12,000.00');
  await expect(page.getByRole('tab', { name: 'Monthly Schedule', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('failed plan loading retries without stale customer details', async ({ page }) => {
  let fail = true;
  await setup(page, { planRoute: route => fail ? route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } }) : route.fulfill({ json: fullPlan }) });
  await openPlan(page);
  await expect(page.locator('#installmentPlanBody')).toContainText('Unable to load plan');
  await expect(page.locator('.full-plan-metrics')).toHaveCount(0);
  fail = false;
  await page.locator('#installmentPlanModal').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('#installmentPlanTitle')).toHaveText(application.product_name);
});

test('view order closes the full plan before opening the existing order modal', async ({ page }) => {
  const errors = await setup(page);
  await openPlan(page);
  await page.locator('#installmentPlanModal').getByRole('button', { name: 'View Order', exact: true }).click();
  await expect(page.locator('#installmentPlanModal')).toBeHidden();
  await expect(page.locator('#orderModal')).toBeVisible();
  await expect(page.locator('#orderModalBody')).toContainText(application.product_name);
  expect(errors).toEqual([]);
});

test('staff cannot open the admin full plan', async ({ page }) => {
  let requested = false;
  page.on('dialog', dialog => dialog.accept());
  await setup(page, { role: 'staff', planRoute: route => { requested = true; return route.fulfill({ json: fullPlan }); } });
  await page.evaluate(() => viewInstallmentFullPlan(34));
  await expect(page.locator('#installmentPlanModal')).toBeHidden();
  expect(requested).toBe(false);
});

test('a late response cannot replace another customer plan', async ({ page }) => {
  let first;
  await setup(page, { planRoute: route => {
    if (new URL(route.request().url()).pathname.endsWith('/34')) { first = route; return; }
    const data = structuredClone(fullPlan);
    data.statement.order_id = 35;
    data.statement.product_name = 'SlatePad Tablet';
    return route.fulfill({ json: data });
  } });
  await page.evaluate(() => { viewInstallmentFullPlan(34); });
  await expect.poll(() => Boolean(first)).toBe(true);
  await expect(page.locator('#installmentPlanBody')).toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => { viewInstallmentFullPlan(35); });
  await expect(page.locator('#installmentPlanTitle')).toHaveText('SlatePad Tablet');
  await first.fulfill({ json: fullPlan });
  await expect(page.locator('#installmentPlanTitle')).toHaveText('SlatePad Tablet');
});

test('rejected application cannot collect even when an old schedule exists', async ({ page }) => {
  const data = structuredClone(fullPlan);
  data.plan.application.status = 'rejected';
  await setup(page, { plan: data });
  await openPlan(page);
  await expect(page.locator('.full-plan-heading')).toContainText('Application rejected');
  await page.getByRole('tab', { name: 'Monthly Schedule', exact: true }).click();
  await expect(page.locator('#installmentPlanModal').getByRole('button', { name: 'Record Payment', exact: true })).toHaveCount(0);
});

test('closing while loading invalidates the pending response and permits reopening', async ({ page }) => {
  let pending;
  let delay = true;
  await setup(page, { planRoute: route => { if (delay) { pending = route; return; } return route.fulfill({ json: fullPlan }); } });
  await page.evaluate(() => { viewInstallmentFullPlan(34); });
  await expect.poll(() => Boolean(pending)).toBe(true);
  await page.getByRole('button', { name: 'Close full plan', exact: true }).click();
  await expect(page.locator('#installmentPlanModal')).toBeHidden();
  await pending.fulfill({ json: fullPlan });
  await expect(page.locator('#installmentPlanModal')).toBeHidden();
  delay = false;
  await openPlan(page);
  await expect(page.locator('#installmentPlanTitle')).toHaveText(application.product_name);
});

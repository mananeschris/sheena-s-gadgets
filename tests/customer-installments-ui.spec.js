const { test, expect } = require('@playwright/test');

for (const width of [1440, 390]) {
  test(`installment activity at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.addInitScript(() => localStorage.setItem('currentUser', JSON.stringify({
      id: 101, name: 'Chris Joseph B. Mananes', email: 'customer@example.com', role: 'customer'
    })));
    const date = offset => {
      const value = new Date();
      value.setDate(value.getDate() + offset);
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    };
    const schedules = [
      { id: 1, order_id: 91, product_name: 'NovaCam Pro 5G Smartphone', installment_no: 1, due_date: date(-5), amount_due: 2000, amount_paid: 500, status: 'partial' },
      { id: 2, order_id: 91, product_name: 'NovaCam Pro 5G Smartphone', installment_no: 2, due_date: date(3), amount_due: 2000, amount_paid: 0, status: 'unpaid', payment_status: 'pending_verification' },
      { id: 3, order_id: 91, product_name: 'NovaCam Pro 5G Smartphone', installment_no: 3, due_date: date(-35), amount_due: 2000, amount_paid: 2000, status: 'paid' }
    ];
    const applications = [
      { id: 1, order_id: 91, product_name: 'NovaCam Pro 5G Smartphone', status: 'approved', preferred_terms: 6, downpayment_amount: 3000, monthly_amount: 2000, order_payment_status: 'installment_active' },
      { id: 2, order_id: 92, product_name: 'SlatePad 10.4 Tablet', status: 'pending', preferred_terms: 3, downpayment_amount: 2500, monthly_amount: 1500 }
    ];
    await page.route('**/installments/customer/101/schedules', route => route.fulfill({ json: schedules }));
    await page.route('**/installments/customer/101', route => route.fulfill({ json: applications }));
    await page.goto('http://localhost:3000/customer/profile.html#installments', { waitUntil: 'networkidle' });
    await expect(page.locator('.plan-schedule-item')).toHaveCount(3);
    await expect(page.locator('#installmentOverview')).toContainText('3,500.00');
    await expect(page.locator('#requestsCount')).toHaveText('2');
    await expect(page.locator('.plan-reminder')).toHaveCount(2);
    const paid = page.locator('.plan-schedule-item').filter({ has: page.locator('.payment-state.paid') });
    await expect(paid.locator('button')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Check Review' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Pay with GCash' })).toHaveCount(1);
    await expect(page.locator('.plan-schedule-item progress').first()).toHaveAttribute('value', '500');
    await page.locator('#installmentsSection').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/installments-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.locator('#installmentScheduleFilter').selectOption('paid');
    await expect(page.locator('.plan-schedule-item')).toHaveCount(1);
    await page.locator('#installmentScheduleFilter').selectOption('unpaid');
    await expect(page.locator('.plan-schedule-item')).toHaveCount(2);
    await page.getByRole('tab', { name: /Plan Requests/ }).click();
    await expect(page.locator('#schedulePanel')).toBeHidden();
    await expect(page.locator('.plan-request')).toHaveCount(2);
    await expect(page.locator('.plan-request').first()).toContainText('Your monthly payment schedule is available.');
    await expect(page.locator('.plan-request').first().getByRole('link', { name: 'Pay Downpayment' })).toHaveCount(0);
    await page.screenshot({ path: `test-results/installment-requests-${width}.png` });
    await page.locator('#requestsTab').press('ArrowLeft');
    await expect(page.locator('#scheduleTab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#schedulePanel')).toBeVisible();
    await page.evaluate(() => {
      installmentSchedules = [];
      installmentApplications = [];
      renderInstallmentDueAlerts();
      renderInstallmentSchedules();
      renderInstallmentApplications();
    });
    await expect(page.locator('#installmentDueSection')).toBeHidden();
    await expect(page.locator('#installmentScheduleList')).toContainText('No monthly schedule yet');
    await expect(page.locator('#installmentScheduleFilter')).toBeHidden();
    await page.getByRole('button', { name: 'View Plan Requests' }).click();
    await expect(page.locator('#installmentApplicationList')).toContainText('No plan requests yet');
  });
}

const fs = require('node:fs');
const path = require('node:path');

// UI-only fixtures mock authentication; the MySQL suite tests real authorization.
async function mockStoreSession(page, options = {}) {
  const html = fs.readFileSync(path.resolve(__dirname, '../../public/admin/dashboard.html'), 'utf8');
  await page.route(/\/(admin|staff)\/dashboard\.html(?:\?|$)/, route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.route('**/auth/session', async route => {
    const user = options.user || await page.evaluate(() => JSON.parse(localStorage.getItem('currentUser') || 'null'));
    return route.fulfill(user ? { json: { user, remaining_seconds: options.remaining_seconds ?? 900 } } : { status: 401, json: { message: 'Sign in again.' } });
  });
  await page.route('**/auth/session/activity', route => route.fulfill({ json: { message: 'Session active.' } }));
  if (options.deliveryNotifications !== false) {
    await page.route('**/admin/riders/delivery-notifications**', route => route.fulfill({ json: { items: [] } }));
  }
}
module.exports = { mockStoreSession };

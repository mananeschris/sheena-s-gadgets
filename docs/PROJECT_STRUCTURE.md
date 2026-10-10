# Project Structure

This file is the working map for Sheena's Gadgets & Accessories Shop.

## Root Files

- `server.js` - Express server, static frontend hosting, API route registration, and schema health startup check.
- `package.json` - Node dependencies and start script.
- `package-lock.json` - Locked dependency versions.
- `render.yaml` - Render deployment configuration.
- `.env.example` - Example environment variables. Do not put real secret keys here.
- `README.md` - Public project overview.

## Backend

- `db/connection.js` - MySQL connection setup.
- `db/schemaHealth.js` - Startup database schema repair/checks.
- `routes/auth.js` - Login, registration, customer Gmail verification code flow, and account authentication.
- `routes/products.js` - Product catalog, images, variants, and product management.
- `routes/orders.js` - Customer orders, checkout records, and order status.
- `routes/payments.js` - Manual GCash proof verification and payment-related endpoints.
- `routes/installments.js` - Installment application, approval, downpayment, and schedules.
- `routes/layaways.js` - Layaway reservations, payments, deadlines, release, and cancellation.
- `routes/reviews.js` - Product/order reviews and review photos.
- `routes/riders.js` - Rider assignment and rider delivery dashboard endpoints.
- `routes/staff.js` - Staff account management.
- `routes/dashboard.js` - Admin dashboard metrics.
- `routes/adminFinance.js` - Finance reports.
- `routes/adminCollections.js` - Installment collection workflows.
- `routes/adminAlerts.js` - Admin alerts/reminders.
- `routes/customers.js` - Admin customer records.
- `routes/customerAddresses.js` - Customer saved delivery addresses.
- `routes/notifications.js` - Customer/admin notification records.
- `routes/inventoryMovements.js` - Inventory movement logs.
- `routes/receivables.js` - Admin receivable views.
- `routes/soa.js` - Statement of account records.
- `routes/auditLogs.js` - Admin activity/audit history.
- `routes/vouchers.js` - Voucher/promo logic.
- `routes/stockRestore.js` - Stock restoration helper.
- `routes/orderSchema.js` - Order table/schema helper.
- `routes/orderReference.js` - Simple unique order reference helper.
- `routes/roleGuard.js` - Role access checks.

## Frontend Pages

- `public/customer/shop.html` - Main customer shop/catalog page.
- `public/customer/product.html` - Product details, variants, reviews, add to cart, and buy now.
- `public/customer/profile.html` - Customer profile, order center, payments, repair requests, layaway/installment activity.
- `public/customer/order.html` - Customer single order view and tracking.
- `public/customer/review.html` - Customer review writing page.
- `public/auth.html` - Customer/admin/staff/rider login and customer registration.
- `public/checkout.html` - Checkout flow, delivery profile, payment method, installment/layaway entry.
- `public/admin/dashboard.html` - Admin and staff dashboard features.
- `public/rider/dashboard.html` - Rider delivery dashboard.
- `public/payment-result.html` - Payment status/result page for payment-related return links.
- `public/index.html` - Entry page. The server root currently sends customers to `public/customer/shop.html`.

## Frontend Scripts

- `public/js/customer.js` - Customer shop catalog behavior.
- `public/js/cart.js` - Shared cart behavior for customer shop/product pages.
- `public/js/customer-notifications.js` - Customer notification panel.
- `public/js/profile-notifications.js` - Profile notification rendering.
- `public/js/customer-profile.js` - Customer profile page behavior extracted from the profile HTML.
- `public/js/admin-dashboard.js` - Admin/staff dashboard behavior extracted from the dashboard HTML.
- `public/js/order-reference.js` - Frontend order reference display helper.
- `public/js/finance-reports.js` - Admin finance report rendering/export helpers.

## Styling

- `public/css/main.css` - Legacy/shared styling still used by some support pages.
- `public/css/ui-polish.css` - Shared customer-facing UI polish for several pages.
- `public/css/customer-profile.css` - Customer profile base layout extracted from the profile HTML.
- `public/css/customer-shop.css` - Customer shop/catalog styling.
- `public/css/customer-cart.css` - Shared cart panel styling.
- `public/css/customer-mobile.css` - Customer mobile responsiveness fixes.
- `public/css/checkout-dark.css` - Checkout-specific styling.
- `public/css/auth-polish.css` - Login/register/verification page styling.
- `public/css/admin-dashboard.css` and `public/css/admin-dashboard-fix.css` - Admin/staff dashboard styling.
- `public/css/profile-navigation.css` and `public/css/profile-sections.css` - Customer profile layout and sections.
- `public/css/order-tracking.css` - Customer order tracking page styling.
- `public/css/store-footer.css` - Shared footer styling.
- `public/css/system-fonts.css` - Shared fonts, black/white tokens, brand logo sizing, and base typography helpers.
- `src/styles/tailwind.css` and `public/css/tailwind.css` - Tailwind source and generated output. Rebuild with `npm run build:css` after changes.

## Assets And Uploads

- `public/assets/sheena-mark.svg` - Small brand mark used in nav/header.
- `public/assets/sheena-logo.svg` - Dashboard brand logo.
- `public/assets/hero-iphone-style.png` - Current generated hero image.
- `public/assets/catalog-phone-bg.png` - Older gadget background image.
- `public/uploads/catalog/photos/` - Seed product photos shown in the catalog.
- `uploads/` - Runtime upload storage served by the backend as `/uploads/...`.
- `uploads/catalog/` - SVG seed assets. Keep unless product records no longer reference them.

## Cleanup Rules

- Do not move `public/customer/*.html` yet because routes and links already point there.
- Do not move `uploads/` because the server exposes it directly as `/uploads`.
- Prefer editing the CSS file already linked by the page you are changing. For shared customer UI, use `public/css/ui-polish.css`; for generated Tailwind output, edit `src/styles/tailwind.css` and rebuild.
- Keep backend changes inside the matching `routes/*.js` file unless the logic is shared.
- Avoid adding new top-level folders unless they have a clear purpose.
- Keep temporary screenshots and release/archive copies outside the root project folder.

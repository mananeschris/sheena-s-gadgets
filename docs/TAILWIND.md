# Styling Notes

The project currently uses a mixed frontend styling setup:

- Bootstrap CSS is still linked by most HTML pages.
- Shared colors, fonts, brand logo sizing, and base typography live in `public/css/system-fonts.css`.
- Several page-specific vanilla CSS files polish the customer, checkout, auth, admin, profile, and order pages.
- Tailwind is available through `src/styles/tailwind.css`, with generated output in `public/css/tailwind.css`, but not every page currently links the generated file.

## Current Rule

When improving a page, edit the stylesheet already linked by that page unless you are intentionally migrating that page to Tailwind.

Use `public/css/system-fonts.css` only for shared tokens/base styles that should apply across the whole system. Keep page layout rules inside the page-specific CSS file.

Examples:

- Customer shop: `public/css/customer-shop.css`, `public/css/customer-cart.css`, `public/css/customer-mobile.css`, `public/css/ui-polish.css`
- Product page: `public/css/ui-polish.css`, `public/css/customer-cart.css`, `public/css/customer-mobile.css`
- Checkout: `public/css/checkout-dark.css`, `public/css/ui-polish.css`
- Auth: `public/css/auth-polish.css`, `public/css/ui-polish.css`
- Profile: `public/css/profile-navigation.css`, `public/css/profile-sections.css`, `public/css/ui-polish.css`
- Admin/staff dashboard: `public/css/admin-dashboard-fix.css`
- General support pages: `public/css/main.css`, `public/css/store-footer.css`, `public/css/system-fonts.css`

## Tailwind Build

If `src/styles/tailwind.css` is changed, rebuild:

```bash
npm run build:css
```

`public/css/tailwind.css` is generated output. Do not manually edit it.

## Verification

With the local server running, run:

```bash
npx playwright test tests/auth-ui.spec.js tests/customer-shop-ui.spec.js tests/product-ui.spec.js tests/profile-ui.spec.js tests/admin-ui.spec.js tests/checkout-ui.spec.js --workers=1
```

The tests use isolated browser contexts and mocked/intercepted API responses where applicable.

## Cleanup Guidance

Do not add temporary screenshots to the project root. Use `test-results/` or an ignored local folder for UI verification output.

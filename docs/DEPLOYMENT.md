# Deployment Checklist

The Render blueprint uses a **Free web service and external Supabase Storage**. No deployment, account creation, or purchase is performed by editing these files. Stay on Free plans and monitor quotas. Render sleeps after 15 minutes idle and may take about a minute to wake up.

## Database

Recommended free option: **Aiven for MySQL Free**, not its paid/trial plan. Official limits: https://aiven.io/docs/products/mysql/concepts/mysql-free-tier (1 GB disk, 76 connections, one MySQL service per organization; inactivity may power the service off).

Create the service, copy host/port/database/user settings into Render, and store its password only in environment settings. Download its CA certificate and set `DB_SSL=true` plus `DB_SSL_CA_BASE64` to the base64-encoded certificate. Import the chosen testing backup and verify migrations against this hosted service before sharing the URL. This project does not create an Aiven account or import data automatically.

- Create hosted MySQL, import the intended database backup, and verify the retained admin account. Render cannot connect to MySQL at `127.0.0.1` on your PC.
- Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` in Render. Use a dedicated database account scoped to this database, not a publicly accessible root account.
- TLS is enabled by default in production. Set `DB_SSL=true`; if your provider requires a CA, base64 encode its PEM certificate into `DB_SSL_CA_BASE64`. Never disable certificate verification. Set `DB_SSL=false` only for a database on a trusted private network that does not offer TLS.
- Current startup migrations require CREATE and ALTER privileges within the selected database. Startup fails instead of serving a broken app when schema initialization fails.
- Keep a separate offline database backup. This checklist does not delete or reset any local database.

## Environment

- Set `APP_BASE_URL` to the final public HTTPS origin.
- Configure Brevo: `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, and a unique random `EMAIL_VERIFICATION_SECRET` (at least 32 characters). Admin sign-in, invitations, and recovery require working email delivery.
- Configure `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL`; or set `AI_ASSISTANT_ENABLED=false`. Never commit API keys.
- Set GCash account details and QR image URL. Static QR assets are included in the repository.
- Node 24 is specified in package.json. Render runs `npm ci --omit=dev` using the lockfile; compiled CSS is already in public/css. Run the CSS build locally when changing its source.

## Uploads And Backups

For Render Free:

1. Create a Supabase Free project, then create a **private** Storage bucket named `shop-files`. Never make this bucket public: it contains payment proofs and identity documents.
2. Set `STORAGE_PROVIDER=supabase`, `SUPABASE_URL` (project HTTPS URL), `SUPABASE_SERVICE_ROLE_KEY` (server-only service role key), and `SUPABASE_STORAGE_BUCKET=shop-files` in Render environment settings. Never paste the key into chat, commit it, or use it in frontend code.
3. The backend validates media, uploads it before saving its database reference, and serves private objects only after session/ownership checks. Signed storage URLs remain server-side; browser URLs do not change. Videos support byte-range playback through the backend.
4. Free storage currently includes 1 GB; projects can pause after a week of inactivity. Monitor storage and bandwidth usage at https://supabase.com/pricing. Render limits: https://render.com/docs/free.

Supabase uses PostgreSQL, not MySQL. This integration uses **Storage only**; it does not migrate the database. A compatible hosted MySQL database is still required before deployment. Do not use temporary database trials without understanding expiry and backup requirements.

Local development still defaults to disk. Optional paid disk mode uses `STORAGE_PROVIDER=disk` and `STORAGE_DIR=/var/data`:

- Product/review media: `/var/data/uploads`.
- GCash proofs: `/var/data/private/payment-proofs`.
- Installment ID documents: `/var/data/private/order-documents`.
- Delivery proofs: `/var/data/private/delivery-proofs`.

Payment and ID photo URLs require a real authenticated session and owner/staff/admin authorization. They are not served by public static middleware. Legacy local `/uploads/payments/...` and flat installment photo references remain protected.

Customer email changes are not accepted through the ordinary profile-save endpoint, because that endpoint cannot verify a new address. The current email remains read-only until a verified email-change workflow is added. Password changes expire other devices and pending sign-in codes while retaining the authenticated device.

When importing a database with existing file references, transfer the referenced files too. In Supabase the object prefixes are `public/`, `payment-proofs/`, `order-documents/`, and `delivery-proofs/`. Preserve filenames and database URLs. Move legacy installment ID photos to `order-documents/`, never `public/`. A database-only import does not transfer media. Verify several private/public photos after transfer. Existing local uploads are not automatically migrated.

Back up MySQL and file storage separately, monitor capacity, and test restore. Render Free local staging files are temporary; persistent uploads must be in Supabase. Keep Brevo's HTTPS API configuration, because Render Free blocks common SMTP ports.

## Before Sharing The URL

1. Commit all intended project files, including currently untracked routes, services, assets, and lockfile. Exclude .env, backups, runtime private proofs, and local logs.
2. Run `npm run test:unit`, UI tests, and `npm audit --omit=dev`.
3. Confirm `/healthz` is HTTP 200 and the database is the intended deployment database.
4. Test real signup/verification, admin email code, staff/rider activation, checkout, payment approval/rejection, delivery photo, and private photo access from an unrelated account.
5. Restart the deployed service and confirm uploaded media still loads. No real customer testing until these checks pass.

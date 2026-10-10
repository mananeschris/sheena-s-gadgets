# Delivery Messaging

Text-only customer/rider inbox, shared across the customer pages and rider dashboard.
The existing delivery status and payment workflows are unchanged.

## Access And Lifecycle

- Login and completed email two-factor sign-in issue an HttpOnly, SameSite=Strict
  `delivery_session` cookie. The database stores a SHA-256 token hash, not the token.
- Chat verifies the session against the users table. `actor_id` and localStorage alone
  do not authorize access. `X-Chat-User` must match the session account to prevent
  accidental account mixing across tabs.
- Customers can read their own current and previous assignment conversations.
- Riders can read only their current assignment generation. Reassignment increments
  `delivery_assignments.chat_generation`; the previous rider immediately loses access.
- Assigned, picked-up, out-for-delivery and failed-attempt deliveries support sending.
  Closed assignments or delivered/cancelled orders are read-only.
- Messages do not change addresses, payment plans or delivery statuses.
- There is no admin chat viewer, attachment upload, push notification or live GPS in
  this version. Message notifications use the inbox unread badge.

## Data And Delivery

Startup adds the generation column and creates `delivery_chat_threads` and
`delivery_chat_messages` if absent. First sign-in creates `delivery_chat_sessions`.
No existing orders, payments, customers or products are deleted.

Threads snapshot the assignment generation and participants. Sending rechecks
ownership and closure atomically in the INSERT. A client UUID deduplicates retries.
The server limits messages to 1,000 characters and applies a per-sender rate check.

The inbox polls every five seconds when open, twenty seconds when closed, and pauses
while the page is hidden. Message history is paginated in batches of 100. Read receipts
are recorded only when the conversation is open on a visible page.

## Local Testing

Use the same server/port for admin, customer and rider. Existing browser sessions
need a fresh sign-in. To test two accounts simultaneously, use separate browser
profiles or a normal and incognito window; cookies are shared between ordinary tabs.

```powershell
node --test tests/delivery-chat-api.test.cjs
npx playwright test tests/delivery-chat-ui.spec.js --workers=1
$env:RUN_CHAT_MYSQL='1'
node --test tests/delivery-chat-mysql.integration.cjs
```

The optional MySQL test creates and tears down only a randomly named `chat_test_*`
database. It never seeds or deletes production orders or accounts. It requires a
local database user with database-creation privileges.

Production requires HTTPS because messaging cookies are Secure in production.
The session mechanism protects chat; it is not a migration of the application's
older ID-based authorization endpoints.

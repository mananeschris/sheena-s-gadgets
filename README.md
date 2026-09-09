# Sheena's Gadgets & Accessories Shop

Fintech-integrated ecommerce capstone project for a gadget and accessories shop. The system includes customer shopping, checkout, admin management, POS, inventory, installment, layaway, rider delivery workflow, repair requests, notifications, and payment testing support.

## Features

- Customer product catalog with product details, cart, checkout, reviews, profile, and order tracking
- Admin dashboard for products, inventory, orders, POS, analytics, staff, riders, installments, layaway, repairs, vouchers, and finance reports
- Rider dashboard for delivery assignments and delivery status updates
- MySQL-backed Express server
- PayMongo test payment flow support through environment variables

## Requirements

- Node.js
- MySQL / MySQL Workbench
- PayMongo sandbox keys for test online payments

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env`, then update the database and PayMongo values.

3. Make sure MySQL is running and the database credentials are correct.

4. Start the system:

```bash
npm start
```

5. Open the app:

```text
http://localhost:3000
```

## Notes

- Do not upload `.env` because it contains private keys and local credentials.
- Use PayMongo sandbox keys while testing payments.
- The database schema is checked and repaired by the server-side schema health logic when the app runs.

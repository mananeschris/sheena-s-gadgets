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

## Render Deployment

This project includes `render.yaml` for Render web service deployment.

Before the deployed site can fully run, add these environment variables in Render:

```text
NODE_ENV=production
APP_BASE_URL=https://your-render-site.onrender.com
DB_HOST=your_online_mysql_host
DB_USER=your_online_mysql_user
DB_PASSWORD=your_online_mysql_password
DB_NAME=your_online_mysql_database
DB_PORT=your_online_mysql_port
PAYMONGO_SECRET_KEY=your_paymongo_test_secret_key
PAYMONGO_PUBLIC_KEY=your_paymongo_test_public_key
PAYMONGO_WEBHOOK_SECRET=your_paymongo_webhook_secret_if_used
```

Use an online MySQL database for deployment. A local MySQL database from your PC cannot be reached by Render.

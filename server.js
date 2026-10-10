const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  fs.readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) return;
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    });
}

loadEnvFile();
require('./services/productionConfig').validateProductionConfig();
const uploadStorage = require('./services/uploadStorage');
uploadStorage.ensureUploadDirectories();

const app = express();
const PORT = Number(process.env.PORT || 3000);
if (process.env.RENDER === 'true') app.set('trust proxy', 1);
app.disable('x-powered-by');

// middleware
app.use(cors({ origin: false }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// IMPORTANT: support JSON + form-data fallback
app.use('/ai-assistant', express.json({ limit: '48kb' }), (error, req, res, next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ message: 'This conversation is too large. Start a new chat.' });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid chat request.' });
  next(error);
});
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString("utf8");
  }
}));
app.use(express.urlencoded({ extended: true }));

// DB
const db = require("./db/connection");
const { ensureCoreSchema } = require("./db/schemaHealth");
app.use(db.middleware);
app.get('/healthz', (req, res) => {
  db.query('SELECT 1', error => res.status(error ? 503 : 200).json({ status: error ? 'unavailable' : 'ok' }));
});
const riderRoutes = require("./routes/riders");
const deliveryChat = require("./routes/deliveryChat");

app.use((req, res, next) => {
  req.db = db;
  if (process.env.NODE_ENV === 'production') {
    const json = res.json.bind(res);
    res.json = body => json(res.statusCode >= 500 ? { message: 'The service is temporarily unavailable. Please try again.' } : body);
  }
  next();
});

const { requireAdminOrStaff } = require('./routes/roleGuard');
app.get(['/admin/dashboard.html', '/staff/dashboard.html'], async (req, res) => {
  try {
    const session = await require('./routes/adminSessions').storeSession(req);
    if (!session || !['admin', 'staff'].includes(session.role)) {
      return res.redirect(`/auth.html?returnTo=${encodeURIComponent(req.path)}`);
    }
    const destination = `/${session.role}/dashboard.html`;
    if (req.path !== destination) return res.redirect(destination);
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'public/admin/dashboard.html'));
  } catch (_) { res.status(503).send('Unable to verify your session. Please try again.'); }
});
app.use('/admin', requireAdminOrStaff);
app.use('/dashboard', requireAdminOrStaff);

// static frontend
app.use(express.static("public", {
  index: false,
  etag: false,
  maxAge: 0,
  setHeaders(res, filePath) {
    if (/\.(html|css|js)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    }
  }
}));

// uploads folder
app.use('/uploads', require('./routes/uploadFiles'));
app.use(uploadStorage.discardFailedUploads);

// routes
app.use("/auth", require("./routes/auth"));
app.use('/staff/account', require('./routes/staffAccount'));
app.use('/account-invitations', require('./routes/employeeAccounts').router);
app.use("/products", require("./routes/products"));
app.use("/orders", require("./routes/orders"));
app.use("/reviews", require("./routes/reviews"));
app.use("/payments", require("./routes/payments"));
app.use("/installments", require("./routes/installments"));
app.use("/notifications", require("./routes/notifications"));
app.use("/customer/addresses", require("./routes/customerAddresses"));
app.use("/vouchers", require("./routes/vouchers"));
app.use("/layaways", require("./routes/layaways"));
app.use("/admin/receivables", require("./routes/receivables"));
app.use("/admin/alerts", require("./routes/adminAlerts"));
app.use("/admin/collections", require("./routes/adminCollections"));
app.use("/admin/layaways", require("./routes/layaways"));
app.use("/dashboard", require("./routes/dashboard"));
app.use("/soa", require("./routes/soa"));
app.use("/admin/finance", require("./routes/adminFinance"));
app.use("/admin/customers", require("./routes/customers"));
app.use("/admin/staff", require("./routes/staff"));
app.use("/admin/riders", riderRoutes);
app.use("/rider", riderRoutes.riderRouter);
app.use("/delivery-chat", deliveryChat);
app.use("/order-support", require("./routes/orderSupport"));
app.use('/ai-assistant', require('./routes/shopAssistant'));
app.use("/admin/audit-logs", require("./routes/auditLogs"));
app.use("/admin/inventory-movements", require("./routes/inventoryMovements"));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error instanceof require('multer').MulterError || /images must|files are allowed/i.test(error.message || '') ? 400 : 500;
  res.status(status).json({ message: status === 400 ? 'Invalid upload. Check the file type, size, and count.' : 'Unable to complete this request.' });
});

// home
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/customer/shop.html");
});

// start
ensureCoreSchema(db)
  .then(async (report) => {
    const added = report.addedColumns.length;
    console.log(`Schema health check complete (${report.checkedTables.length} tables, ${added} column${added === 1 ? "" : "s"} added)`);
    await require('./routes/orderSchema').ensureOrderCoreColumns(db);
    await deliveryChat.ensureChatSchema(db);
    console.log("Delivery messaging schema ready");
  })
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(() => {
    console.error('Database initialization failed. Check database settings and migration permissions.');
    process.exitCode = 1;
    db.end();
  });

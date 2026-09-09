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

const app = express();
const PORT = Number(process.env.PORT || 3000);

// middleware
app.use(cors());

// IMPORTANT: support JSON + form-data fallback
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// DB
const db = require("./db/connection");
const { ensureCoreSchema } = require("./db/schemaHealth");
const riderRoutes = require("./routes/riders");

app.use((req, res, next) => {
  req.db = db;
  next();
});

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
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// routes
app.use("/auth", require("./routes/auth"));
app.use("/products", require("./routes/products"));
app.use("/orders", require("./routes/orders"));
app.use("/reviews", require("./routes/reviews"));
app.use("/payments", require("./routes/payments"));
app.use("/installments", require("./routes/installments"));
app.use("/notifications", require("./routes/notifications"));
app.use("/customer/addresses", require("./routes/customerAddresses"));
app.use("/vouchers", require("./routes/vouchers"));
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
app.use("/admin/audit-logs", require("./routes/auditLogs"));
app.use("/admin/inventory-movements", require("./routes/inventoryMovements"));

app.get("/staff/dashboard.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public/admin/dashboard.html"));
});
// home
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/customer/shop.html");
});

// start
ensureCoreSchema(db)
  .then((report) => {
    const added = report.addedColumns.length;
    console.log(`Schema health check complete (${report.checkedTables.length} tables, ${added} column${added === 1 ? "" : "s"} added)`);
  })
  .catch((err) => {
    console.log("Schema health check warning:", err.message);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  });

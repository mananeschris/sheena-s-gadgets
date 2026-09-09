const mysql = require("mysql2");

const db = mysql.createConnection({
  host: process.env.DB_HOST || "127.0.0.1",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "fintech_db",
  port: Number(process.env.DB_PORT || 3307)
});

db.connect(err => {
  if (err) {
    console.log("DB error:", err.message);
  } else {
    console.log("Connected to MySQL");
  }
});

module.exports = db;
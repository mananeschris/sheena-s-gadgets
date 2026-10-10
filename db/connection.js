const mysql = require("mysql2");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "fintech_db",
  port: Number(process.env.DB_PORT || 3307),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 100,
  connectTimeout: 10000,
  ssl: process.env.DB_SSL === 'true' || (process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false')
    ? { rejectUnauthorized: true, ...(process.env.DB_SSL_CA_BASE64 ? { ca: Buffer.from(process.env.DB_SSL_CA_BASE64, 'base64').toString('utf8') } : {}) }
    : undefined
});

pool.query('SELECT 1', err => {
  if (err) {
    console.log("DB error:", err.message);
  } else {
    console.log("Connected to MySQL");
  }
});

module.exports = require('./requestDatabase').requestDatabase(pool);

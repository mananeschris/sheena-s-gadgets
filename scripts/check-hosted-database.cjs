const mysql = require('mysql2/promise');
const { X509Certificate } = require('node:crypto');

async function check() {
  const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_SSL_CA_BASE64'];
  if (required.some(key => !process.env[key])) throw new Error('Incomplete database configuration');
  const ca = Buffer.from(process.env.DB_SSL_CA_BASE64, 'base64').toString('utf8');
  new X509Certificate(ca);
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: { ca, rejectUnauthorized: true },
      connectTimeout: 15000
    });
    await connection.query('SELECT 1');
    const [tls] = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    if (!tls[0]?.Value) throw new Error('TLS is not active');
    const [tables] = await connection.query('SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema=DATABASE()');
    console.log(JSON.stringify({ connection: 'ok', certificateVerification: true, tls: 'active', existingTables: tables[0].total, readOnlyCheck: true }));
  } finally {
    if (connection) await connection.end();
  }
}

check().catch(error => {
  console.error('Connection check failed:', error.code || 'CONFIG_OR_TLS_ERROR');
  process.exitCode = 1;
});

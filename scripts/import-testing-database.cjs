const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { X509Certificate } = require('node:crypto');
const mysql = require('mysql2/promise');

const root = path.resolve(__dirname, '..');
function identifier(value) {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error('Invalid SQL identifier');
  return `\`${value}\``;
}
async function objects(db) {
  const [rows] = await db.query(`SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE()
    UNION ALL SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()
    UNION ALL SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()`);
  return rows;
}

async function main() {
  const local = parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8'));
  const remote = parseEnv(fs.readFileSync(path.join(root, '.env.render'), 'utf8'));
  const sourceName = 'fintech_user_testing_20261010';
  if (!['localhost', '127.0.0.1'].includes(local.DB_HOST)) throw new Error('Source must be local');
  if (!remote.DB_HOST || ['localhost', '127.0.0.1', '::1'].includes(remote.DB_HOST) || remote.DB_SSL !== 'true') throw new Error('Target must be hosted with TLS');
  const ca = Buffer.from(remote.DB_SSL_CA_BASE64 || '', 'base64').toString('utf8');
  new X509Certificate(ca);
  let source, target;
  try {
    source = await mysql.createConnection({ host: local.DB_HOST, port: Number(local.DB_PORT), user: local.DB_USER, password: local.DB_PASSWORD, database: sourceName, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
    target = await mysql.createConnection({ host: remote.DB_HOST, port: Number(remote.DB_PORT), user: remote.DB_USER, password: remote.DB_PASSWORD, database: remote.DB_NAME, ssl: { ca, rejectUnauthorized: true }, connectTimeout: 15000 });
    const [existing] = await target.query('SHOW FULL TABLES');
    if (existing.length || (await objects(target)).length) throw new Error('Target is not empty; nothing will be overwritten');
    if ((await objects(source)).length) throw new Error('Source has unsupported database objects');
    const [tables] = await source.query('SHOW FULL TABLES');
    if (!tables.length || tables.some(row => Object.values(row)[1] !== 'BASE TABLE')) throw new Error('Invalid source schema');
    const [foreignKeys] = await source.query('SELECT TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL');
    if (foreignKeys.length) throw new Error('Source requires a foreign-key-aware native import');
    const snapshots = [];
    await source.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await source.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    try {
      for (const table of tables) {
        const name = Object.values(table)[0];
        const [schema] = await source.query(`SHOW CREATE TABLE ${identifier(name)}`);
        const [columns] = await source.query(`SHOW FULL COLUMNS FROM ${identifier(name)}`);
        if (columns.some(column => /\b(?:VIRTUAL|STORED) GENERATED\b/.test(column.Extra))) throw new Error('Unsupported generated columns');
        const [rows] = await source.query(`SELECT * FROM ${identifier(name)}`);
        if (name !== 'users' && rows.length) throw new Error('Testing source contains non-account data');
        snapshots.push({ name, ddl: schema[0]['Create Table'], columns: columns.map(column => column.Field), rows });
      }
      await source.commit();
    } catch (error) { await source.rollback(); throw error; }
    const users = snapshots.find(table => table.name === 'users');
    if (users?.rows.length !== 1 || users.rows[0].role !== 'admin' || users.rows[0].email !== 'sheenasgadgetshop@gmail.com') throw new Error('Expected only the designated admin in testing source');
    console.log(JSON.stringify({ preflight: 'passed', source: sourceName, tables: snapshots.length, accounts: 1, nonAccountRows: 0, targetEmpty: true, tlsVerified: true }));
    if (!process.argv.includes('--apply')) return;
    // DDL is not transactional in MySQL. Never overwrite or automatically drop tables on failure.
    for (const table of snapshots) await target.query(table.ddl);
    await target.beginTransaction();
    try {
      for (const table of snapshots) {
        for (const row of table.rows) {
          await target.query(`INSERT INTO ${identifier(table.name)} (${table.columns.map(identifier).join(',')}) VALUES (${table.columns.map(() => '?').join(',')})`, table.columns.map(column => row[column]));
        }
      }
      await target.commit();
    } catch (error) { await target.rollback(); throw error; }
    for (const table of snapshots) {
      const [count] = await target.query(`SELECT COUNT(*) AS total FROM ${identifier(table.name)}`);
      if (Number(count[0].total) !== table.rows.length) throw new Error('Imported row count mismatch');
    }
    const [admin] = await target.query('SELECT id,email,password,role,email_verified FROM users');
    for (const field of ['id', 'email', 'password', 'role', 'email_verified']) {
      if (String(admin[0][field]) !== String(users.rows[0][field])) throw new Error('Imported admin verification failed');
    }
    console.log(JSON.stringify({ import: 'verified', tables: snapshots.length, accounts: 1, adminCredentialsPreserved: true, nonAccountRows: 0, originalLocalDatabaseUnchanged: true }));
  } finally {
    if (source) await source.end();
    if (target) await target.end();
  }
}

main().catch(error => {
  const safeMessages = ['Target is not empty; nothing will be overwritten', 'Testing source contains non-account data', 'Expected only the designated admin in testing source'];
  console.error('Import stopped:', safeMessages.includes(error.message) ? error.message : error.code || 'VALIDATION_OR_CONNECTION_ERROR');
  process.exitCode = 1;
});

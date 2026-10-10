const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2');
const mysqlPromise = require('mysql2/promise');

const root = path.resolve(__dirname, '..');
const env = { ...process.env };
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const text = line.trim();
  const separator = text.indexOf('=');
  if (!text || text.startsWith('#') || separator < 1) continue;
  const key = text.slice(0, separator).trim();
  if (env[key] === undefined) env[key] = text.slice(separator + 1).trim().replace(/^["']|["']$/g, '');
}

function identifier(value) {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error('Invalid database identifier.');
  return `\`${value}\``;
}

async function main() {
  const source = env.DB_NAME || 'fintech_db';
  const target = process.argv[2];
  if (!target || !/^fintech_user_testing_[0-9]{8}(?:_[0-9]+)?$/.test(target) || source === target) {
    throw new Error('Provide a new fintech_user_testing_YYYYMMDD database name.');
  }
  if (!['127.0.0.1', 'localhost'].includes(env.DB_HOST || '127.0.0.1')) throw new Error('This preparation requires a local MySQL server.');
  const db = await mysqlPromise.createConnection({
    host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3307),
    user: env.DB_USER || 'root', password: env.DB_PASSWORD || '', database: source,
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true
  });
  try {
    const [existing] = await db.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [target]);
    if (existing.length) throw new Error('The target database already exists; it will not be overwritten.');
    const [objects] = await db.query(`SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=?
      UNION ALL SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=?
      UNION ALL SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA=?`, [source, source, source]);
    const [constraints] = await db.query('SELECT TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL', [source]);
    const [tables] = await db.query('SHOW FULL TABLES');
    if (objects.length || constraints.length || tables.some(row => Object.values(row)[1] !== 'BASE TABLE')) {
      throw new Error('Database objects require a complete native dump before preparing this database.');
    }
    const backupDir = path.join(root, '.codex', 'backups', `user-testing-${crypto.randomBytes(8).toString('hex')}`);
    fs.mkdirSync(backupDir, { recursive: true });
    const snapshots = [];
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    try {
      for (const row of tables) {
        const name = Object.values(row)[0];
        const [schema] = await db.query(`SHOW CREATE TABLE ${identifier(name)}`);
        const [columns] = await db.query(`SHOW FULL COLUMNS FROM ${identifier(name)}`);
        if (columns.some(column => /\b(?:VIRTUAL|STORED) GENERATED\b/.test(column.Extra))) throw new Error('Generated columns require a native dump.');
        const [rows] = await db.query(`SELECT * FROM ${identifier(name)}`);
        snapshots.push({ name, ddl: schema[0]['Create Table'], columns: columns.map(column => column.Field), rows });
      }
      await db.commit();
    } catch (error) {
      await db.rollback();
      throw error;
    }
    const users = snapshots.find(table => table.name === 'users');
    const admins = users?.rows.filter(user => String(user.role).toLowerCase() === 'admin') || [];
    if (admins.length !== 1 || admins[0].email !== 'sheenasgadgetshop@gmail.com') {
      throw new Error('Expected exactly the designated shop admin before preparing the database.');
    }
    const sql = ['-- Complete source snapshot. Import into a new empty database.', 'SET NAMES utf8mb4;'];
    for (const table of snapshots) {
      sql.push(`${table.ddl};`);
      for (const row of table.rows) {
        const values = table.columns.map(column => mysql.escape(row[column]));
        sql.push(`INSERT INTO ${identifier(table.name)} (${table.columns.map(identifier).join(',')}) VALUES (${values.join(',')});`);
      }
    }
    const backup = sql.join('\n') + '\n';
    const backupFile = path.join(backupDir, 'database.sql');
    fs.writeFileSync(backupFile, backup, { flag: 'wx', mode: 0o600 });
    const digest = crypto.createHash('sha256').update(backup).digest('hex');
    if (crypto.createHash('sha256').update(fs.readFileSync(backupFile)).digest('hex') !== digest) throw new Error('Backup verification failed.');
    const manifest = {
      source, target, created_at: new Date().toISOString(), backup_sha256: digest,
      preserved_admin: { id: admins[0].id, email: admins[0].email },
      source_counts: Object.fromEntries(snapshots.map(table => [table.name, table.rows.length]))
    };
    fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ backupFile, source, target, backupVerified: true }));

    await db.query(`CREATE DATABASE ${identifier(target)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await db.query(`USE ${identifier(target)}`);
    for (const table of snapshots) {
      await db.query(table.ddl);
      await db.query(`ALTER TABLE ${identifier(table.name)} AUTO_INCREMENT=1`);
    }
    const preserved = new Map([['users', admins], ['deleted_product_categories', snapshots.find(table => table.name === 'deleted_product_categories')?.rows || []]]);
    await db.beginTransaction();
    try {
      for (const [name, rows] of preserved) {
        const table = snapshots.find(table => table.name === name);
        if (!table) continue;
        for (const row of rows) {
          await db.query(`INSERT INTO ${identifier(name)} (${table.columns.map(identifier).join(',')}) VALUES (${table.columns.map(() => '?').join(',')})`, table.columns.map(column => row[column]));
        }
      }
      await db.commit();
    } catch (error) {
      await db.rollback();
      throw error;
    }
    const targetCounts = {};
    for (const table of snapshots) {
      const [rows] = await db.query(`SELECT COUNT(*) AS count FROM ${identifier(table.name)}`);
      targetCounts[table.name] = rows[0].count;
      const expected = preserved.get(table.name)?.length || 0;
      if (Number(rows[0].count) !== expected) throw new Error('Fresh database verification failed.');
    }
    const [admin] = await db.query('SELECT password,email_verified,role FROM users WHERE id=?', [admins[0].id]);
    if (admin[0].password !== admins[0].password || admin[0].email_verified !== admins[0].email_verified) throw new Error('Admin credentials did not match the source.');
    manifest.target_counts = targetCounts;
    fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ ready: true, database: target, retainedAdmin: admins[0].email, tableCount: snapshots.length, counts: targetCounts }));
  } finally {
    await db.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

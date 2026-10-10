const multer = require('multer');
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2');
const cloudStorage = require('../services/cloudStorage');

const directory = process.env.DELIVERY_PROOF_DIR || (process.env.STORAGE_DIR ? require('../services/uploadStorage').deliveryProofs : path.join(__dirname, '..', 'data', 'delivery-proofs'));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 },
  fileFilter(req, file, callback) {
    callback(['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) ? null : new Error('Delivery proof must be JPG, PNG, or WEBP.'), true);
  }
}).single('delivery_proof');

function parseDeliveryProof(req, res, next) {
  upload(req, res, error => {
    if (error) return res.status(400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'Delivery photo must be 5 MB or smaller.' : error.message });
    req.body.status = 'delivered';
    next();
  });
}

async function prepareDeliveryProof(file) {
  if (!file) throw new Error('A delivery proof photo is required before marking Delivered.');
  try {
    const image = sharp(file.buffer, { limitInputPixels: 40000000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || metadata.pages > 1) throw new Error('Unsupported photo');
    // Normalize orientation and strip metadata, including location tags.
    return await image.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  } catch {
    throw new Error('Upload a valid JPG, PNG, or WEBP delivery photo (up to 40 megapixels).');
  }
}

function proofPath(filename) {
  if (!/^[a-f0-9-]{36}\.jpg$/.test(String(filename || ''))) throw new Error('Invalid delivery proof filename.');
  return path.join(directory, filename);
}

async function saveDeliveryProof(buffer) {
  const filename = `${crypto.randomUUID()}.jpg`;
  if (cloudStorage.enabled()) {
    await cloudStorage.cloud().put('delivery-proofs', filename, buffer, 'image/jpeg');
    return filename;
  }
  await fs.mkdir(directory, { recursive: true });
  try { await fs.writeFile(proofPath(filename), buffer, { flag: 'wx' }); }
  catch (error) { await removeDeliveryProof(filename); throw error; }
  return filename;
}

async function removeDeliveryProof(filename) {
  if (filename && cloudStorage.enabled()) {
    proofPath(filename);
    return cloudStorage.cloud().remove('delivery-proofs', filename);
  }
  if (filename) await fs.unlink(proofPath(filename)).catch(error => { if (error.code !== 'ENOENT') console.error('Unable to remove failed delivery proof:', error.code); });
}

async function serveDeliveryProof(req, res, filename) {
  const file = proofPath(filename);
  if (cloudStorage.enabled()) return cloudStorage.cloud().serve(req, res, 'delivery-proofs', filename);
  res.sendFile(file, error => {
    if (error && !res.headersSent) res.status(404).json({ message: 'Delivery proof photo is unavailable.' });
  });
}

async function openDeliveryConnection(db) {
  const database = await new Promise((resolve, reject) => db.query('SELECT DATABASE() AS name', (err, rows) => err ? reject(err) : resolve(rows[0].name)));
  const config = db.config;
  const connection = mysql.createConnection({ host: config.host, port: config.port, user: config.user, password: config.password, database, ssl: config.ssl, timezone: config.timezone });
  await new Promise((resolve, reject) => connection.connect(err => { if (err) { connection.destroy(); reject(err); } else resolve(); }));
  return connection;
}

module.exports = { parseDeliveryProof, prepareDeliveryProof, saveDeliveryProof, removeDeliveryProof, proofPath, serveDeliveryProof, openDeliveryConnection };

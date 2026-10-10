const fs = require('fs');
const path = require('path');
const cloudStorage = require('./cloudStorage');

const root = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, '..'));
const publicUploads = path.join(root, 'uploads');
const paymentProofs = path.join(root, 'private', 'payment-proofs');
const orderDocuments = path.join(root, 'private', 'order-documents');
const deliveryProofs = process.env.DELIVERY_PROOF_DIR || path.join(root, 'private', 'delivery-proofs');

function ensureUploadDirectories() {
  for (const directory of [publicUploads, paymentProofs, orderDocuments, deliveryProofs]) fs.mkdirSync(directory, { recursive: true });
}

function discardFailedUploads(req, res, next) {
  res.on('finish', () => {
    const files = req.file ? [req.file] : Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat();
    for (const file of files) {
      if (file.path && (res.statusCode >= 400 || file.cloudKind)) fs.unlink(file.path, () => {});
      if (res.statusCode >= 400 && file.cloudKind) cloudStorage.cloud().remove(file.cloudKind, file.filename).catch(() => console.error('Failed upload cleanup requires attention.'));
    }
  });
  next();
}

async function validateUploadedMedia(req, res, next) {
  const files = req.file ? [req.file] : Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat();
  try {
    for (const file of files) {
      if (file.mimetype?.startsWith('image/')) {
        if (file.size > 5 * 1024 * 1024) throw new Error('Image exceeds 5 MB.');
        const metadata = await require('sharp')(file.path, { limitInputPixels: 40000000, failOn: 'warning' }).metadata();
        if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('Unsupported image.');
      } else {
        const handle = await fs.promises.open(file.path, 'r');
        const header = Buffer.alloc(12);
        try { await handle.read(header, 0, header.length, 0); } finally { await handle.close(); }
        const valid = file.mimetype === 'video/mp4' ? header.toString('ascii', 4, 8) === 'ftyp' : file.mimetype === 'video/webm' && header.readUInt32BE(0) === 0x1a45dfa3;
        if (!valid) throw new Error('Unsupported video.');
      }
    }
    try {
      if (cloudStorage.enabled()) {
        for (const file of files) {
          const parent = path.dirname(file.path);
          const kind = parent === paymentProofs ? 'payment-proofs' : parent === orderDocuments ? 'order-documents' : parent === publicUploads ? 'public' : null;
          if (!kind) throw new Error('Unknown upload directory.');
          await cloudStorage.cloud().put(kind, file.filename, await fs.promises.readFile(file.path), file.mimetype);
          file.cloudKind = kind;
        }
      }
    } catch { return res.status(503).json({ message: 'File storage is unavailable. Please try again.' }); }
    next();
  } catch { res.status(400).json({ message: 'Upload valid JPG, PNG, or WEBP images (up to 5 MB), or an MP4/WEBM review video.' }); }
}

module.exports = { root, publicUploads, paymentProofs, orderDocuments, deliveryProofs, ensureUploadDirectories, discardFailedUploads, validateUploadedMedia };

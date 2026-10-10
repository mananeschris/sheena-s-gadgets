const express = require('express');
const path = require('path');
const fs = require('fs');
const { storeSession } = require('./adminSessions');
const { query } = require('./chatSession');
const storage = require('../services/uploadStorage');
const cloudStorage = require('../services/cloudStorage');
const router = express.Router();
const legacyUploads = path.join(__dirname, '..', 'uploads');

async function servePrivate(req, res, kind, filename) {
  try {
    const user = await storeSession(req);
    if (!user) return res.status(401).json({ message: 'Sign in to view this file.' });
    const url = `/uploads/${kind ? `${kind}/` : ''}${filename}`;
    const rows = kind === 'payments'
      ? await query(req.db, 'SELECT user_id FROM orders WHERE payment_proof_image=? LIMIT 1', [url])
      : await query(req.db, 'SELECT user_id FROM installment_applications WHERE national_id_image=? OR selfie_with_id_image=? LIMIT 1', [url, url]);
    if (!rows.length) return res.status(404).json({ message: 'File not found.' });
    if (!['admin', 'staff'].includes(user.role) && !(user.role === 'customer' && Number(user.id) === Number(rows[0].user_id))) {
      return res.status(403).json({ message: 'You do not have access to this file.' });
    }
    const directory = kind === 'payments' ? storage.paymentProofs : storage.orderDocuments;
    res.set('Cache-Control', 'private, no-store');
    if (cloudStorage.enabled()) return await cloudStorage.cloud().serve(req, res, kind === 'payments' ? 'payment-proofs' : 'order-documents', filename);
    const candidates = [path.join(directory, filename), path.join(legacyUploads, kind, filename)];
    const file = candidates.find(candidate => fs.existsSync(candidate));
    if (!file) return res.status(404).json({ message: 'File not found.' });
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(file);
  } catch { res.status(503).json({ message: 'Unable to load this file.' }); }
}

router.use(async (req, res, next) => {
  const parts = req.path.split('/').filter(Boolean);
  const filename = parts.at(-1) || '';
  if (!/^[a-zA-Z0-9_.-]+$/.test(filename) || filename.includes('..')) return res.status(404).end();
  if (parts.length === 2 && ['payments', 'order-documents'].includes(parts[0])) return servePrivate(req, res, parts[0], filename);
  if (parts.length !== 1 || !/\.(jpe?g|png|webp|gif|mp4|webm|jfif)$/i.test(filename)) return res.status(404).end();
  // Existing installment photos used flat public URLs before private storage was introduced.
  try {
    const url = `/uploads/${filename}`;
    const rows = await query(req.db, 'SELECT id FROM installment_applications WHERE national_id_image=? OR selfie_with_id_image=? LIMIT 1', [url, url]);
    if (rows.length) return servePrivate(req, res, '', filename);
    next();
  } catch { res.status(503).json({ message: 'Unable to load this file.' }); }
});
router.use(async (req, res, next) => {
  if (!cloudStorage.enabled()) return next();
  try { await cloudStorage.cloud().serve(req, res, 'public', req.path.slice(1)); }
  catch { if (!res.headersSent) res.status(503).json({ message: 'Unable to load this file.' }); }
});
router.use(express.static(storage.publicUploads, { dotfiles: 'deny', fallthrough: false }));
module.exports = router;

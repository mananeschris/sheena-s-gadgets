const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const sharp = require('sharp');
const { validateUploadedMedia, discardFailedUploads } = require('../services/uploadStorage');

test('uploads validate actual media and discard failed files without deleting successful uploads', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shop-media-test-'));
  t.after(async () => { assert.equal(path.dirname(directory), os.tmpdir()); assert.match(path.basename(directory), /^shop-media-test-/); await fs.rm(directory, { recursive: true, force: true }); });
  const photo = path.join(directory, 'photo.jpg');
  const payload = path.join(directory, 'payload.jpg');
  await fs.writeFile(photo, await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).jpeg().toBuffer());
  await fs.writeFile(payload, '<html>not an image</html>');
  const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json() {} });
  let accepted = false; const good = response();
  await validateUploadedMedia({ file: { path: photo, mimetype: 'image/jpeg', size: 100 } }, good, () => { accepted = true; });
  assert.equal(accepted, true);
  const bad = response();
  await validateUploadedMedia({ file: { path: payload, mimetype: 'image/jpeg', size: 100 } }, bad, () => assert.fail('Disguised HTML was accepted'));
  assert.equal(bad.statusCode, 400);
  const large = response();
  await validateUploadedMedia({ file: { path: photo, mimetype: 'image/jpeg', size: 6 * 1024 * 1024 } }, large, () => assert.fail('Oversized photo was accepted'));
  assert.equal(large.statusCode, 400);
  const failed = new EventEmitter(); failed.statusCode = 400;
  discardFailedUploads({ file: { path: payload } }, failed, () => {}); failed.emit('finish');
  for (let count = 0; count < 20; count++) { try { await fs.access(payload); await new Promise(resolve => setTimeout(resolve, 10)); } catch { break; } }
  await assert.rejects(fs.access(payload));
  const success = new EventEmitter(); success.statusCode = 200;
  discardFailedUploads({ file: { path: photo } }, success, () => {}); success.emit('finish');
  await fs.access(photo);
});

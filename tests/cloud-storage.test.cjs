const test = require('node:test');
const assert = require('node:assert/strict');
const { createStorage, validateCloudConfig } = require('../services/cloudStorage');
const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-secret', SUPABASE_STORAGE_BUCKET: 'shop-files' };

test('cloud configuration rejects unsafe origins and missing secrets', () => {
  assert.doesNotThrow(() => validateCloudConfig(env));
  for (const url of ['http://example.supabase.co', 'https://localhost', 'https://example.supabase.co.evil.com', 'https://user:pass@example.supabase.co', 'https://example.supabase.co/path']) {
    assert.throws(() => validateCloudConfig({ ...env, SUPABASE_URL: url }));
  }
  assert.throws(() => validateCloudConfig({ ...env, SUPABASE_SERVICE_ROLE_KEY: '' }), /Missing/);
});

test('cloud file proxy streams byte ranges without exposing signed URLs', async () => {
  const express = require('express');
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  process.env.SUPABASE_URL = env.SUPABASE_URL;
  let requested;
  const client = { storage: { getBucket: async () => ({ data: { public: false } }), from: () => ({
    createSignedUrl: async () => ({ data: { signedUrl: `${env.SUPABASE_URL}/storage/file?token=private-token` } })
  }) } };
  const storage = createStorage(client, 'shop-files');
  global.fetch = async (url, options) => {
    requested = { url: String(url), options };
    return new Response('photo', { status: 206, headers: { 'Content-Type': 'image/jpeg', 'Content-Range': 'bytes 0-4/5' } });
  };
  const app = express();
  app.get('/proof', (req, res) => { res.set('Cache-Control', 'private, no-store'); storage.serve(req, res, 'payment-proofs', 'proof.jpg').catch(() => res.status(503).end()); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/proof`, { headers: { Range: 'bytes=0-4' } });
    assert.equal(response.status, 206);
    assert.equal(await response.text(), 'photo');
    assert.equal(response.headers.get('location'), null);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(requested.options.headers.Range, 'bytes=0-4');
    assert.equal(requested.options.redirect, 'error');
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    await new Promise(resolve => server.close(resolve));
  }
});

test('public buckets are refused before any file operation', async () => {
  let uploaded = false;
  const client = { storage: { getBucket: async () => ({ data: { public: true } }), from: () => ({ upload: async () => { uploaded = true; return {}; } }) } };
  await assert.rejects(createStorage(client, 'shop-files').put('payment-proofs', 'proof.jpg', Buffer.from('test'), 'image/jpeg'), /private/);
  assert.equal(uploaded, false);
});

test('storage preserves private prefixes, disables overwrite and rejects traversal', async () => {
  const calls = [];
  const client = { storage: { getBucket: async () => ({ data: { public: false } }), from: bucket => ({
    upload: async (...args) => { calls.push({ bucket, args }); return {}; },
    remove: async keys => { calls.push(keys); return {}; }
  }) } };
  const storage = createStorage(client, 'shop-files');
  await storage.put('payment-proofs', 'proof.jpg', Buffer.from('test'), 'image/jpeg');
  assert.equal(calls[0].args[0], 'payment-proofs/proof.jpg');
  assert.equal(calls[0].args[2].upsert, false);
  await storage.remove('delivery-proofs', 'photo.jpg');
  assert.deepEqual(calls[1], ['delivery-proofs/photo.jpg']);
  await assert.rejects(storage.put('public', '../secret.jpg', Buffer.alloc(0), 'image/jpeg'));
  await assert.rejects(storage.put('unknown', 'secret.jpg', Buffer.alloc(0), 'image/jpeg'));
});

const { createClient } = require('@supabase/supabase-js');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

function validateCloudConfig(env = process.env) {
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET']) {
    if (!env[key]) throw new Error(`Missing storage setting: ${key}`);
  }
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the Supabase project HTTPS URL.');
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(env.SUPABASE_STORAGE_BUCKET)) throw new Error('Invalid storage bucket name.');
}

function createStorage(client, bucket) {
  let checked;
  async function ready() {
    if (!checked) checked = (async () => {
      const { data, error } = await client.storage.getBucket(bucket);
      if (error || !data || data.public) throw new Error('Configure an existing private storage bucket.');
    })().catch(error => { checked = null; throw error; });
    await checked;
  }
  function key(kind, filename) {
    if (!['public', 'payment-proofs', 'order-documents', 'delivery-proofs'].includes(kind) || !/^[a-zA-Z0-9_.-]+$/.test(filename) || filename.includes('..')) throw new Error('Invalid storage file.');
    return `${kind}/${filename}`;
  }
  return {
    async put(kind, filename, buffer, contentType) {
      await ready();
      const { error } = await client.storage.from(bucket).upload(key(kind, filename), buffer, { contentType, upsert: false });
      if (error) throw new Error('Unable to store uploaded file.');
    },
    async remove(kind, filename) {
      await ready();
      const { error } = await client.storage.from(bucket).remove([key(kind, filename)]);
      if (error) throw new Error('Unable to remove uploaded file.');
    },
    async serve(req, res, kind, filename) {
      await ready();
      const { data, error } = await client.storage.from(bucket).createSignedUrl(key(kind, filename), 60);
      if (error || !data?.signedUrl) return res.status(404).end();
      const url = new URL(data.signedUrl);
      if (url.origin !== new URL(process.env.SUPABASE_URL).origin) throw new Error('Invalid storage response.');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      const close = () => { if (!res.writableEnded) controller.abort(); };
      res.on('close', close);
      try {
        const response = await fetch(url, { redirect: 'error', signal: controller.signal, headers: req.headers.range ? { Range: req.headers.range } : {} });
        if (![200, 206, 416].includes(response.status)) return res.status(response.status === 404 ? 404 : 503).end();
        res.status(response.status);
        for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
          if (response.headers.has(header)) res.set(header, response.headers.get(header));
        }
        res.set('X-Content-Type-Options', 'nosniff');
        if (req.method === 'HEAD') { await response.body?.cancel(); return res.end(); }
        if (response.body) await pipeline(Readable.fromWeb(response.body), res);
        else res.end();
      } finally { clearTimeout(timeout); res.off('close', close); }
    }
  };
}

let storage;
function cloud() {
  if (!storage) {
    validateCloudConfig();
    storage = createStorage(createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }), process.env.SUPABASE_STORAGE_BUCKET);
  }
  return storage;
}
module.exports = { cloud, createStorage, validateCloudConfig, enabled: () => process.env.STORAGE_PROVIDER === 'supabase' };

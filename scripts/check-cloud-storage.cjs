const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const { cloud, validateCloudConfig } = require('../services/cloudStorage');

async function check() {
  validateCloudConfig();
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;
  const { data, error } = await client.storage.getBucket(bucket);
  if (error || !data) throw new Error('BUCKET_ACCESS_FAILED');
  if (data.public) throw new Error('BUCKET_MUST_BE_PRIVATE');
  const filename = `connection-test-${crypto.randomUUID()}.jpg`;
  const key = `payment-proofs/${filename}`;
  const photo = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  let uploaded = false;
  try {
    await cloud().put('payment-proofs', filename, photo, 'image/jpeg');
    uploaded = true;
    const result = await client.storage.from(bucket).download(key);
    if (result.error || !result.data) throw new Error('DOWNLOAD_FAILED');
    assert.ok(Buffer.from(await result.data.arrayBuffer()).equals(photo), 'DOWNLOAD_MISMATCH');
    const anonymous = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${key}`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    await anonymous.body?.cancel();
    if (anonymous.ok) throw new Error('ANONYMOUS_ACCESS_NOT_BLOCKED');
    const signed = await client.storage.from(bucket).createSignedUrl(key, 60);
    if (signed.error || !signed.data?.signedUrl) throw new Error('SIGNED_DOWNLOAD_FAILED');
    console.log('Private bucket verified; upload/download verified; anonymous public access blocked.');
  } finally {
    if (uploaded) {
      await cloud().remove('payment-proofs', filename);
      const removed = await client.storage.from(bucket).list('payment-proofs', { search: filename });
      if (removed.error || removed.data.some(file => file.name === filename)) throw new Error('TEST_FILE_CLEANUP_FAILED');
      console.log('Temporary test file removed and cleanup verified.');
    }
  }
}

check().catch(error => {
  const allowed = ['BUCKET_ACCESS_FAILED', 'BUCKET_MUST_BE_PRIVATE', 'DOWNLOAD_FAILED', 'DOWNLOAD_MISMATCH', 'ANONYMOUS_ACCESS_NOT_BLOCKED', 'SIGNED_DOWNLOAD_FAILED', 'TEST_FILE_CLEANUP_FAILED'];
  console.error('Storage check failed:', allowed.includes(error.message) ? error.message : 'CONFIG_OR_STORAGE_ERROR');
  process.exitCode = 1;
});

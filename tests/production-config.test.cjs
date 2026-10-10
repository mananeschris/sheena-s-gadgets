const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProductionConfig } = require('../services/productionConfig');
const valid = { NODE_ENV: 'production', RENDER: 'true', DB_HOST: 'db.example.com', DB_PORT: '3306', DB_USER: 'shop', DB_PASSWORD: 'example', DB_NAME: 'shop', APP_BASE_URL: 'https://shop.example.com', STORAGE_DIR: '/var/data', EMAIL_FROM_ADDRESS: 'sender@example.com', EMAIL_VERIFICATION_SECRET: 'a'.repeat(64), EMAIL_PROVIDER: 'brevo', BREVO_API_KEY: 'example', AI_ASSISTANT_ENABLED: 'false' };
test('production requires hosted database, HTTPS, persistent storage and mail without printing credentials', () => {
  assert.doesNotThrow(() => validateProductionConfig(valid));
  for (const key of ['DB_HOST', 'DB_PASSWORD', 'STORAGE_DIR', 'EMAIL_FROM_ADDRESS']) assert.throws(() => validateProductionConfig({ ...valid, [key]: '' }), /Missing/);
  assert.throws(() => validateProductionConfig({ ...valid, DB_HOST: '127.0.0.1' }), /hosted/);
  assert.throws(() => validateProductionConfig({ ...valid, APP_BASE_URL: 'http://example.com' }), /HTTPS/);
  assert.throws(() => validateProductionConfig({ ...valid, APP_BASE_URL: 'https://localhost' }), /HTTPS/);
  assert.throws(() => validateProductionConfig({ ...valid, EMAIL_VERIFICATION_SECRET: 'short' }), /unique/);
  assert.throws(() => validateProductionConfig({ ...valid, BREVO_API_KEY: '' }), /email/);
  assert.throws(() => validateProductionConfig({ ...valid, AI_ASSISTANT_ENABLED: 'true' }), /GEMINI/);
  assert.doesNotThrow(() => validateProductionConfig({ NODE_ENV: 'development' }));
});
test('Supabase production does not require a paid disk but requires cloud settings', () => {
  const cloud = { ...valid, STORAGE_DIR: '', STORAGE_PROVIDER: 'supabase', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-secret', SUPABASE_STORAGE_BUCKET: 'shop-files' };
  assert.doesNotThrow(() => validateProductionConfig(cloud));
  assert.throws(() => validateProductionConfig({ ...cloud, SUPABASE_SERVICE_ROLE_KEY: '' }), /Missing/);
  assert.throws(() => validateProductionConfig({ ...cloud, STORAGE_PROVIDER: 'unknown' }), /Unsupported/);
});

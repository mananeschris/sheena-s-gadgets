function validateProductionConfig(env = process.env) {
  if (env.NODE_ENV !== 'production') return;
  const storageProvider = env.STORAGE_PROVIDER || 'disk';
  if (!['disk', 'supabase'].includes(storageProvider)) throw new Error('Unsupported storage provider.');
  const required = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'APP_BASE_URL', 'EMAIL_FROM_ADDRESS', 'EMAIL_VERIFICATION_SECRET'];
  if (storageProvider === 'disk') required.push('STORAGE_DIR');
  const missing = required.filter(key => !env[key]);
  if (missing.length) throw new Error(`Missing production settings: ${missing.join(', ')}`);
  if (storageProvider === 'supabase') require('./cloudStorage').validateCloudConfig(env);
  const url = new URL(env.APP_BASE_URL);
  if (url.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('APP_BASE_URL must be your public HTTPS origin.');
  if (env.RENDER === 'true' && ['localhost', '127.0.0.1', '::1'].includes(env.DB_HOST)) throw new Error('Render requires a hosted MySQL database, not the local PC database.');
  if (env.EMAIL_VERIFICATION_SECRET.length < 32 || /change_this|your_/i.test(env.EMAIL_VERIFICATION_SECRET)) throw new Error('Set a unique EMAIL_VERIFICATION_SECRET of at least 32 characters.');
  const provider = env.EMAIL_PROVIDER || 'brevo';
  if (!['brevo', 'resend'].includes(provider) || !env[provider === 'brevo' ? 'BREVO_API_KEY' : 'RESEND_API_KEY']) throw new Error('Configure transactional email before deploying.');
  if (env.AI_ASSISTANT_ENABLED !== 'false' && (env.AI_PROVIDER || 'gemini') === 'gemini' && !env.GEMINI_API_KEY) throw new Error('Set GEMINI_API_KEY or disable the AI assistant.');
}
module.exports = { validateProductionConfig };

const express = require('express');
const { requireRole } = require('./roleGuard');
const { query } = require('./chatSession');
const assistant = require('../services/shopAssistant');
const router = express.Router();
const usage = new Map();
let active = 0;
let statusCache = null;
let statusCheck = null;

router.use(requireRole(['customer']));
router.get('/status', async (req, res) => {
  try {
    const config = assistant.settings();
    if (!config.enabled) return res.json({ available: false });
    if (config.provider === 'gemini' && !config.apiKey) return res.json({ available: false, provider: 'gemini' });
    const key = config.provider + config.url + config.model;
    if (statusCache?.key === key && statusCache.until > Date.now()) return res.json({ available: statusCache.available, provider: config.provider });
    if (!statusCheck) statusCheck = (async () => {
      try {
        const response = await fetch(config.provider === 'gemini' ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}` : assistant.localEndpoint(config.url, '/api/tags'), {
          redirect: 'error', signal: AbortSignal.timeout(5000), ...(config.provider === 'gemini' ? { headers: { 'x-goog-api-key': config.apiKey } } : {})
        });
        const data = response.ok ? await response.json() : {};
        const available = config.provider === 'gemini' ? Boolean(response.ok && data.supportedGenerationMethods?.includes('generateContent')) : Array.isArray(data.models) && data.models.some(model => [model.name, model.model].includes(config.model) && !model.remote_host);
        statusCache = { key, available, until: Date.now() + 5000 };
        return available;
      } finally { statusCheck = null; }
    })();
    res.json({ available: await statusCheck, provider: config.provider });
  } catch { res.json({ available: false }); }
});

router.post('/messages', async (req, res) => {
  if (!req.is('application/json')) return res.status(415).json({ message: 'Send the question as JSON.' });
  if (!assistant.validateMessages(req.body?.messages)) return res.status(400).json({ message: 'Send a message of up to 1,500 characters.' });
  let config;
  try { config = assistant.settings(); }
  catch { return res.status(503).json({ message: 'The AI assistant is unavailable. Please contact the shop.' }); }
  if (!config.enabled) return res.status(503).json({ message: 'AI assistance is unavailable. Please contact the shop.' });
  if (config.provider === 'gemini' && !config.apiKey) return res.status(503).json({ message: 'AI assistance is unavailable. Please contact the shop.' });
  if (config.provider === 'gemini' && assistant.hasSensitiveData(req.body.messages)) return res.status(400).json({ message: 'Remove personal contact details, payment numbers, passwords, or verification codes before sending your question.' });
  const now = Date.now();
  for (const [id, value] of usage) if (value.until <= now && !value.busy) usage.delete(id);
  const id = req.actorUser.id;
  const bucket = usage.get(id) || { count: 0, until: now + 60000, busy: false };
  if (bucket.busy || bucket.count >= 8 || active >= 2) {
    res.set('Retry-After', '10');
    return res.status(429).json({ message: 'The assistant is busy. Please wait a moment and try again.' });
  }
  bucket.count++;
  bucket.busy = true;
  usage.set(id, bucket);
  active++;
  try {
    const products = await query(req.db, `SELECT id, name, description, category, price, stock, variants,
      warranty_eligible, warranty_duration_months, warranty_coverage, warranty_exclusions
      FROM products ORDER BY id DESC LIMIT 30`);
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    const reply = await assistant.reply(req.body.messages, products, { config, signal: controller.signal });
    res.json({ reply });
  } catch (error) {
    const status = error.status === 429 ? 429 : 503;
    if (status === 429) res.set('Retry-After', '30');
    res.status(status).json({ message: status === 429 ? 'The AI request limit has been reached. Try again later or contact the shop.' : 'The AI assistant is unavailable right now. You can still contact the shop.' });
  } finally {
    active--;
    bucket.busy = false;
  }
});

module.exports = router;

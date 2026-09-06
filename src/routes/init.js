/**
 * GET /api/init — system state + school info, cached for 5 minutes.
 */
const express = require('express');
const router = express.Router();
const pool = require('../db');
const cache = require('../cache');
const { buildInitPayload } = require('../utils/school');

router.get('/', async (req, res) => {
  try {
    const cacheKey = 'init';
    if (req.query.no_cache === '1') cache.del(cacheKey);
    const cached = cache.get(cacheKey);
    if (cached) return res.json(cached);

    let payload;
    // Only login required for reading the teacher password. Basic init
    // (setup_complete + school) can be served publicly so the /login and
    // /setup screens can theme themselves.
    const needSecret = !!(req.session && req.session.user);
    payload = await buildInitPayload({ withSecret: needSecret });

    // Don't cache if school not yet set up (dynamic), but cache once complete.
    if (payload.setup_complete) cache.set(cacheKey, payload);
    return res.json(payload);
  } catch (err) {
    console.error('init error:', err);
    return res.status(500).json({ error: 'Failed to load system state', detail: err.message });
  }
});

module.exports = router;

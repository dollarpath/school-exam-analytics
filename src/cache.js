/**
 * Small in-memory cache (node-cache). Used primarily to cache the
 * /api/init response so the school header/theme is cheap to serve.
 */
const NodeCache = require('node-cache');

const ttl = parseInt(process.env.INIT_CACHE_TTL || '300', 10);
const cache = new NodeCache({ stdTTL: ttl, checkperiod: ttl * 0.5 });

module.exports = cache;

/**
 * Vercel serverless function — GET /api/stats
 *
 * Returns the rank-distribution payload written to Redis by the bot
 * on startup (src/utils/generate-stats.js).
 *
 * The web page chart fetches this endpoint to avoid needing direct DB access.
 */

const { Redis } = require('@upstash/redis');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type':                 'application/json',
};

const EMPTY = {
  updatedAt:    null,
  totalLinked:  0,
  ranked:       0,
  unranked:     0,
  distribution: [],
};

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    return res.writeHead(204, CORS).end();
  }

  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  try {
    const redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    const data = await redis.get('stats:rank-distribution');

    res.status(200).json(data ?? EMPTY);
  } catch (err) {
    console.error('[api/stats]', err);
    res.status(200).json(EMPTY); // Graceful fallback — chart shows empty state
  }
};

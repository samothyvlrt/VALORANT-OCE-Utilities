/**
 * Vercel serverless function — GET /api/leaderboard
 *
 * Returns the sorted leaderboard payload written to Redis by the bot
 * on startup (src/utils/generate-leaderboard.js).
 *
 * Only public (hidden=0) accounts are included — /privacy is respected.
 */

const { Redis } = require('@upstash/redis');

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type':                 'application/json',
};

const EMPTY = { updatedAt: null, total: 0, players: [] };

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

    const data = await redis.get('stats:leaderboard');
    res.status(200).json(data ?? EMPTY);
  } catch (err) {
    console.error('[api/leaderboard]', err);
    res.status(200).json(EMPTY);
  }
};

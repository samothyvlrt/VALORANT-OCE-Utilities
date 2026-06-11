/**
 * Upstash Redis client — bridge between the bot and the Vercel OAuth callback.
 *
 * Two key spaces:
 *   oauth:{state}       — pending OAuth challenge data (written by bot, read+deleted by Vercel)
 *   verified:{discordId} — completed OAuth result (written by Vercel, read+deleted by bot)
 */

const { Redis } = require('@upstash/redis');

let _redis = null;

function getRedis() {
  if (!_redis) {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      throw new Error(
        'Upstash Redis is not configured. ' +
        'Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to your .env file.',
      );
    }
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return _redis;
}

const OAUTH_TTL  = 30 * 60; // 30 min — matches VERIFICATION_TIMEOUT_MINUTES
const RESULT_TTL =  5 * 60; // 5 min for bot to pick up the result

// ── Written by bot when /link is run ─────────────────────────────────────────

/**
 * Store OAuth state so the Vercel callback can look it up.
 * @param {string} state  Random hex token included in the OAuth URL
 * @param {{ discordId, puuid, riotName, riotTag, region }} data
 */
async function setOAuthState(state, data) {
  await getRedis().set(`oauth:${state}`, data, { ex: OAUTH_TTL });
}

// ── Read by Vercel callback ───────────────────────────────────────────────────

/**
 * Retrieve OAuth state by token. Returns null if expired or not found.
 * @param {string} state
 */
async function getOAuthState(state) {
  return getRedis().get(`oauth:${state}`);
}

/**
 * Delete OAuth state after it has been consumed.
 * @param {string} state
 */
async function delOAuthState(state) {
  await getRedis().del(`oauth:${state}`);
}

// ── Written by Vercel, read by bot ───────────────────────────────────────────

/**
 * Store the verification result after the OAuth callback completes.
 * @param {string} discordId
 * @param {{ success: boolean, puuid?, riotName?, riotTag?, region?, reason? }} result
 */
async function setVerifyResult(discordId, result) {
  await getRedis().set(`verified:${discordId}`, result, { ex: RESULT_TTL });
}

/**
 * Atomically get and delete the verification result for a Discord user.
 * Returns null if no result is waiting.
 * @param {string} discordId
 */
async function popVerifyResult(discordId) {
  const r = getRedis();
  const result = await r.get(`verified:${discordId}`);
  if (result !== null) await r.del(`verified:${discordId}`);
  return result;
}

module.exports = { setOAuthState, getOAuthState, delOAuthState, setVerifyResult, popVerifyResult };

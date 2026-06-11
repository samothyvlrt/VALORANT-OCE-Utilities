/**
 * Discord OAuth2 helpers.
 *
 * Scope requested: identify + connections
 *   - identify   → lets us confirm the authorizing user's Discord ID
 *   - connections → lets us see their linked accounts (Riot, Steam, etc.)
 */

const crypto = require('crypto');
const config  = require('../../config');

/**
 * Generate a cryptographically random state token.
 * Used to tie an OAuth flow back to the Discord user who started it.
 * @returns {string} 64-char hex string
 */
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Build the Discord OAuth2 authorization URL.
 * @param {string} state  Random token from generateState()
 * @returns {string}
 */
function getOAuthUrl(state) {
  const params = new URLSearchParams({
    client_id:     config.discord.clientId,
    redirect_uri:  config.oauth.redirectUri,
    response_type: 'code',
    scope:         'identify connections',
    state,
    prompt:        'none', // skip the "are you sure?" screen if already authorized
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

module.exports = { generateState, getOAuthUrl };

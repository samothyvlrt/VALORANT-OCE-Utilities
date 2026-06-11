/**
 * Verification module — Discord OAuth connections method.
 *
 * Flow:
 *   1. User runs /link  → startChallenge() validates the Riot account, stores a
 *      pending record in SQLite + an OAuth state in Redis, returns an OAuth URL.
 *   2. User clicks the URL → Discord OAuth → Vercel callback.
 *   3. Vercel callback checks Discord connections, writes result to Redis.
 *   4. Bot's ready.js polling loop calls finaliseIfReady() every 15s, picks up
 *      the result, writes the final link to SQLite, and DMs the user.
 */

const db     = require('./database');
const redis  = require('./redis');
const oauth  = require('./oauth');
const { getAccount, RiotApiError } = require('./riot-api');
const config = require('../../config');

// ─────────────────────────────────────────────
// Start a verification challenge
// ─────────────────────────────────────────────

/**
 * Validate the Riot ID, enforce uniqueness, store pending, write Redis state.
 * Returns { oauthUrl, riotName, riotTag, region, accountLevel, cardUrl, expiresAt }.
 * Throws RiotApiError on lookup failure.
 * Throws VerificationError on duplicate/conflict or misconfiguration.
 */
async function startChallenge(discordId, riotIdInput, regionInput) {
  if (!config.oauth.redirectUri || !config.oauth.clientSecret) {
    throw new VerificationError(
      'The bot is not fully configured yet — OAuth credentials are missing. Please contact the server owner.',
    );
  }

  const { parseRiotId } = require('./riot-api');
  const { name, tag } = parseRiotId(riotIdInput);
  const region = (regionInput || config.riot.defaultRegion).toLowerCase();

  if (!config.regions[region]) {
    throw new VerificationError(
      `Unknown region \`${region}\`. Valid options: ${Object.keys(config.regions).join(', ')}`,
    );
  }

  const account = await getAccount(name, tag, region);

  // Enforce one-account-per-discord (global)
  const existingByDiscord = db.getLinkByDiscord(discordId);
  if (existingByDiscord) {
    if (existingByDiscord.riot_puuid === account.puuid) {
      throw new VerificationError(
        `This Discord account is already linked to **${existingByDiscord.riot_name}#${existingByDiscord.riot_tag}**.\n` +
        `Use \`/unlink\` first if you want to change accounts.`,
      );
    }
    throw new VerificationError(
      `Your Discord account is already linked to **${existingByDiscord.riot_name}#${existingByDiscord.riot_tag}**.\n` +
      `Use \`/unlink\` first to remove your existing link before linking a new account.`,
    );
  }

  // Enforce one-discord-per-riot-account (global)
  const existingByPuuid = db.getLinkByPuuid(account.puuid);
  if (existingByPuuid) {
    throw new VerificationError(
      `**${account.name}#${account.tag}** is already linked to another Discord account.\n` +
      `If this is your account and you've lost access to the previous Discord, please contact a moderator.`,
    );
  }

  // Generate state token and store pending in both SQLite and Redis
  const state = oauth.generateState();

  db.createPending({
    discordId,
    puuid:          account.puuid,
    riotName:       account.name,
    riotTag:        account.tag,
    region:         account.region,
    initialCardId:  null,
    initialTitleId: null,
    timeoutMinutes: config.verification.timeoutMinutes,
    state,
  });

  await redis.setOAuthState(state, {
    discordId,
    puuid:    account.puuid,
    riotName: account.name,
    riotTag:  account.tag,
    region:   account.region,
  });

  const expiresAt = Date.now() + config.verification.timeoutMinutes * 60 * 1000;

  return {
    oauthUrl:     oauth.getOAuthUrl(state),
    riotName:     account.name,
    riotTag:      account.tag,
    region:       account.region,
    puuid:        account.puuid,
    accountLevel: account.accountLevel,
    cardUrl:      account.cardUrl,
    expiresAt,
  };
}

// ─────────────────────────────────────────────
// Finalise a completed OAuth verification
// Called by the polling loop in ready.js
// ─────────────────────────────────────────────

/**
 * Check Redis for a completed OAuth result for this Discord user.
 * Returns { success, riotName, riotTag, region } if verified, null if not ready yet.
 * Throws VerificationError on explicit failure (e.g. Riot account not connected).
 */
async function finaliseIfReady(discordId) {
  const result = await redis.popVerifyResult(discordId);
  if (result === null) return null; // not ready yet

  if (!result.success) {
    // Callback ran but the Riot account wasn't connected — clean up pending
    db.removePending(discordId);
    throw new VerificationError(
      result.reason === 'not_connected'
        ? `**${result.riotName}#${result.riotTag}** was not found in your Discord connections.\n\n` +
          `Go to **Discord Settings → Connections → Riot Games**, add that account, then run \`/link\` again.`
        : 'Verification failed. Please run `/link` again.',
    );
  }

  return _completeVerification(discordId, result);
}

/**
 * Internal: write the verified link to SQLite and audit log.
 */
function _completeVerification(discordId, result) {
  db.upsertLink({
    discordId,
    puuid:    result.puuid,
    riotName: result.riotName,
    riotTag:  result.riotTag,
    region:   result.region,
  });
  db.removePending(discordId);
  db.audit({
    action:          'LINK_CREATE',
    targetDiscordId: discordId,
    targetRiotId:    `${result.riotName}#${result.riotTag}`,
    performedBy:     discordId,
    guildId:         null,
    details:         { method: 'discord_oauth', region: result.region, puuid: result.puuid },
  });
  return { success: true, riotName: result.riotName, riotTag: result.riotTag, region: result.region };
}

// ─────────────────────────────────────────────
// Admin force-link (bypasses ownership challenge)
// ─────────────────────────────────────────────

async function adminForceLink(targetDiscordId, riotIdInput, regionInput, adminDiscordId, guildId) {
  const { parseRiotId } = require('./riot-api');
  const { name, tag } = parseRiotId(riotIdInput);
  const region = (regionInput || config.riot.defaultRegion).toLowerCase();

  if (!config.regions[region]) {
    throw new VerificationError(`Unknown region: ${region}`);
  }

  const account = await getAccount(name, tag, region);

  const existingByPuuid = db.getLinkByPuuid(account.puuid);
  if (existingByPuuid && existingByPuuid.discord_id !== targetDiscordId) {
    throw new VerificationError(
      `**${account.name}#${account.tag}** is already linked to another Discord user (<@${existingByPuuid.discord_id}>). ` +
      `Remove that link first before reassigning.`,
    );
  }

  db.upsertLink({
    discordId: targetDiscordId,
    puuid:     account.puuid,
    riotName:  account.name,
    riotTag:   account.tag,
    region:    account.region,
  });

  db.removePending(targetDiscordId);

  db.audit({
    action:          'ADMIN_LINK_SET',
    targetDiscordId,
    targetRiotId:    `${account.name}#${account.tag}`,
    performedBy:     adminDiscordId,
    guildId,
    details:         { region: account.region, forced: true, puuid: account.puuid },
  });

  return { riotName: account.name, riotTag: account.tag, region: account.region };
}

// ─────────────────────────────────────────────
// Custom error class
// ─────────────────────────────────────────────

class VerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VerificationError';
  }
}

module.exports = { startChallenge, finaliseIfReady, adminForceLink, VerificationError };

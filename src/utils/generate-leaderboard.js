/**
 * Generates the public leaderboard payload from linked accounts and
 * pushes it to Upstash Redis under `stats:leaderboard`.
 *
 * Only public (hidden=0) accounts are included — respects /privacy.
 * Sorted by the same logic as the /leaderboard Discord command.
 *
 * Consumed by the Vercel /api/leaderboard endpoint.
 */

const db     = require('../modules/database');
const config  = require('../../config');
const { getPlayerStats } = require('../modules/riot-api');

let _guild  = null;
let _timer  = null;

// Recent rank changes for the web leaderboard red/green badge (in-memory, clears on restart).
const _recentChanges = new Map(); // discordId → { delta, expiresAt }
const CHANGE_TTL_MS  = 30 * 60 * 1000; // show badge for 30 minutes

/** Record a rank delta so generateLeaderboard can include it in the payload. */
function setRecentChange(discordId, delta) {
  _recentChanges.set(discordId, { delta, expiresAt: Date.now() + CHANGE_TTL_MS });
}

/** Call once from ready.js so the guild is available for member name lookups. */
function setGuild(guild) { _guild = guild; }

/** Debounced trigger — coalesces rapid bursts (e.g. poll loop) into one Redis write. */
function scheduleLeaderboardRegen(delayMs = 5000) {
  clearTimeout(_timer);
  _timer = setTimeout(() => { _timer = null; generateLeaderboard(_guild); }, delayMs);
}

// Throttle top-3 stats fetches to avoid burning Henrik calls on every poll-triggered regen.
// Stats are always re-fetched when the top-3 composition changes (new player enters top 3).
let _lastStatsFetch = 0;
let _lastTop3Ids    = '';
const STATS_REFRESH_INTERVAL = 60 * 60 * 1000; // 1 hour max between refreshes

/** Cumulative RR for display/sorting (Immortal/Radiant only). */
function displayRr(tier, rr) {
  if (tier === 25) return 100 + rr;  // Immortal 2
  if (tier === 26) return 200 + rr;  // Immortal 3
  return rr;                          // Immortal 1, Radiant, everyone else
}

function sortPlayers(players) {
  return [...players].sort((a, b) => {
    const aImm = a.tier >= 24;
    const bImm = b.tier >= 24;

    // Immortal+ always above lower tiers
    if (aImm !== bImm) return Number(bImm) - Number(aImm);

    if (aImm && bImm) {
      // Both Immortal+ → sort by cumulative RR descending
      if (b.displayRr !== a.displayRr) return b.displayRr - a.displayRr;
      // Tie-break: leaderboardRank ascending (lower number = better), then tier desc
      if (a.leaderboardRank && b.leaderboardRank) return a.leaderboardRank - b.leaderboardRank;
      if (a.leaderboardRank) return -1;
      if (b.leaderboardRank) return  1;
      return b.tier - a.tier;
    }

    // Both below Immortal → tier desc, then RR desc
    if (b.tier !== a.tier) return b.tier - a.tier;
    return b.rr - a.rr;
  });
}

async function generateLeaderboard(guild = null) {
  try {
    const links   = db.getPublicLinks();
    const players = [];

    // Build a discordId → username map by fetching only the specific members
    // on the leaderboard. Avoids the OOM of a full guild.members.fetch() while
    // giving complete coverage (unlike cache-only which misses inactive members).
    const nameMap = new Map();
    if (guild) {
      try {
        const ids = links
          .filter(l => { try { return (JSON.parse(l.cached_rank)?.tier ?? 0) >= 3; } catch { return false; } })
          .map(l => l.discord_id);
        if (ids.length > 0) {
          const members = await guild.members.fetch({ user: ids });
          members.forEach((m) => nameMap.set(m.id, m.user.username));
        }
      } catch (e) {
        console.warn('[leaderboard] Member fetch failed, falling back to cache:', e.message);
        guild.members.cache.forEach((m) => nameMap.set(m.id, m.user.username));
      }
    }

    for (const link of links) {
      if (!link.cached_rank) continue;
      let rank;
      try { rank = JSON.parse(link.cached_rank); } catch { continue; }

      const tier = rank?.tier;
      if (!tier || tier < 3) continue; // skip unranked / no data

      const change = _recentChanges.get(link.discord_id);
      const rrChange = (change && change.expiresAt > Date.now()) ? change.delta : null;

      players.push({
        discordId:       link.discord_id,
        discordName:     nameMap.get(link.discord_id) ?? null,
        riotName:        link.riot_name,
        riotTag:         link.riot_tag,
        puuid:           link.riot_puuid,
        region:          link.region,
        tier,
        tierName:        rank.tierName ?? '',
        rr:              rank.rr ?? 0,
        displayRr:       displayRr(tier, rank.rr ?? 0),
        leaderboardRank: rank.leaderboardRank ?? null,
        rrChange,
      });
    }

    const sorted = sortPlayers(players);

    // Fetch top-3 match stats when the composition changes OR once per hour max.
    // This ensures a new #1 player always gets stats immediately.
    const now        = Date.now();
    const top3Ids    = sorted.slice(0, 3).map(p => p.discordId).join(',');
    const compositionChanged = top3Ids !== _lastTop3Ids;
    const intervalElapsed    = now - _lastStatsFetch >= STATS_REFRESH_INTERVAL;
    if (compositionChanged || intervalElapsed) {
      _lastStatsFetch = now;
      _lastTop3Ids    = top3Ids;
      for (let i = 0; i < Math.min(3, sorted.length); i++) {
        const p = sorted[i];
        const region = p.region || config.riot.defaultRegion;
        const stats = await getPlayerStats(p.puuid, region, { type: 'competitive', size: 100 }).catch(() => null);
        console.log(`[leaderboard] top-${i + 1} ${p.riotName}#${p.riotTag} matchStats: ${stats ? 'ok' : 'null'}`);
        if (stats) {
          sorted[i] = {
            ...p,
            matchStats: { kd: stats.kd, winRate: stats.winRate, topAgents: stats.topAgents },
          };
        }
      }
    }

    const payload = {
      updatedAt: new Date().toISOString(),
      total:     sorted.length,
      players:   sorted,
    };

    const { Redis } = require('@upstash/redis');
    const redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    await redis.set('stats:leaderboard', payload);
    console.log(`[leaderboard] Published ${sorted.length} ranked players`);
    return payload;

  } catch (err) {
    console.error('[leaderboard] Failed to generate:', err.message);
    return null;
  }
}

module.exports = { generateLeaderboard, scheduleLeaderboardRegen, setGuild, setRecentChange };

/**
 * Generates the public leaderboard payload from linked accounts and
 * pushes it to Upstash Redis under `stats:leaderboard`.
 *
 * Only public (hidden=0) accounts are included — respects /privacy.
 * Sorted by the same logic as the /leaderboard Discord command.
 *
 * Consumed by the Vercel /api/leaderboard endpoint.
 */

const db = require('../modules/database');

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

async function generateLeaderboard() {
  try {
    const links   = db.getPublicLinks();
    const players = [];

    for (const link of links) {
      if (!link.cached_rank) continue;
      let rank;
      try { rank = JSON.parse(link.cached_rank); } catch { continue; }

      const tier = rank?.tier;
      if (!tier || tier < 3) continue; // skip unranked / no data

      players.push({
        riotName:       link.riot_name,
        riotTag:        link.riot_tag,
        tier,
        tierName:       rank.tierName ?? '',
        rr:             rank.rr ?? 0,
        displayRr:      displayRr(tier, rank.rr ?? 0),
        leaderboardRank: rank.leaderboardRank ?? null,
      });
    }

    const sorted = sortPlayers(players);

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

module.exports = { generateLeaderboard };

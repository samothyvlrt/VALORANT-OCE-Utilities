/**
 * Generates rank-distribution stats from the cached_rank column and
 * pushes them to Upstash Redis under the key `stats:rank-distribution`.
 *
 * The Vercel /api/stats endpoint reads this key so the web page can
 * display a tracker.gg-style distribution chart without needing direct
 * DB access.
 */

const db = require('../modules/database');

// Tier number → display label + rank group
const TIER_META = {
  3:  { label: 'I1',  tierName: 'Iron 1',       group: 'iron' },
  4:  { label: 'I2',  tierName: 'Iron 2',       group: 'iron' },
  5:  { label: 'I3',  tierName: 'Iron 3',       group: 'iron' },
  6:  { label: 'B1',  tierName: 'Bronze 1',     group: 'bronze' },
  7:  { label: 'B2',  tierName: 'Bronze 2',     group: 'bronze' },
  8:  { label: 'B3',  tierName: 'Bronze 3',     group: 'bronze' },
  9:  { label: 'S1',  tierName: 'Silver 1',     group: 'silver' },
  10: { label: 'S2',  tierName: 'Silver 2',     group: 'silver' },
  11: { label: 'S3',  tierName: 'Silver 3',     group: 'silver' },
  12: { label: 'G1',  tierName: 'Gold 1',       group: 'gold' },
  13: { label: 'G2',  tierName: 'Gold 2',       group: 'gold' },
  14: { label: 'G3',  tierName: 'Gold 3',       group: 'gold' },
  15: { label: 'P1',  tierName: 'Platinum 1',   group: 'platinum' },
  16: { label: 'P2',  tierName: 'Platinum 2',   group: 'platinum' },
  17: { label: 'P3',  tierName: 'Platinum 3',   group: 'platinum' },
  18: { label: 'D1',  tierName: 'Diamond 1',    group: 'diamond' },
  19: { label: 'D2',  tierName: 'Diamond 2',    group: 'diamond' },
  20: { label: 'D3',  tierName: 'Diamond 3',    group: 'diamond' },
  21: { label: 'A1',  tierName: 'Ascendant 1',  group: 'ascendant' },
  22: { label: 'A2',  tierName: 'Ascendant 2',  group: 'ascendant' },
  23: { label: 'A3',  tierName: 'Ascendant 3',  group: 'ascendant' },
  24: { label: 'Im1', tierName: 'Immortal 1',   group: 'immortal' },
  25: { label: 'Im2', tierName: 'Immortal 2',   group: 'immortal' },
  26: { label: 'Im3', tierName: 'Immortal 3',   group: 'immortal' },
  27: { label: 'R',   tierName: 'Radiant',      group: 'radiant' },
};

async function generateStats() {
  try {
    const links = db.getAllLinks();
    const counts = {}; // tier → count

    for (const link of links) {
      if (!link.cached_rank) continue;
      let rank;
      try { rank = JSON.parse(link.cached_rank); } catch { continue; }

      const tier = rank?.tier;
      if (tier && TIER_META[tier]) {
        counts[tier] = (counts[tier] ?? 0) + 1;
      }
    }

    const totalLinked = links.length;
    const ranked      = Object.values(counts).reduce((s, c) => s + c, 0);
    const unranked    = totalLinked - ranked;

    // Build distribution array in tier order (3 → 27), include zero entries
    // so the chart always renders all 25 bars
    const distribution = Object.keys(TIER_META).map((t) => {
      const tier  = parseInt(t, 10);
      const meta  = TIER_META[tier];
      const count = counts[tier] ?? 0;
      const pct   = ranked > 0 ? Math.round((count / ranked) * 1000) / 10 : 0;
      return { tier, ...meta, count, pct };
    });

    const payload = {
      updatedAt:    new Date().toISOString(),
      totalLinked,
      ranked,
      unranked,
      distribution,
    };

    // Lazy-load Redis to avoid crashing if env vars are missing
    const { Redis } = require('@upstash/redis');
    const redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    await redis.set('stats:rank-distribution', payload);
    console.log(`[stats] Published rank distribution — ${ranked} ranked / ${totalLinked} total linked`);
    return payload;

  } catch (err) {
    // Non-fatal — chart just won't update
    console.error('[stats] Failed to generate rank distribution:', err.message);
    return null;
  }
}

module.exports = { generateStats };

/**
 * Background rank poll loop.
 *
 * Polls Henrik /v2/mmr for recently-active ranked accounts at ~75 req/min,
 * leaving ~15/min headroom within the 90/min key limit for organic commands.
 *
 * On a change (RR or tier): updates cached_rank, records the delta for the
 * web leaderboard's red/green badge, and schedules a leaderboard regen.
 */
const db     = require('../modules/database');
const config = require('../../config');
const { getRank, RiotApiError } = require('../modules/riot-api');
const { scheduleLeaderboardRegen, setRecentChange } = require('./generate-leaderboard');

const POLL_RATE    = 75;                           // req/min target
const POLL_DELAY   = Math.ceil(60_000 / POLL_RATE); // ~800ms between accounts
const ACTIVE_DAYS  = 7;                            // skip accounts inactive for 7+ days
const BACKOFF_429  = 60_000;                       // pause duration on rate-limit hit (1 min)

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function displayRr(tier, rr) {
  if (tier === 25) return 100 + rr;
  if (tier === 26) return 200 + rr;
  return rr;
}

async function runSweep() {
  const links  = db.getPublicLinks();
  const cutoff = Date.now() - ACTIVE_DAYS * 86_400_000;

  const active = links.filter(link => {
    if (!link.cached_rank || !link.rank_cached_at) return false;
    if (new Date(link.rank_cached_at).getTime() < cutoff) return false;
    try { return (JSON.parse(link.cached_rank)?.tier ?? 0) >= 3; } catch { return false; }
  });

  for (const link of active) {
    try {
      const region = link.region || config.riot.defaultRegion;
      const fresh  = await getRank(link.riot_name, link.riot_tag, region);

      if (fresh) {
        let old;
        try { old = JSON.parse(link.cached_rank); } catch { /* corrupt, skip */ }

        if (old && (fresh.tier !== old.tier || fresh.rr !== old.rr)) {
          const delta = displayRr(fresh.tier, fresh.rr) - displayRr(old.tier, old.rr);
          db.updateRankCache(link.discord_id, fresh);
          if (delta !== 0) setRecentChange(link.discord_id, delta);
          scheduleLeaderboardRegen();
          console.log(`[poll] ${link.riot_name}#${link.riot_tag} ${old.rr}→${fresh.rr}RR (${delta >= 0 ? '+' : ''}${delta})`);
        }
      }
    } catch (err) {
      if (err instanceof RiotApiError && err.status === 429) {
        console.warn(`[poll] Rate limit hit — pausing for ${BACKOFF_429 / 1000}s`);
        await sleep(BACKOFF_429);
      } else {
        console.warn(`[poll] ${link.riot_name}#${link.riot_tag}: ${err.message}`);
      }
    }

    await sleep(POLL_DELAY);
  }
}

async function startRankPollLoop() {
  // Give the bot 90s to fully settle before hammering the API
  await sleep(90_000);
  console.log('[poll] Rank poll loop started');
  while (true) {
    try { await runSweep(); } catch (err) { console.error('[poll] Sweep error:', err.message); }
    await sleep(2_000);
  }
}

module.exports = { startRankPollLoop };

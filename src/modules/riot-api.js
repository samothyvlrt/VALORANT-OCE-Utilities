const axios = require('axios');
const config = require('../../config');

// ─────────────────────────────────────────────
// Axios instances
// ─────────────────────────────────────────────

const henrik = axios.create({
  baseURL: 'https://api.henrikdev.xyz',
  timeout: 10_000,
  headers: config.riot.henrikkApiKey
    ? { Authorization: config.riot.henrikkApiKey }
    : {},
});

const riotOfficial = axios.create({
  timeout: 10_000,
  headers: config.riot.riotApiKey
    ? { 'X-Riot-Token': config.riot.riotApiKey }
    : {},
});

// ─────────────────────────────────────────────
// Error helper
// ─────────────────────────────────────────────

class RiotApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'RiotApiError';
    this.status = status;
  }
}

function mapHenrikError(err) {
  const status = err.response?.status;
  if (status === 404) throw new RiotApiError('Account not found. Check the Riot ID and region.', 404);
  if (status === 429) throw new RiotApiError('Rate limit reached. Please wait a moment and try again.', 429);
  if (status === 403) throw new RiotApiError('API key invalid or missing. Contact the bot owner.', 403);
  if (!status || status >= 500) throw new RiotApiError('Riot data is temporarily unavailable — please try again in a few minutes.', status ?? 0);
  throw new RiotApiError(`Riot API error (${status})`, status);
}

// ─────────────────────────────────────────────
// Parse Riot ID input  ("Name#Tag" or "Name #Tag")
// ─────────────────────────────────────────────

/**
 * Parse a raw Riot ID string into { name, tag }.
 * Accepts "Name#Tag", "Name #Tag", or "Name # Tag".
 * @param {string} input
 * @returns {{ name: string, tag: string }}
 */
function parseRiotId(input) {
  const clean = input.trim();
  const hashIndex = clean.indexOf('#');
  if (hashIndex === -1) throw new RiotApiError('Invalid Riot ID — must include a # (e.g. `Aceship#OCE`).', 400);
  const name = clean.slice(0, hashIndex).trim();
  const tag = clean.slice(hashIndex + 1).trim();
  if (!name || !tag) throw new RiotApiError('Invalid Riot ID — name or tag is empty.', 400);
  return { name, tag };
}

// ─────────────────────────────────────────────
// Account lookup
// ─────────────────────────────────────────────

/**
 * Look up a Riot account by name + tag.
 * Returns { puuid, name, tag, region, accountLevel, cardId, cardUrl }.
 *
 * Tries official Riot API first (if key available), falls back to HenrikDev.
 */
async function getAccount(name, tag, region = config.riot.defaultRegion) {
  // Use HenrikDev as primary — it returns richer profile data without a region routing headache.
  try {
    const res = await henrik.get(`/valorant/v3/profile/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
    const d = res.data?.data;
    if (!d) throw new RiotApiError('Unexpected API response.', 500);

    return {
      puuid: d.puuid,
      name: d.name,
      tag: d.tag,
      region: (d.region || region).toLowerCase(),
      accountLevel: d.account_level ?? 0,
      cardId: d.card?.id ?? null,
      cardUrl: d.card?.small ?? null,
    };
  } catch (err) {
    if (err instanceof RiotApiError) throw err;

    // HenrikDev /v3/profile might not exist on all servers — fall back to /v1/account
    if (err.response?.status === 404 || err.response?.status === 400) {
      // Try the simpler v1 endpoint before giving up
      try {
        const res2 = await henrik.get(
          `/valorant/v1/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
        );
        const d2 = res2.data?.data;
        if (!d2) throw new RiotApiError('Account not found.', 404);
        return {
          puuid: d2.puuid,
          name: d2.name,
          tag: d2.tag,
          region: (d2.region || region).toLowerCase(),
          accountLevel: d2.account_level ?? 0,
          cardId: d2.card?.id ?? null,
          cardUrl: d2.card?.small ?? null,
        };
      } catch (err2) {
        if (err2 instanceof RiotApiError) throw err2;
        mapHenrikError(err2);
      }
    }

    mapHenrikError(err);
  }
}

/**
 * Fetch the start timestamp (ms) of the player's most recent match.
 * Uses the PUUID-based endpoint for reliability (avoids name encoding issues).
 * Falls back to name+tag if puuid is not available.
 * Returns null if no matches found or on error (best-effort).
 *
 * @param {string} puuidOrName  — PUUID (preferred) or player name
 * @param {string} regionOrTag  — region (when called with puuid) or tag (when called with name)
 * @param {string} [region]     — region (only needed when called with name+tag)
 */
async function getLatestMatchTimestamp(puuidOrName, regionOrTag, region) {
  // Detect call signature: if 'region' arg is provided, it's name+tag+region; else puuid+region
  const usePuuid = region === undefined;
  const url = usePuuid
    ? `/valorant/v3/by-puuid/matches/${regionOrTag}/${puuidOrName}?size=1`
    : `/valorant/v3/matches/${region}/${encodeURIComponent(puuidOrName)}/${encodeURIComponent(regionOrTag)}?size=1`;

  try {
    const res = await henrik.get(url);
    const matches = res.data?.data;
    console.log(`[riot-api] matches response status: ${res.status} | count: ${matches?.length ?? 'null'} | url: ${url}`);
    if (!matches || matches.length === 0) return null;

    const meta = matches[0]?.metadata;
    console.log(`[riot-api] first match metadata keys: ${meta ? Object.keys(meta).join(', ') : 'null'}`);
    console.log(`[riot-api] first match metadata:`, JSON.stringify(meta));

    // HenrikDev v3 uses 'started_at' (ISO string or Unix seconds integer)
    const startedAt = meta?.started_at ?? meta?.game_start ?? meta?.gameStart ?? null;
    if (!startedAt) return null;

    // Handle ISO strings ("2024-01-15T10:30:00Z") and Unix timestamps (seconds or ms)
    if (typeof startedAt === 'string') return new Date(startedAt).getTime();
    return startedAt > 1e12 ? startedAt : startedAt * 1000;
  } catch (err) {
    console.error(`[riot-api] getLatestMatchTimestamp error:`, err.response?.status, err.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// MMR / Rank
// ─────────────────────────────────────────────

/**
 * Fetch current rank info for a player.
 * Returns { tier, tierName, rr, peakTier, peakTierName, leaderboardRank } or null if unranked.
 */
async function getRank(name, tag, region = config.riot.defaultRegion) {
  try {
    const res = await henrik.get(
      `/valorant/v2/mmr/${region}/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
    );
    const d       = res.data?.data;
    const current = d?.current_data;
    const peak    = d?.highest_rank;

    // At an Act/Episode rollover Riot keeps a player's previous tier in the API
    // until they finish their placement game(s). HenrikDev reports how many
    // placement games are still required via `games_needed_for_rating`; while
    // that's > 0 the player is effectively Unranked for the new act, regardless
    // of the stale `currenttier`. The field may be absent on some responses, so
    // it defaults to 0 — leaving existing behaviour unchanged.
    const gamesNeeded  = current?.games_needed_for_rating ?? 0;
    const inPlacements = gamesNeeded > 0;

    // Return at minimum peak data even if currently unranked / in placements
    const isRanked = current && (current.currenttier ?? 0) > 0 && !inPlacements;

    return {
      tier:            isRanked ? (current.currenttier ?? 0) : 0,
      tierName:        isRanked ? (current.currenttierpatched ?? 'Unranked') : 'Unranked',
      rr:              isRanked ? (current.ranking_in_tier ?? 0) : 0,
      leaderboardRank: current?.leaderboard_rank ?? null,
      rrChangeLast:    isRanked ? (current.mmr_change_to_last_game ?? null) : null,
      smallIcon:       isRanked ? (current.images?.small ?? null) : null,
      inPlacements,
      gamesNeeded,
      peakTier:        peak?.tier ?? 0,
      peakTierName:    peak?.patched_tier ?? null,
      peakSeason:      peak?.season ?? null,
      peakSmallIcon:   peak?.images?.small ?? null,
    };
  } catch (err) {
    console.error(`[riot-api] getRank error:`, err.response?.status, err.response?.data ?? err.message);
    return null;
  }
}

/**
 * Fetch a player's competitive MMR history (one entry per ranked game).
 * Used to backfill rank_history for the /profile RR graph so newly linked
 * players get a graph immediately instead of waiting for the poll loop to
 * accumulate snapshots.
 *
 * Returns [{ tier, tierName, rr, recordedAt }] oldest-first, ranked games
 * only (tier ≥ 3), consecutive duplicates removed. [] on error/no data.
 */
async function getMmrHistory(puuid, region = config.riot.defaultRegion) {
  try {
    const res = await henrik.get(`/valorant/v1/by-puuid/mmr-history/${region}/${puuid}`);
    const raw = res.data?.data ?? [];

    const entries = raw
      .filter((e) => (e.currenttier ?? 0) >= 3 && e.date_raw)
      .map((e) => ({
        tier:       e.currenttier,
        tierName:   e.currenttierpatched ?? 'Unknown',
        rr:         e.ranking_in_tier ?? 0,
        recordedAt: e.date_raw * 1000,
      }))
      .sort((a, b) => a.recordedAt - b.recordedAt);

    return entries.filter((e, i) =>
      i === 0 || e.tier !== entries[i - 1].tier || e.rr !== entries[i - 1].rr,
    );
  } catch (err) {
    console.error('[riot-api] getMmrHistory error:', err.response?.status, err.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// Player Stats (last 20 matches)
// ─────────────────────────────────────────────

/**
 * Fetch aggregate stats for a player from their last 20 competitive/unrated matches.
 * Returns { kd, kills, deaths, winRate, wins, totalMatches, topAgents } or null on error.
 * @param {string} puuid
 * @param {string} region
 */
async function getPlayerStats(puuid, region, { type = null, size = 20 } = {}) {
  try {
    const params = new URLSearchParams({ size });
    if (type) params.set('type', type);
    const res = await henrik.get(
      `/valorant/v3/by-puuid/matches/${region}/${puuid}?${params}`,
    );
    const matches = res.data?.data;
    if (!matches || !matches.length) return null;

    let kills = 0, deaths = 0, wins = 0, totalMatches = 0;
    const agentMap = {};

    for (const match of matches) {
      const allPlayers = match.players?.all_players ?? [];
      const player = allPlayers.find((p) => p.puuid === puuid);
      if (!player) continue;

      totalMatches++;
      kills  += player.stats?.kills  ?? 0;
      deaths += player.stats?.deaths ?? 0;

      const playerTeam = (player.team ?? '').toLowerCase(); // "red" or "blue"
      const won = match.teams?.[playerTeam]?.has_won ?? false;
      if (won) wins++;

      const agent = player.character ?? 'Unknown';
      if (!agentMap[agent]) agentMap[agent] = { games: 0, wins: 0 };
      agentMap[agent].games++;
      if (won) agentMap[agent].wins++;
    }

    if (!totalMatches) return null;

    const topAgents = Object.entries(agentMap)
      .sort((a, b) => b[1].games - a[1].games)
      .slice(0, 3)
      .map(([name, s]) => ({
        name,
        games:    s.games,
        playPct:  Math.round((s.games / totalMatches) * 100),
        winRate:  Math.round((s.wins / s.games) * 100),
      }));

    return {
      kills,
      deaths,
      kd:           deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2),
      winRate:      Math.round((wins / totalMatches) * 100),
      wins,
      totalMatches,
      topAgents,
    };
  } catch (err) {
    console.error('[riot-api] getPlayerStats error:', err.response?.status, err.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// Last match
// ─────────────────────────────────────────────

/**
 * Fetch recent matches for a player by PUUID.
 * Returns an array of HenrikDev v3 match objects (up to `size`), or [] if none.
 * Throws RiotApiError on API failures.
 * @param {string} puuid
 * @param {string} region
 * @param {number} size   — number of matches to fetch (max 10 per HenrikDev free tier)
 */
async function getMatchHistory(puuid, region, size = 1) {
  try {
    const res = await henrik.get(
      `/valorant/v3/by-puuid/matches/${region}/${puuid}?size=${size}`,
    );
    return res.data?.data ?? [];
  } catch (err) {
    if (err instanceof RiotApiError) throw err;
    mapHenrikError(err);
  }
}

/**
 * Fetch the most recent match object for a player by PUUID.
 * Returns the full HenrikDev v3 match object, or null if no matches found.
 * Throws RiotApiError on API failures.
 * @param {string} puuid
 * @param {string} region
 */
async function getLastMatch(puuid, region) {
  const matches = await getMatchHistory(puuid, region, 1);
  return matches[0] ?? null;
}

// ─────────────────────────────────────────────
// Premier
// ─────────────────────────────────────────────

// Riot numbers Premier divisions 1–21. 21 (Contender) is the apex of the
// ladder; Invite sits above it outside this numbering.
const PREMIER_DIVISION_GROUPS = [
  [1,  5,  'Open'],
  [6,  10, 'Intermediate'],
  [11, 15, 'Advanced'],
  [16, 20, 'Elite'],
  [21, 21, 'Contender'],
];

/**
 * Human-readable Premier division name for a division number (1–21),
 * e.g. 6 → "Intermediate 1", 21 → "Contender".
 */
function premierDivisionName(division) {
  const group = PREMIER_DIVISION_GROUPS.find(([s, e]) => division >= s && division <= e);
  if (!group) return `Division ${division}`;
  const [start, end, label] = group;
  return start === end ? label : `${label} ${division - start + 1}`;
}

/**
 * Search Premier teams by exact team name + tag.
 * Returns an array of team summaries:
 * { id, name, tag, conference, division, affinity, region, wins, losses, score, customization }
 * NOTE: Riot no longer exposes team rosters, so a player's team cannot be
 * looked up by PUUID — users register their team by name (see /premier link).
 */
async function searchPremierTeams(name, tag) {
  try {
    const res = await henrik.get('/valorant/v1/premier/search', {
      params: { name, tag },
    });
    return res.data?.data ?? [];
  } catch (err) {
    if (err.response?.status === 404) return [];
    mapHenrikError(err);
  }
}

/**
 * Fetch full Premier team details by team ID.
 * Returns { id, name, tag, enrolled, ranked, stats: { wins, matches, losses,
 * rounds_won, rounds_lost }, placement: { points, conference, division, place },
 * customization: { icon, image, primary, ... }, member } or null on 404.
 */
async function getPremierTeam(teamId) {
  try {
    const res = await henrik.get(`/valorant/v1/premier/${teamId}`);
    return res.data?.data ?? null;
  } catch (err) {
    if (err.response?.status === 404) return null;
    mapHenrikError(err);
  }
}

/**
 * Fetch a Premier team's league match history.
 * Returns { league_matches: [{ id, points_before, points_after, started_at }] }
 * or null on 404.
 */
async function getPremierHistory(teamId) {
  try {
    const res = await henrik.get(`/valorant/v1/premier/${teamId}/history`);
    return res.data?.data ?? null;
  } catch (err) {
    if (err.response?.status === 404) return null;
    mapHenrikError(err);
  }
}

/**
 * Auto-discover a player's Premier team from their most recent Premier match.
 * The v4 match payload carries both teams' premier_roster (id, name, tag,
 * member puuids), so finding the roster containing the player's PUUID is a
 * hard proof of membership — the only such proof available now that Riot no
 * longer exposes rosters on the team endpoints.
 *
 * Returns { id, name, tag } or null if the player has no stored Premier
 * matches (never played one this season / not in HenrikDev's stored data).
 */
async function discoverPremierTeam(puuid, region = config.riot.defaultRegion) {
  try {
    const lt = await henrik.get(
      `/valorant/v1/by-puuid/lifetime/matches/${region}/${puuid}`,
      { params: { mode: 'premier', size: 1 } },
    );
    const matchId = lt.data?.data?.[0]?.meta?.id;
    if (!matchId) return null;

    const res = await henrik.get(`/valorant/v4/match/${region}/${matchId}`);
    const teams = res.data?.data?.teams ?? [];
    for (const t of teams) {
      const roster = t.premier_roster;
      if (roster?.members?.includes(puuid)) {
        return { id: roster.id, name: roster.name, tag: roster.tag };
      }
    }
    return null;
  } catch (err) {
    if (err.response?.status === 404) return null;
    mapHenrikError(err);
  }
}

// ─────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────

module.exports = {
  parseRiotId,
  getAccount,
  getLatestMatchTimestamp,
  getRank,
  getMmrHistory,
  getPlayerStats,
  getMatchHistory,
  getLastMatch,
  searchPremierTeams,
  getPremierTeam,
  getPremierHistory,
  discoverPremierTeam,
  premierDivisionName,
  RiotApiError,
};

/**
 * Booster tenure roles (accumulated tenure).
 *
 * Total tenure = banked time (completed streaks the bot observed + manual
 * credits, stored in the booster_tenure table) + the live current streak
 * (now − premiumSince). Discord exposes no cumulative-boost API, so the bot
 * accumulates going forward (banking each streak when it ends) and staff can
 * grant historical months via /boostercredit.
 *
 * This module is DB-free: callers pass the member's banked ms in. The
 * "broken streak" role is granted to ex-boosters who reached the threshold.
 */
const config = require('../../config');

const MONTH_MS = 30.4375 * 24 * 60 * 60 * 1000; // average month

/** Whole months represented by a duration in ms. */
function monthsFromMs(ms) {
  return Math.max(0, Math.floor(ms / MONTH_MS));
}

/** Highest tier roleId for `months` of tenure (roles sorted ascending). */
function targetTierRoleId(months, roles) {
  let target = null;
  for (const r of roles) if (months >= r.months) target = r.roleId;
  return target;
}

function getCfg() {
  return {
    roles:            config.discord.boosterRoles,
    brokenRoleId:     config.discord.boosterBrokenRoleId,
    brokenThreshold:  config.discord.boosterBrokenThreshold,
    stripNonBoosters: config.discord.boosterStripNonBoosters,
  };
}

/** Tenure breakdown for a member given their banked ms. */
function tenure(member, bankedMs) {
  const boosting = !!member.premiumSinceTimestamp;
  const streakMs = boosting ? Math.max(0, Date.now() - member.premiumSinceTimestamp) : 0;
  const totalMs  = (bankedMs || 0) + streakMs;
  return { boosting, streakMs, bankedMs: bankedMs || 0, totalMs, totalMonths: monthsFromMs(totalMs) };
}

/**
 * Pure planner: decide role changes from boost state + total tenure + current roles.
 * @returns {{ targetTier: ?string, toAdd: string[], toRemove: string[] }}
 */
function computePlan(boosting, totalMonths, currentRoleIds, cfg) {
  const currentTiers = cfg.roles.map((r) => r.roleId).filter((id) => currentRoleIds.includes(id));
  const hasBroken = !!cfg.brokenRoleId && currentRoleIds.includes(cfg.brokenRoleId);
  const targetTier = boosting ? targetTierRoleId(totalMonths, cfg.roles) : null;

  // Highest tier (in months) the member currently holds — evidence of past tenure
  // for members with no banked record (e.g. existing population on first run).
  let currentPeak = 0;
  for (const r of cfg.roles) if (currentTiers.includes(r.roleId)) currentPeak = Math.max(currentPeak, r.months);

  const toAdd = [];
  const toRemove = [];

  if (boosting) {
    for (const id of currentTiers) if (id !== targetTier) toRemove.push(id);
    if (targetTier && !currentTiers.includes(targetTier)) toAdd.push(targetTier);
    if (hasBroken) toRemove.push(cfg.brokenRoleId);
  } else {
    const earnedBroken = totalMonths >= cfg.brokenThreshold || currentPeak >= cfg.brokenThreshold || hasBroken;
    if (cfg.brokenRoleId && earnedBroken) {
      for (const id of currentTiers) toRemove.push(id);
      if (!hasBroken) toAdd.push(cfg.brokenRoleId);
    } else if (cfg.stripNonBoosters) {
      for (const id of currentTiers) toRemove.push(id);
    }
  }

  return { targetTier, toAdd, toRemove };
}

/**
 * Apply the plan to a real GuildMember. `bankedMs` comes from the caller (DB).
 * Returns the plan + tenure breakdown. Never touches Discord-managed roles.
 */
async function reconcileMember(member, bankedMs, cfg = getCfg()) {
  const t = tenure(member, bankedMs);
  const plan = computePlan(t.boosting, t.totalMonths, [...member.roles.cache.keys()], cfg);

  const manageable = (id) => {
    const role = member.guild.roles.cache.get(id);
    return role && !role.managed;
  };
  for (const id of plan.toRemove) {
    if (!manageable(id)) continue;
    await member.roles.remove(id, 'Booster tenure').catch((e) => console.warn(`[booster] remove ${id} from ${member.id}: ${e.message}`));
  }
  for (const id of plan.toAdd) {
    if (!manageable(id)) continue;
    await member.roles.add(id, 'Booster tenure').catch((e) => console.warn(`[booster] add ${id} to ${member.id}: ${e.message}`));
  }
  return { ...plan, ...t };
}

/** "4 months, 12 days" style duration from ms. */
function formatDuration(ms) {
  const days = Math.floor(ms / 86_400_000);
  const months = Math.floor(days / 30.4375);
  const remDays = Math.max(0, days - Math.round(months * 30.4375));
  const parts = [];
  if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
  if (remDays > 0 || !parts.length) parts.push(`${remDays} day${remDays !== 1 ? 's' : ''}`);
  return parts.join(', ');
}

module.exports = { MONTH_MS, monthsFromMs, targetTierRoleId, getCfg, tenure, computePlan, reconcileMember, formatDuration };

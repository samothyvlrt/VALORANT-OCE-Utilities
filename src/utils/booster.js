/**
 * Booster tenure roles (continuous tenure from Discord's `premiumSince`).
 *
 * Discord only exposes when a member started boosting THIS guild (their current
 * continuous streak) — there is no cumulative-tenure API. So tenure here = time
 * since `premiumSince`. The "broken streak" role is granted to ex-boosters who
 * reached the threshold then stopped; we detect that from the tier role they
 * still hold at the moment they stop (no history storage needed), and it
 * persists once granted.
 */
const config = require('../../config');

/** Whole UTC calendar months elapsed between two timestamps (ms). */
function monthsElapsed(startMs, nowMs = Date.now()) {
  const s = new Date(startMs);
  const n = new Date(nowMs);
  let m = (n.getUTCFullYear() - s.getUTCFullYear()) * 12 + (n.getUTCMonth() - s.getUTCMonth());
  if (n.getUTCDate() < s.getUTCDate()) m -= 1; // not a full month yet
  return Math.max(0, m);
}

/** Highest tier roleId a member with `months` tenure qualifies for (roles sorted asc). */
function targetTierRoleId(months, roles) {
  let target = null;
  for (const r of roles) if (months >= r.months) target = r.roleId;
  return target;
}

/** Config snapshot for booster logic. */
function getCfg() {
  return {
    roles:           config.discord.boosterRoles,
    brokenRoleId:    config.discord.boosterBrokenRoleId,
    brokenThreshold: config.discord.boosterBrokenThreshold,
    stripNonBoosters: config.discord.boosterStripNonBoosters,
    tierIds:         new Set(config.discord.boosterRoles.map((r) => r.roleId)),
  };
}

/**
 * Pure planner: given a member's boost state + current roles, decide role changes.
 * @param {?number} premiumSinceTimestamp  ms, or null/0 if not boosting
 * @param {string[]} currentRoleIds
 * @param {object} cfg  from getCfg()
 * @param {number} [nowMs]
 * @returns {{ months: ?number, targetTier: ?string, toAdd: string[], toRemove: string[] }}
 */
function computePlan(premiumSinceTimestamp, currentRoleIds, cfg, nowMs = Date.now()) {
  const currentTiers = cfg.roles.map((r) => r.roleId).filter((id) => currentRoleIds.includes(id));
  const hasBroken = !!cfg.brokenRoleId && currentRoleIds.includes(cfg.brokenRoleId);
  const boosting = !!premiumSinceTimestamp;
  const months = boosting ? monthsElapsed(premiumSinceTimestamp, nowMs) : null;
  const targetTier = months !== null ? targetTierRoleId(months, cfg.roles) : null;

  // Highest tier (in months) the member currently holds — evidence of past tenure.
  let currentPeak = 0;
  for (const r of cfg.roles) if (currentTiers.includes(r.roleId)) currentPeak = Math.max(currentPeak, r.months);

  const toAdd = [];
  const toRemove = [];

  if (boosting) {
    // Keep exactly the qualifying tier; drop any other tier + the broken-streak role.
    for (const id of currentTiers) if (id !== targetTier) toRemove.push(id);
    if (targetTier && !currentTiers.includes(targetTier)) toAdd.push(targetTier);
    if (hasBroken) toRemove.push(cfg.brokenRoleId);
  } else {
    const earnedBroken = currentPeak >= cfg.brokenThreshold || hasBroken;
    if (cfg.brokenRoleId && earnedBroken) {
      for (const id of currentTiers) toRemove.push(id);
      if (!hasBroken) toAdd.push(cfg.brokenRoleId);
    } else if (cfg.stripNonBoosters) {
      for (const id of currentTiers) toRemove.push(id);
    }
  }

  return { months, targetTier, toAdd, toRemove };
}

/** Apply the plan to a real GuildMember. Returns the plan. */
async function reconcileMember(member, cfg = getCfg()) {
  const plan = computePlan(member.premiumSinceTimestamp ?? null, [...member.roles.cache.keys()], cfg);
  const manageable = (id) => {
    const role = member.guild.roles.cache.get(id);
    return role && !role.managed; // Discord-managed roles (e.g. native booster) can't be touched
  };
  for (const id of plan.toRemove) {
    if (!manageable(id)) continue;
    await member.roles.remove(id, 'Booster tenure reconcile').catch((e) => console.warn(`[booster] remove ${id} from ${member.id}: ${e.message}`));
  }
  for (const id of plan.toAdd) {
    if (!manageable(id)) continue;
    await member.roles.add(id, 'Booster tenure reconcile').catch((e) => console.warn(`[booster] add ${id} to ${member.id}: ${e.message}`));
  }
  return plan;
}

/** "4 months, 12 days" style duration from ms. */
function formatDuration(ms) {
  const days = Math.floor(ms / 86_400_000);
  const months = Math.floor(days / 30.4375);
  const remDays = days - Math.round(months * 30.4375);
  const parts = [];
  if (months > 0) parts.push(`${months} month${months !== 1 ? 's' : ''}`);
  if (remDays > 0 || !parts.length) parts.push(`${Math.max(0, remDays)} day${remDays !== 1 ? 's' : ''}`);
  return parts.join(', ');
}

module.exports = { monthsElapsed, targetTierRoleId, getCfg, computePlan, reconcileMember, formatDuration };

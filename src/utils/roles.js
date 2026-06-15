const config = require('../../config');

// Map a HenrikDev tier number to the config rankRoles key
// Valorant API tier values: 0=Unranked, 3-5=Iron, 6-8=Bronze, 9-11=Silver,
// 12-14=Gold, 15-17=Plat, 18-20=Diamond, 21-23=Ascendant, 24-26=Immortal, 27=Radiant
function tierToRoleKey(tier) {
  if (tier >= 3  && tier <= 5)  return 'iron';
  if (tier >= 6  && tier <= 8)  return 'bronze';
  if (tier >= 9  && tier <= 11) return 'silver';
  if (tier >= 12 && tier <= 14) return 'gold';
  if (tier >= 15 && tier <= 17) return 'platinum';
  if (tier >= 18 && tier <= 20) return 'diamond';
  if (tier >= 21 && tier <= 23) return 'ascendant';
  if (tier >= 24 && tier <= 26) return 'immortal';
  if (tier === 27)              return 'radiant';
  return 'unranked';
}

// All rank role IDs as a flat array (for bulk removal)
function allRankRoleIds() {
  return Object.values(config.rankRoles).filter(Boolean);
}

/**
 * Assign the correct rank role to a guild member, removing all other rank roles first.
 * @param {import('discord.js').GuildMember} member
 * @param {number} tier  — HenrikDev currenttier value (0 = unranked)
 */
async function assignRankRole(member, tier) {
  const roleIds = allRankRoleIds();
  if (!roleIds.length) return; // roles not configured

  const roleKey   = tierToRoleKey(tier);
  const targetId  = config.rankRoles[roleKey];

  // Remove all rank roles the member currently has
  const toRemove = member.roles.cache.filter(r => roleIds.includes(r.id));
  if (toRemove.size) await member.roles.remove(toRemove.map(r => r.id));

  // Add the correct rank role
  if (targetId) await member.roles.add(targetId);
}

/**
 * Strip all rank roles from a member (used on unlink).
 * @param {import('discord.js').GuildMember} member
 */
async function removeAllRankRoles(member) {
  const roleIds = allRankRoleIds().filter(id => member.roles.cache.has(id));
  if (roleIds.length) await member.roles.remove(roleIds);
}

module.exports = { tierToRoleKey, allRankRoleIds, assignRankRole, removeAllRankRoles };

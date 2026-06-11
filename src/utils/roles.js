const config = require('../../config');

// Map a HenrikDev tier number to the config rankRoles key
function tierToRoleKey(tier) {
  if (tier >= 1  && tier <= 3)  return 'iron';
  if (tier >= 4  && tier <= 6)  return 'bronze';
  if (tier >= 7  && tier <= 9)  return 'silver';
  if (tier >= 10 && tier <= 12) return 'gold';
  if (tier >= 13 && tier <= 15) return 'platinum';
  if (tier >= 16 && tier <= 18) return 'diamond';
  if (tier >= 19 && tier <= 21) return 'ascendant';
  if (tier >= 22 && tier <= 24) return 'immortal';
  if (tier === 25)              return 'radiant';
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

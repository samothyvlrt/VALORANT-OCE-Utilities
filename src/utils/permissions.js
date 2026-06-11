const { PermissionFlagsBits } = require('discord.js');
const config = require('../../config');

/**
 * Returns true if the GuildMember qualifies as a bot admin.
 * Qualifies if:
 *   - They have the Discord Administrator permission, OR
 *   - They hold any of the configured ADMIN_ROLE_IDS
 *
 * @param {import('discord.js').GuildMember} member
 */
function isAdmin(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (config.discord.adminRoleIds.length === 0) return false;
  return config.discord.adminRoleIds.some((id) => member.roles.cache.has(id));
}

/**
 * Returns true if the GuildMember is restricted from linking.
 * @param {import('discord.js').GuildMember} member
 */
function isRestricted(member) {
  if (!member) return false;
  if (!config.discord.restrictedRoleId) return false;
  return member.roles.cache.has(config.discord.restrictedRoleId);
}

module.exports = { isAdmin, isRestricted };

const { PermissionFlagsBits } = require('discord.js');
const config = require('../../config');
const embed = require('./embed');

/**
 * Named tier levels for readability in command files.
 * Mirrors config.discord.staffTiers.
 */
const LEVELS = Object.freeze({
  MOD:        1, // Moderator
  SNR_MOD:    2, // Senior Moderator
  ADMIN:      3, // Admin
  SNR_ADMIN:  4, // Senior Admin
  HEAD_ADMIN: 5, // Head Admin
  SNR_MGMT:   6, // Senior Management
});

/**
 * Commands every member — including Restricted — may always run.
 */
const ALWAYS_ALLOWED = new Set(['lock', 'unlock']);

/**
 * True if the user ID is in the global bypass list (can run everything).
 * @param {string} userId
 */
function isBypass(userId) {
  return !!userId && config.discord.bypassUserIds.includes(userId);
}

/**
 * True if the member holds the Restricted role.
 * Restricted members may only run the ALWAYS_ALLOWED commands.
 * @param {import('discord.js').GuildMember} member
 */
function isRestricted(member) {
  if (!member) return false;
  if (!config.discord.restrictedRoleId) return false;
  return member.roles.cache.has(config.discord.restrictedRoleId);
}

/**
 * The member's effective staff level.
 *   - bypass user                 → Infinity
 *   - Discord Administrator perm   → Infinity
 *   - otherwise the HIGHEST configured tier whose role they hold
 *   - 0 if they hold no staff role
 * @param {import('discord.js').GuildMember} member
 * @returns {number}
 */
function memberLevel(member) {
  if (!member) return 0;
  if (isBypass(member.id)) return Infinity;
  if (member.permissions?.has?.(PermissionFlagsBits.Administrator)) return Infinity;

  let level = 0;
  for (const tier of config.discord.staffTiers) {
    if (tier.roleId && member.roles.cache.has(tier.roleId) && tier.level > level) {
      level = tier.level;
    }
  }
  return level;
}

/**
 * Backward-compatible "is this member a bot admin?" helper.
 * Admin tier (level 3) or above qualifies.
 * @param {import('discord.js').GuildMember} member
 */
function isAdmin(member) {
  return memberLevel(member) >= LEVELS.ADMIN;
}

/**
 * Gate a command behind a minimum tier level.
 * If the member qualifies, returns true. Otherwise replies with an
 * ephemeral "Access Denied" and returns false.
 *
 *   if (!(await requireTier(interaction, LEVELS.SNR_MOD))) return;
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {number} requiredLevel
 * @returns {Promise<boolean>}
 */
async function requireTier(interaction, requiredLevel) {
  if (memberLevel(interaction.member) >= requiredLevel) return true;

  await interaction.reply({
    embeds: [embed.error('Access Denied', "You don't have permission to use this command.")],
    ephemeral: true,
  }).catch(() => {});
  return false;
}

module.exports = {
  LEVELS,
  ALWAYS_ALLOWED,
  isBypass,
  isRestricted,
  memberLevel,
  isAdmin,
  requireTier,
};

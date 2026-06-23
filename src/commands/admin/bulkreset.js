/**
 * /bulkreset — force every member of a role to re-verify (was: /admin link bulk-reset).
 * Minimum tier: Senior Admin.
 */
const { SlashCommandBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { requireTier, LEVELS } = require('../../utils/permissions');
const { logAdminAction } = require('../../utils/activity-log');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bulkreset')
    .setDescription('Staff: force all members of a role to re-verify their linked accounts.')
    .setDefaultMemberPermissions('0')
    .addRoleOption((opt) =>
      opt.setName('role').setDescription('Role to reset').setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Reason for bulk reset (optional)').setRequired(false),
    )
    .addBooleanOption((opt) =>
      opt.setName('silent').setDescription('If true, affected users will NOT be sent a DM (default: false)').setRequired(false),
    ),

  async execute(interaction) {
    if (!(await requireTier(interaction, LEVELS.SNR_ADMIN))) return;

    await interaction.deferReply({ ephemeral: true });

    const role   = interaction.options.getRole('role');
    const reason = interaction.options.getString('reason') || 'Season reset';
    const silent = interaction.options.getBoolean('silent') ?? false;

    await interaction.guild.members.fetch();
    const roleMembers = interaction.guild.members.cache.filter((m) => m.roles.cache.has(role.id));
    const discordIds = roleMembers.map((m) => m.id);
    const links = db.getLinksByDiscordIds(discordIds);

    if (!links.length) {
      return interaction.editReply({
        embeds: [embed.info('Nothing to Reset', `No linked accounts found for **@${role.name}**.`)],
      });
    }

    let removed = 0;
    let dmFailed = 0;

    for (const link of links) {
      db.removeLink(link.discord_id);
      db.audit({
        action: 'ADMIN_BULK_RESET',
        targetDiscordId: link.discord_id,
        targetRiotId: `${link.riot_name}#${link.riot_tag}`,
        performedBy: interaction.user.id,
        guildId: interaction.guildId,
        details: { reason, role: role.id, silent },
      });
      removed++;

      if (!silent) {
        try {
          const member = roleMembers.get(link.discord_id);
          if (member) {
            const dm = await member.createDM();
            await dm.send({
              embeds: [
                embed.warning(
                  'Account Re-Verification Required',
                  [
                    `Your linked Riot account (**${link.riot_name}#${link.riot_tag}**) has been reset as part of a bulk season reset.`,
                    ``,
                    `**Reason:** ${reason}`,
                    ``,
                    `Please run \`/link\` to re-link and verify your account.`,
                  ].join('\n'),
                ),
              ],
            });
          }
        } catch {
          dmFailed++;
        }
      }
    }

    logAdminAction(interaction.client, {
      action:    'Bulk Reset',
      moderator: interaction.user,
      fields:    { Role: `@${role.name}`, Reset: removed, Reason: reason, Silent: silent ? 'Yes' : 'No' },
      guildId:   interaction.guildId,
    });

    await interaction.editReply({
      embeds: [
        embed.success(
          'Bulk Reset Complete',
          [
            `Reset **${removed}** linked account${removed !== 1 ? 's' : ''} for members with **@${role.name}**.`,
            silent ? `DMs: silent (not sent)` : `DM failures: ${dmFailed} (members with DMs closed)`,
            ``,
            `Reason: ${reason}`,
            ``,
            `Affected members will need to run \`/link\` to re-verify.`,
          ].join('\n'),
        ),
      ],
    });
  },
};

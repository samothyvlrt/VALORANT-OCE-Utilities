/**
 * /resetlink — invalidate a member's link and force re-verification (was: /admin link reset).
 * Minimum tier: Senior Moderator.
 */
const { SlashCommandBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { requireTier, LEVELS } = require('../../utils/permissions');
const { scheduleLeaderboardRegen } = require('../../utils/generate-leaderboard');
const { logAdminAction } = require('../../utils/activity-log');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('resetlink')
    .setDescription("Staff: invalidate a member's link and require them to re-verify.")
    .setDefaultMemberPermissions('0')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Discord member').setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName('reason').setDescription('Reason shown to the user (optional)').setRequired(false),
    )
    .addBooleanOption((opt) =>
      opt.setName('silent').setDescription('If true, the user will NOT be sent a DM (default: false)').setRequired(false),
    ),

  async execute(interaction) {
    if (!(await requireTier(interaction, LEVELS.SNR_MOD))) return;

    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'Season reset / admin request';
    const silent = interaction.options.getBoolean('silent') ?? false;
    const link   = db.getLinkByDiscord(target.id);

    if (!link) {
      return interaction.editReply({
        embeds: [embed.warning('No Link', `<@${target.id}> has no linked Riot account to reset.`)],
      });
    }

    db.removeLink(target.id);
    scheduleLeaderboardRegen();
    db.audit({
      action: 'ADMIN_LINK_RESET',
      targetDiscordId: target.id,
      targetRiotId: `${link.riot_name}#${link.riot_tag}`,
      performedBy: interaction.user.id,
      guildId: interaction.guildId,
      details: { reason },
    });

    if (!silent) {
      try {
        const dmChannel = await target.createDM();
        await dmChannel.send({
          embeds: [
            embed.warning(
              'Account Re-Verification Required',
              [
                `Your linked Riot account (**${link.riot_name}#${link.riot_tag}**) has been reset by a moderator in a server you share with this bot.`,
                ``,
                `**Reason:** ${reason}`,
                ``,
                `Please run \`/link\` again to re-link and verify your account.`,
              ].join('\n'),
            ),
          ],
        });
      } catch { /* DMs may be closed — silently continue */ }
    }

    logAdminAction(interaction.client, {
      action:    'Link Reset',
      moderator: interaction.user,
      target:    `<@${target.id}>`,
      fields:    { 'Riot ID': `${link.riot_name}#${link.riot_tag}`, Reason: reason, Silent: silent ? 'Yes' : 'No' },
      guildId:   interaction.guildId,
    });

    await interaction.editReply({
      embeds: [
        embed.success(
          'Link Reset',
          `Reset link for <@${target.id}> (**${link.riot_name}#${link.riot_tag}**).\nThey will need to re-run \`/link\` to reverify.\nReason: ${reason}`,
        ),
      ],
    });
  },
};

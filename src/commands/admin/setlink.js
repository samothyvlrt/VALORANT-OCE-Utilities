/**
 * /setlink — force-set a member's linked Riot account, bypassing verification (was: /admin link set).
 * Minimum tier: Senior Admin.
 */
const { SlashCommandBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { adminForceLink, VerificationError } = require('../../modules/verification');
const { getRank, RiotApiError } = require('../../modules/riot-api');
const { requireTier, LEVELS } = require('../../utils/permissions');
const { logAdminAction } = require('../../utils/activity-log');
const { assignRankRole } = require('../../utils/roles');
const config = require('../../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setlink')
    .setDescription("Staff: force-set a member's linked Riot account (bypasses verification).")
    .setDefaultMemberPermissions('0')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Discord member').setRequired(true),
    )
    .addStringOption((opt) =>
      opt.setName('riot_id').setDescription('Riot ID e.g. Aceship#OCE').setRequired(true),
    )
    .addBooleanOption((opt) =>
      opt.setName('silent').setDescription('If true, the user will NOT be sent a DM (default: false)').setRequired(false),
    ),

  async execute(interaction) {
    if (!(await requireTier(interaction, LEVELS.SNR_ADMIN))) return;

    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser('user');
    const riotId = interaction.options.getString('riot_id');
    const region = config.riot.defaultRegion;
    const silent = interaction.options.getBoolean('silent') ?? false;

    try {
      const result = await adminForceLink(target.id, riotId, region, interaction.user.id, interaction.guildId);

      if (!silent) {
        try {
          const dm = await target.createDM();
          await dm.send({
            embeds: [
              embed.info(
                'Riot Account Linked by Admin',
                [
                  `A moderator has linked your Discord account to **${result.riotName}#${result.riotTag}** (${result.region.toUpperCase()}).`,
                  ``,
                  `If this is incorrect, please contact a moderator.`,
                ].join('\n'),
              ),
            ],
          });
        } catch { /* DMs closed — silently continue */ }
      }

      logAdminAction(interaction.client, {
        action:    'Link Set',
        moderator: interaction.user,
        target:    `<@${target.id}>`,
        fields:    { 'Riot ID': `${result.riotName}#${result.riotTag}`, Region: result.region.toUpperCase(), Silent: silent ? 'Yes' : 'No' },
        guildId:   interaction.guildId,
      });

      // Immediately fetch and cache rank so leaderboard reflects the new account
      let rankStr = 'Unranked';
      try {
        const rank = await getRank(result.riotName, result.riotTag, result.region);
        if (rank) {
          db.updateRankCache(target.id, rank);
          rankStr = rank.tier > 0 ? `${rank.tierName} — ${rank.rr} RR` : 'Unranked';
          try {
            const guild  = interaction.guild ?? await interaction.client.guilds.fetch(config.discord.guildId);
            const member = await guild.members.fetch(target.id);
            await assignRankRole(member, rank.tier);
          } catch { /* member may not be in guild */ }
        }
      } catch { /* rank fetch failed — non-fatal */ }

      await interaction.editReply({
        embeds: [
          embed.success(
            'Link Set',
            `<@${target.id}> is now linked to **${result.riotName}#${result.riotTag}** (${result.region.toUpperCase()}).\nRank: ${rankStr}\n\nThis was set without an ownership challenge.`,
          ),
        ],
      });
    } catch (err) {
      if (err instanceof VerificationError || err instanceof RiotApiError) {
        return interaction.editReply({ embeds: [embed.error('Failed', err.message)] });
      }
      console.error('[setlink]', err);
      interaction.editReply({ embeds: [embed.error('Unexpected Error', 'Something went wrong.')] });
    }
  },
};

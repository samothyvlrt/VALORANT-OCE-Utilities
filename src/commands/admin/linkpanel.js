/**
 * /linkpanel — post the account-link panel embed in this channel (was: /admin link panel).
 * Minimum tier: Senior Admin.
 */
const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { requireTier, LEVELS } = require('../../utils/permissions');
const config = require('../../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('linkpanel')
    .setDescription('Staff: post the account link panel embed in this channel.')
    .setDefaultMemberPermissions('0'),

  async execute(interaction) {
    if (!(await requireTier(interaction, LEVELS.SNR_ADMIN))) return;

    const panelEmbed = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle('Rank Roles')
      .setDescription(
        [
          'Link your Riot account to receive an automatic rank role.',
          '',
          '`/link` — Link or re-link your Valorant account',
          '`/profile` — View your rank and stats',
          '`/leaderboard` — See where you rank in the server',
          '`/privacy` — Hide or show yourself on the leaderboard',
          '`/unlink` — Remove your linked account',
        ].join('\n'),
      )
      .setFooter({ text: 'Valorant OCE Utilities' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('link_btn')
        .setLabel('Link')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔗'),
      new ButtonBuilder()
        .setCustomId('update_rank_btn')
        .setLabel('Update Rank')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄'),
      new ButtonBuilder()
        .setCustomId('unlink_btn')
        .setLabel('Unlink')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔓'),
    );

    await interaction.channel.send({ embeds: [panelEmbed], components: [row] });

    await interaction.reply({ content: '✅ Panel posted.', ephemeral: true });
  },
};

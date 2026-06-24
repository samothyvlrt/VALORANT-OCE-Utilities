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
      .setTitle('🎖️ Rank Role System')
      .setDescription(
        [
          'Welcome to the **Rank Role system!** By verifying your Riot account, we can automatically assign you a role based on your **VALORANT** rank.',
          '',
          '**🔗 Add** — To get started, use the **Add** button below. This directs you to a login page to connect your Riot account.',
          '**🔄 Update** — Refreshes your role to match your current rank, e.g. you\'ve been promoted in-game and it hasn\'t reflected on your rank role yet.',
          '**🗑️ Remove** — Removes your rank role.',
        ].join('\n'),
      )
      .addFields({
        name: 'Other commands',
        value: [
          '`/profile` — View your rank, stats, and linked account',
          '`/leaderboard` — Server rankings with a live rank-distribution chart',
          '`/privacy` — Hide or show yourself on the public leaderboard',
          '`/match` — View your most recent match stats',
          '`/verify` — Manual fallback if the login redirect doesn\'t trigger',
        ].join('\n'),
      })
      .setFooter({ text: 'Valorant OCE Utilities' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('link_btn')
        .setLabel('Add')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔗'),
      new ButtonBuilder()
        .setCustomId('update_rank_btn')
        .setLabel('Update')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔄'),
      new ButtonBuilder()
        .setCustomId('unlink_btn')
        .setLabel('Remove')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️'),
    );

    await interaction.channel.send({ embeds: [panelEmbed], components: [row] });

    await interaction.reply({ content: '✅ Panel posted.', ephemeral: true });
  },
};

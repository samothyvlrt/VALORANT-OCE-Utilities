/**
 * /logsetup — set the staff activity log channel (was: /admin log setup).
 * Minimum tier: Senior Admin.
 */
const { SlashCommandBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { requireTier, LEVELS } = require('../../utils/permissions');
const { logAdminAction } = require('../../utils/activity-log');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('logsetup')
    .setDescription('Staff: set the channel for staff activity logs.')
    .setDefaultMemberPermissions('0')
    .addChannelOption((opt) =>
      opt.setName('channel').setDescription('Channel to post logs in').setRequired(true),
    ),

  async execute(interaction) {
    if (!(await requireTier(interaction, LEVELS.SNR_ADMIN))) return;

    const channel = interaction.options.getChannel('channel');
    db.setSetting('log_channel_id', channel.id);

    logAdminAction(interaction.client, {
      action:    'Log Channel Set',
      moderator: interaction.user,
      fields:    { Channel: `<#${channel.id}>` },
      guildId:   interaction.guildId,
    });

    return interaction.reply({
      embeds: [embed.success('Log Channel Set', `Staff activity logs will now be posted in <#${channel.id}>.\nRe-run this command to change the channel at any time.`)],
      ephemeral: true,
    });
  },
};

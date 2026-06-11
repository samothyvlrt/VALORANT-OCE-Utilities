const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { isAdmin } = require('../../utils/permissions');
const config = require('../../../config');

const ACTION_LABELS = {
  LINK_CREATE: '🔗 Linked',
  LINK_REMOVE: '🗑️ Self-unlinked',
  ADMIN_LINK_SET: '🛡️ Admin set',
  ADMIN_LINK_REMOVE: '🛡️ Admin removed',
  ADMIN_LINK_RESET: '🔄 Admin reset',
  ADMIN_BULK_RESET: '⚡ Bulk reset',
  ADMIN_EXPORT: '📤 Export',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('audit')
    .setDescription('View recent link/unlink activity in this server.')
    .addIntegerOption((opt) =>
      opt.setName('limit').setDescription('Number of entries to show (max 50, default 25)').setRequired(false).setMinValue(1).setMaxValue(50),
    ),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({
        embeds: [embed.error('Access Denied', 'Administrator permissions required.')],
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const limit = interaction.options.getInteger('limit') || 25;
    const entries = db.getAuditLog(interaction.guildId, limit);

    if (!entries.length) {
      return interaction.editReply({
        embeds: [embed.info('No Audit Entries', 'No activity recorded for this server yet.')],
      });
    }

    const rows = entries.map((entry) => {
      const label = ACTION_LABELS[entry.action] || entry.action;
      const ts = `<t:${Math.floor(entry.timestamp / 1000)}:R>`;
      const who = entry.performed_by ? `<@${entry.performed_by}>` : 'system';
      const target = entry.target_discord_id ? `<@${entry.target_discord_id}>` : '';
      const riot = entry.target_riot_id ? `**${entry.target_riot_id}**` : '';
      return `${ts} ${label} ${[target, riot].filter(Boolean).join(' → ')} by ${who}`;
    });

    const e = new EmbedBuilder()
      .setColor(config.colors.neutral)
      .setTitle(`Audit Log — ${interaction.guild.name}`)
      .setDescription(rows.join('\n'))
      .setFooter({ text: `Last ${entries.length} entries` })
      .setTimestamp();

    await interaction.editReply({ embeds: [e] });
  },
};

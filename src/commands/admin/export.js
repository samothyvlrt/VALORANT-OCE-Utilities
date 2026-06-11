const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { isAdmin } = require('../../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('export')
    .setDescription('Export all linked accounts in this server as a CSV file.')
    .addRoleOption((opt) =>
      opt.setName('role').setDescription('Optionally filter by role').setRequired(false),
    ),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({
        embeds: [embed.error('Access Denied', 'Administrator permissions required.')],
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const role = interaction.options.getRole('role');

    // Fetch guild members
    try {
      await interaction.guild.members.fetch();
    } catch {
      return interaction.editReply({ embeds: [embed.error('Failed', 'Could not fetch guild members.')] });
    }

    let members = interaction.guild.members.cache;
    if (role) {
      members = members.filter((m) => m.roles.cache.has(role.id));
    }

    const discordIds = members.map((m) => m.id);
    const links = db.getLinksByDiscordIds(discordIds);

    if (!links.length) {
      return interaction.editReply({
        embeds: [embed.info('No Data', 'No linked accounts found for the selected scope.')],
      });
    }

    // Build CSV
    const header = 'discord_id,discord_username,riot_name,riot_tag,riot_id,region,riot_puuid,linked_at_utc,last_updated_utc';
    const rows = links.map((l) => {
      const member = members.get(l.discord_id);
      const discordName = member
        ? `${member.user.username}`.replace(/,/g, '') // strip commas for CSV safety
        : 'unknown';
      const linkedDate = new Date(l.linked_at).toISOString();
      const updatedDate = new Date(l.last_updated).toISOString();
      return [
        l.discord_id,
        discordName,
        l.riot_name.replace(/,/g, ''),
        l.riot_tag,
        `${l.riot_name}#${l.riot_tag}`,
        l.region.toUpperCase(),
        l.riot_puuid,
        linkedDate,
        updatedDate,
      ].join(',');
    });

    const csv = [header, ...rows].join('\n');
    const buffer = Buffer.from(csv, 'utf-8');
    const fileName = `linked-accounts-${interaction.guild.id}-${Date.now()}.csv`;

    const attachment = new AttachmentBuilder(buffer, { name: fileName });

    db.audit({
      action: 'ADMIN_EXPORT',
      performedBy: interaction.user.id,
      guildId: interaction.guildId,
      details: { count: links.length, role: role?.id ?? null },
    });

    await interaction.editReply({
      embeds: [
        embed.success(
          'Export Ready',
          `**${links.length}** linked account${links.length !== 1 ? 's' : ''} exported${role ? ` for @${role.name}` : ''}.`,
        ),
      ],
      files: [attachment],
    });
  },
};

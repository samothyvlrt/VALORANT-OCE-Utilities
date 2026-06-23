/**
 * /exportlinks — CSV export of linked accounts (was: /admin export).
 * Minimum tier: Admin.
 */
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { requireTier, LEVELS } = require('../../utils/permissions');
const { logAdminAction } = require('../../utils/activity-log');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('exportlinks')
    .setDescription('Staff: export all linked accounts as a CSV file.')
    .setDefaultMemberPermissions('0')
    .addRoleOption((opt) =>
      opt.setName('role').setDescription('Optionally filter by role').setRequired(false),
    ),

  async execute(interaction) {
    if (!(await requireTier(interaction, LEVELS.ADMIN))) return;

    await interaction.deferReply({ ephemeral: true });

    const role = interaction.options.getRole('role');

    try {
      await interaction.guild.members.fetch();
    } catch {
      return interaction.editReply({ embeds: [embed.error('Failed', 'Could not fetch guild members.')] });
    }

    let members = interaction.guild.members.cache;
    if (role) members = members.filter((m) => m.roles.cache.has(role.id));

    const discordIds = members.map((m) => m.id);
    const links = db.getLinksByDiscordIds(discordIds);

    if (!links.length) {
      return interaction.editReply({
        embeds: [embed.info('No Data', 'No linked accounts found for the selected scope.')],
      });
    }

    const header = 'discord_id,discord_username,riot_name,riot_tag,riot_id,region,riot_puuid,linked_at_utc,last_updated_utc';
    const rows = links.map((l) => {
      const member      = members.get(l.discord_id);
      const discordName = member ? member.user.username.replace(/,/g, '') : 'unknown';
      return [
        l.discord_id,
        discordName,
        l.riot_name.replace(/,/g, ''),
        l.riot_tag,
        `${l.riot_name}#${l.riot_tag}`,
        l.region.toUpperCase(),
        l.riot_puuid,
        new Date(l.linked_at).toISOString(),
        new Date(l.last_updated).toISOString(),
      ].join(',');
    });

    const csv      = [header, ...rows].join('\n');
    const fileName = `linked-accounts-${interaction.guild.id}-${Date.now()}.csv`;

    db.audit({
      action:      'ADMIN_EXPORT',
      performedBy: interaction.user.id,
      guildId:     interaction.guildId,
      details:     { count: links.length, role: role?.id ?? null },
    });

    logAdminAction(interaction.client, {
      action:    'Export',
      moderator: interaction.user,
      fields:    { Accounts: links.length, Role: role ? `@${role.name}` : 'All' },
      guildId:   interaction.guildId,
    });

    await interaction.editReply({
      embeds: [
        embed.success(
          'Export Ready',
          `**${links.length}** linked account${links.length !== 1 ? 's' : ''} exported${role ? ` for @${role.name}` : ''}.`,
        ),
      ],
      files: [new AttachmentBuilder(Buffer.from(csv, 'utf-8'), { name: fileName })],
    });
  },
};

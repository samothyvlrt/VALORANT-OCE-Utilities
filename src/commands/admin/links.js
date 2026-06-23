/**
 * /links — list linked members, optionally filtered by role (was: /admin link list).
 * Minimum tier: Moderator.
 */
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { requireTier, LEVELS } = require('../../utils/permissions');
const config = require('../../../config');

const ITEMS_PER_PAGE = 20;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('links')
    .setDescription('Staff: list all linked members, optionally filtered by role.')
    .setDefaultMemberPermissions('0')
    .addRoleOption((opt) =>
      opt.setName('role').setDescription('Filter by role (optional)').setRequired(false),
    )
    .addIntegerOption((opt) =>
      opt.setName('page').setDescription('Page number (default: 1)').setRequired(false).setMinValue(1),
    ),

  async execute(interaction) {
    if (!(await requireTier(interaction, LEVELS.MOD))) return;

    await interaction.deferReply({ ephemeral: true });

    const role = interaction.options.getRole('role');
    const page = (interaction.options.getInteger('page') || 1) - 1; // 0-indexed

    let members;
    try {
      await interaction.guild.members.fetch();
      members = interaction.guild.members.cache;
    } catch {
      return interaction.editReply({ embeds: [embed.error('Failed', 'Could not fetch guild members.')] });
    }

    const targetMembers = role
      ? members.filter((m) => m.roles.cache.has(role.id))
      : members;

    const discordIds = targetMembers.map((m) => m.id);
    const links = db.getLinksByDiscordIds(discordIds);

    if (!links.length) {
      return interaction.editReply({
        embeds: [embed.info('No Links', role ? `No linked accounts found for **@${role.name}**.` : 'No linked accounts found in this server.')],
      });
    }

    const totalPages = Math.ceil(links.length / ITEMS_PER_PAGE);
    const pageLinks = links.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

    const rows = pageLinks.map((l, i) => {
      const num    = page * ITEMS_PER_PAGE + i + 1;
      const hidden = l.hidden ? ' 🙈' : '';
      return `\`${String(num).padStart(3)}\` <@${l.discord_id}> — **${l.riot_name}#${l.riot_tag}** (${l.region.toUpperCase()})${hidden}`;
    });

    const e = new EmbedBuilder()
      .setColor(config.colors.info)
      .setTitle(`Linked Accounts${role ? ` — @${role.name}` : ''}`)
      .setDescription(rows.join('\n'))
      .setFooter({ text: `Page ${page + 1}/${totalPages} · ${links.length} total linked` })
      .setTimestamp();

    await interaction.editReply({ embeds: [e] });
  },
};

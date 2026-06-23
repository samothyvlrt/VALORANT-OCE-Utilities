/**
 * /lookup — look up a member's linked Riot account (was: /admin link get).
 * Minimum tier: Moderator.
 */
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { requireTier, LEVELS } = require('../../utils/permissions');
const config = require('../../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lookup')
    .setDescription("Staff: look up a link by Discord member or Riot ID.")
    .setDefaultMemberPermissions('0')
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Discord member').setRequired(false),
    )
    .addStringOption((opt) =>
      opt.setName('riot_id').setDescription('Riot ID e.g. Aceship#OCE').setRequired(false),
    ),

  async execute(interaction) {
    if (!(await requireTier(interaction, LEVELS.MOD))) return;

    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser('user');
    const riotId = interaction.options.getString('riot_id');

    if (!target && !riotId) {
      return interaction.editReply({
        embeds: [embed.error('Missing input', 'Provide either a Discord user or a Riot ID.')],
      });
    }
    if (target && riotId) {
      return interaction.editReply({
        embeds: [embed.error('Too many inputs', 'Provide either a Discord user or a Riot ID, not both.')],
      });
    }

    let link;
    if (target) {
      link = db.getLinkByDiscord(target.id);
      if (!link) {
        return interaction.editReply({
          embeds: [embed.warning('No Link', `<@${target.id}> has no linked Riot account.`)],
        });
      }
    } else {
      const { parseRiotId } = require('../../modules/riot-api');
      let parsed;
      try { parsed = parseRiotId(riotId); } catch {
        return interaction.editReply({ embeds: [embed.error('Invalid Riot ID', 'Format must be `Name#Tag`.')] });
      }
      link = db.getLinkByRiotId(parsed.name, parsed.tag);
      if (!link) {
        return interaction.editReply({
          embeds: [embed.warning('No Link', `**${riotId}** is not linked to any Discord account.`)],
        });
      }
    }

    const history = db.getLinkHistory(link.discord_id);

    let historyValue = '*No history recorded*';
    if (history.length) {
      historyValue = history.map((row) => {
        const details = row.details ? JSON.parse(row.details) : {};
        const puuid   = details.puuid ?? '—';
        const label   = row.action === 'ADMIN_LINK_SET' ? ' *(admin set)*' : '';
        return `**${row.target_riot_id}**${label} · <t:${Math.floor(row.timestamp / 1000)}:f>\n\`${puuid}\``;
      }).join('\n');
    }

    const e = new EmbedBuilder()
      .setColor(config.colors.info)
      .setTitle(`Link info — ${link.riot_name}#${link.riot_tag}`)
      .setFooter({ text: 'Valorant OCE Utilities' })
      .setTimestamp()
      .addFields(
        { name: 'Discord',      value: `<@${link.discord_id}> (${link.discord_id})`, inline: false },
        { name: 'Riot ID',      value: `${link.riot_name}#${link.riot_tag}`,         inline: true  },
        { name: 'Region',       value: link.region.toUpperCase(),                    inline: true  },
        { name: 'PUUID',        value: `\`${link.riot_puuid}\``,                     inline: false },
        { name: 'Linked',       value: `<t:${Math.floor(link.linked_at    / 1000)}:F>`, inline: true },
        { name: 'Last Updated', value: `<t:${Math.floor(link.last_updated / 1000)}:R>`, inline: true },
        { name: 'Link History (last 5)', value: historyValue, inline: false },
      );

    await interaction.editReply({ embeds: [e] });
  },
};

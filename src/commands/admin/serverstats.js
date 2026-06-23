/**
 * /serverstats — member count, link rate, rank distribution (was: /admin stats).
 * Minimum tier: Admin.
 */
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { requireTier, LEVELS } = require('../../utils/permissions');
const { tierToRoleKey } = require('../../utils/roles');
const config = require('../../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('serverstats')
    .setDescription('Staff: server stats — member count, links, and rank distribution.')
    .setDefaultMemberPermissions('0'),

  async execute(interaction) {
    if (!(await requireTier(interaction, LEVELS.ADMIN))) return;

    await interaction.deferReply({ ephemeral: false });

    const totalMembers = interaction.guild.memberCount;
    const totalLinked  = db.countLinks();
    const linkRate     = totalMembers > 0 ? ((totalLinked / totalMembers) * 100).toFixed(1) : '0.0';

    const rankOrder = ['radiant', 'immortal', 'ascendant', 'diamond', 'platinum', 'gold', 'silver', 'bronze', 'iron', 'unranked'];
    const rankEmoji = { radiant: '🟡', immortal: '🔴', ascendant: '🟢', diamond: '🔵', platinum: '🩵', gold: '🟠', silver: '⚪', bronze: '🟤', iron: '⬛', unranked: '❓' };
    const counts = Object.fromEntries(rankOrder.map((k) => [k, 0]));
    let uncached = 0;

    const links = db.getAllLinks();
    let hiddenCount = 0;
    for (const link of links) {
      if (link.hidden) { hiddenCount++; }
      if (!link.cached_rank) { uncached++; continue; }
      try {
        const rank = JSON.parse(link.cached_rank);
        const key  = tierToRoleKey(rank.tier ?? 0);
        counts[key]++;
      } catch { uncached++; }
    }

    const distLines = rankOrder
      .filter((k) => counts[k] > 0)
      .map((k) => `${rankEmoji[k]} **${k.charAt(0).toUpperCase() + k.slice(1)}** — ${counts[k]}`);

    if (uncached > 0) distLines.push(`❔ **Not yet cached** — ${uncached}`);
    if (hiddenCount > 0) distLines.push(`🙈 **Hidden from leaderboard** — ${hiddenCount}`);

    const e = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle('📊 Server Stats')
      .setFooter({ text: 'Valorant OCE Utilities · Rank data based on last cached fetch' })
      .setTimestamp()
      .addFields(
        { name: 'Total Members',    value: totalMembers.toLocaleString(), inline: true },
        { name: 'Linked Accounts',  value: `${totalLinked.toLocaleString()} (${linkRate}%)`, inline: true },
        { name: '​',           value: '​', inline: true },
        { name: 'Rank Distribution', value: distLines.length ? distLines.join('\n') : 'No cached rank data yet', inline: false },
      );

    await interaction.editReply({ embeds: [e] });
  },
};

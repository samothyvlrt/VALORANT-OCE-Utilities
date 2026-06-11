const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { getRank } = require('../../modules/riot-api');
const config = require('../../../config');

const RANK_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

// Convert HenrikDev season codes like "e9a3" → "Episode 9 Act 3"
function formatSeason(season) {
  if (!season) return null;
  const match = season.match(/^e(\d+)a(\d+)$/i);
  if (match) return `Ep ${match[1]} Act ${match[2]}`;
  return season.toUpperCase();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View a linked Riot account profile.')
    .addUserOption((opt) =>
      opt
        .setName('user')
        .setDescription('Discord user to look up (defaults to yourself)')
        .setRequired(false),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: false });

    const target = interaction.options.getUser('user') || interaction.user;
    const link   = db.getLinkByDiscord(target.id);

    if (!link) {
      const isSelf = target.id === interaction.user.id;
      return interaction.editReply({
        embeds: [
          embed.warning(
            'No Account Linked',
            isSelf
              ? "You haven't linked a Riot account yet. Use `/link` to get started."
              : `<@${target.id}> hasn't linked a Riot account.`,
          ),
        ],
      });
    }

    // Use cached rank if fresh, otherwise fetch and update cache
    let rank = null;
    const cacheAge = link.rank_cached_at ? Date.now() - link.rank_cached_at : Infinity;
    if (cacheAge < RANK_CACHE_TTL_MS && link.cached_rank) {
      try { rank = JSON.parse(link.cached_rank); } catch { /* ignore corrupt cache */ }
    }
    if (!rank) {
      rank = await getRank(link.riot_name, link.riot_tag, link.region).catch(() => null);
      if (rank) db.updateRankCache(link.discord_id, rank);
    }

    // ── Current rank string ─────────────────────────────────────────────────
    let rankValue = 'Unranked / unavailable';
    if (rank && rank.tier > 0) {
      rankValue = `**${rank.tierName}** — ${rank.rr} RR`;
      if (rank.leaderboardRank) rankValue += ` (#${rank.leaderboardRank})`;
    }

    // ── Peak rank string ────────────────────────────────────────────────────
    let peakValue = '—';
    if (rank?.peakTierName) {
      peakValue = `**${rank.peakTierName}**`;
      const season = formatSeason(rank.peakSeason);
      if (season) peakValue += ` (${season})`;
    }

    const e = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle(`${link.riot_name}#${link.riot_tag}`)
      .setFooter({ text: 'VALORANT OCE Utilities' })
      .setTimestamp()
      .addFields(
        { name: 'Discord',      value: `<@${link.discord_id}>`,                          inline: true },
        { name: 'Region',       value: link.region.toUpperCase(),                         inline: true },
        { name: '​',       value: '​',                                          inline: true },
        { name: 'Current Rank', value: rankValue,                                         inline: true },
        { name: 'Peak Rank',    value: peakValue,                                         inline: true },
        { name: '​',       value: '​',                                          inline: true },
        { name: 'Linked',       value: `<t:${Math.floor(link.linked_at   / 1000)}:R>`,   inline: true },
        { name: 'Last Updated', value: `<t:${Math.floor(link.last_updated / 1000)}:R>`,  inline: true },
      );

    // Current rank icon → thumbnail (top right)
    if (rank?.smallIcon) {
      e.setThumbnail(rank.smallIcon);
    }

    // Peak rank icon → author area (top left, small icon)
    if (rank?.peakSmallIcon && rank?.peakTierName) {
      e.setAuthor({
        name:    `Peak: ${rank.peakTierName}${formatSeason(rank.peakSeason) ? ` · ${formatSeason(rank.peakSeason)}` : ''}`,
        iconURL: rank.peakSmallIcon,
      });
    }

    await interaction.editReply({ embeds: [e] });
  },
};

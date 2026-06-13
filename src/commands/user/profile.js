const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { getRank, getPlayerStats } = require('../../modules/riot-api');
const config = require('../../../config');

const RANK_CACHE_TTL_MS  = 2 * 60 * 1000; // 2 minutes
const STATS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
    await interaction.deferReply({ ephemeral: true });

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

    // ── Rank cache ──────────────────────────────────────────────────────────
    let rank = null;
    const rankAge = link.rank_cached_at ? Date.now() - link.rank_cached_at : Infinity;
    if (rankAge < RANK_CACHE_TTL_MS && link.cached_rank) {
      try { rank = JSON.parse(link.cached_rank); } catch { /* corrupt cache */ }
    }
    if (!rank) {
      rank = await getRank(link.riot_name, link.riot_tag, link.region).catch(() => null);
      if (rank) db.updateRankCache(link.discord_id, rank);
    }

    // ── Stats cache ─────────────────────────────────────────────────────────
    let stats = null;
    const statsAge = link.stats_cached_at ? Date.now() - link.stats_cached_at : Infinity;
    if (statsAge < STATS_CACHE_TTL_MS && link.cached_stats) {
      try { stats = JSON.parse(link.cached_stats); } catch { /* corrupt cache */ }
    }
    if (!stats) {
      stats = await getPlayerStats(link.riot_puuid, link.region).catch(() => null);
      if (stats) db.updateStatsCache(link.discord_id, stats);
    }

    // ── Rank strings ────────────────────────────────────────────────────────
    let rankValue = 'Unranked / unavailable';
    if (rank && rank.tier > 0) {
      rankValue = `**${rank.tierName}** — ${rank.rr} RR`;
      if (rank.leaderboardRank) rankValue += ` (#${rank.leaderboardRank})`;
    }

    let peakValue = '—';
    if (rank?.peakTierName) {
      peakValue = `**${rank.peakTierName}**`;
      const season = formatSeason(rank.peakSeason);
      if (season) peakValue += ` (${season})`;
    }

    // ── Stats strings ───────────────────────────────────────────────────────
    const kdValue  = stats ? `**${stats.kd}**` : '—';
    const wrValue  = stats ? `**${stats.winRate}%** (${stats.wins}/${stats.totalMatches})` : '—';

    let agentsValue = '—';
    if (stats?.topAgents?.length) {
      agentsValue = stats.topAgents
        .map((a, i) => `${i + 1}. **${a.name}** — ${a.winRate}% WR (${a.games}g)`)
        .join('\n');
    }

    // ── Build embed ─────────────────────────────────────────────────────────
    const e = new EmbedBuilder()
      .setColor(config.colors.primary)
      .setTitle(`${link.riot_name}#${link.riot_tag}`)
      .setFooter({ text: 'Valorant OCE Utilities · Last 20 matches' })
      .setTimestamp()
      .addFields(
        { name: 'Discord',       value: `<@${link.discord_id}>`,                         inline: true },
        { name: 'Region',        value: link.region.toUpperCase(),                        inline: true },
        { name: '​',        value: '​',                                         inline: true },
        { name: 'Current Rank',  value: rankValue,                                        inline: true },
        { name: 'Peak Rank',     value: peakValue,                                        inline: true },
        { name: '​',        value: '​',                                         inline: true },
        { name: 'K/D',           value: kdValue,                                          inline: true },
        { name: 'Win Rate',      value: wrValue,                                          inline: true },
        { name: '​',        value: '​',                                         inline: true },
        { name: 'Top Agents',    value: agentsValue,                                      inline: false },
        { name: 'Linked',        value: `<t:${Math.floor(link.linked_at    / 1000)}:R>`, inline: true },
        { name: 'Last Updated',  value: `<t:${Math.floor(link.last_updated / 1000)}:R>`, inline: true },
      );

    if (rank?.smallIcon)    e.setThumbnail(rank.smallIcon);
    if (rank?.peakSmallIcon && rank?.peakTierName) {
      e.setAuthor({
        name:    `Peak: ${rank.peakTierName}${formatSeason(rank.peakSeason) ? ` · ${formatSeason(rank.peakSeason)}` : ''}`,
        iconURL: rank.peakSmallIcon,
      });
    }

    await interaction.editReply({ embeds: [e] });
  },
};

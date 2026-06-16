const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { getRank, getPlayerStats } = require('../../modules/riot-api');
const config = require('../../../config');

const RANK_CACHE_TTL_MS  = 2 * 60 * 1000; // 2 minutes
const STATS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Build a Unicode block-character sparkline from rank history.
 * Returns a string like "▁▃▅▆▇▇█  Iron 2 → Diamond 3 (30 days)" or null if too few points.
 */
function buildSparkline(history) {
  if (!history || history.length < 2) return null;

  const CHARS  = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const values = history.map((h) => h.tier * 100 + h.rr);
  const min    = Math.min(...values);
  const max    = Math.max(...values);
  const range  = max - min || 1;
  const bars   = values.map((v) =>
    CHARS[Math.round(((v - min) / range) * (CHARS.length - 1))],
  );

  const first  = history[0];
  const last   = history[history.length - 1];
  const days   = Math.round((last.recorded_at - first.recorded_at) / (86400 * 1000));
  const span   = days >= 1 ? ` (${days}d)` : '';

  const changed = first.tier_name !== last.tier_name
    ? `${first.tier_name} → ${last.tier_name}`
    : last.tier_name;

  return `${bars.join('')}\n${changed}${span}`;
}

function formatSeason(season) {
  if (!season) return null;
  const match = season.match(/^e(\d+)a(\d+)$/i);
  if (match) return `Ep ${match[1]} Act ${match[2]}`;
  return season.toUpperCase();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View your linked Riot account profile.')
    .addBooleanOption((opt) =>
      opt
        .setName('public')
        .setDescription('Show your profile publicly in this channel (default: only you can see it)')
        .setRequired(false),
    ),

  async execute(interaction) {
    const isPublic = interaction.options.getBoolean('public') ?? false;
    await interaction.deferReply({ ephemeral: !isPublic });

    const link = db.getLinkByDiscord(interaction.user.id);

    if (!link) {
      return interaction.editReply({
        embeds: [
          embed.warning(
            'No Account Linked',
            "You haven't linked a Riot account yet. Use `/link` to get started.",
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
      if (rank) db.updateRankCache(interaction.user.id, rank);
    }

    // ── Stats cache ─────────────────────────────────────────────────────────
    let stats = null;
    const statsAge = link.stats_cached_at ? Date.now() - link.stats_cached_at : Infinity;
    if (statsAge < STATS_CACHE_TTL_MS && link.cached_stats) {
      try { stats = JSON.parse(link.cached_stats); } catch { /* corrupt cache */ }
    }
    if (!stats) {
      stats = await getPlayerStats(link.riot_puuid, link.region).catch(() => null);
      if (stats) db.updateStatsCache(interaction.user.id, stats);
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

    // ── Rank history sparkline ──────────────────────────────────────────────
    const history   = db.getRankHistory(link.discord_id, 20);
    const sparkline = buildSparkline(history);

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
        { name: 'Current Rank',  value: rankValue,                                        inline: true },
        { name: 'Peak Rank',     value: peakValue,                                        inline: true },
        { name: '​',        value: '​',                                         inline: true },
        { name: 'K/D',           value: kdValue,                                          inline: true },
        { name: 'Win Rate',      value: wrValue,                                          inline: true },
        { name: '​',        value: '​',                                         inline: true },
        ...(sparkline ? [{ name: 'Rank Trend', value: sparkline, inline: false }] : []),
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

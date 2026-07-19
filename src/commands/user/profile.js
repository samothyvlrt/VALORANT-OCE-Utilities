const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { getRank, getPlayerStats, getMmrHistory } = require('../../modules/riot-api');
const config = require('../../../config');
const { scheduleLeaderboardRegen } = require('../../utils/generate-leaderboard');
const { generateRrGraph } = require('../../utils/rr-graph');

const RANK_CACHE_TTL_MS  = 2 * 60 * 1000; // 2 minutes
const STATS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * One-line trend summary shown above the RR graph,
 * e.g. "Iron 2 → Diamond 3 (30d · 14 changes)".
 */
function buildTrendSummary(history) {
  const first = history[0];
  const last  = history[history.length - 1];
  const days  = Math.round((last.recorded_at - first.recorded_at) / (86400 * 1000));
  const span  = days >= 1 ? `${days}d · ` : '';

  const changed = first.tier_name !== last.tier_name
    ? `${first.tier_name} → ${last.tier_name}`
    : last.tier_name;

  return `${changed} (${span}${history.length} changes)`;
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
      if (rank) { db.updateRankCache(interaction.user.id, rank); scheduleLeaderboardRegen(); }
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

    // ── Rank history graph ──────────────────────────────────────────────────
    let history = db.getRankHistory(link.discord_id, 40);
    // Fresh link → backfill per-game snapshots from Riot MMR history so the
    // graph shows immediately instead of waiting for the poll loop.
    if (history.length < 2) {
      try {
        const mmr = await getMmrHistory(link.riot_puuid, link.region);
        if (db.backfillRankHistory(link.discord_id, mmr) > 0) {
          history = db.getRankHistory(link.discord_id, 40);
        }
      } catch (err) {
        console.error('[profile] rank history backfill failed:', err.message);
      }
    }
    let graphFile = null;
    if (history.length >= 2) {
      try {
        const buffer = generateRrGraph(history);
        if (buffer) graphFile = new AttachmentBuilder(buffer, { name: 'rr-graph.png' });
      } catch (err) {
        console.error('[profile] RR graph render failed:', err.message);
      }
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
        { name: 'Current Rank',  value: rankValue,                                        inline: true },
        { name: 'Peak Rank',     value: peakValue,                                        inline: true },
        { name: '​',        value: '​',                                         inline: true },
        { name: 'K/D',           value: kdValue,                                          inline: true },
        { name: 'Win Rate',      value: wrValue,                                          inline: true },
        { name: '​',        value: '​',                                         inline: true },
        ...(graphFile ? [{ name: 'Rank Trend', value: buildTrendSummary(history), inline: false }] : []),
        { name: 'Top Agents',    value: agentsValue,                                      inline: false },
        { name: 'Linked',        value: `<t:${Math.floor(link.linked_at    / 1000)}:R>`, inline: true },
        { name: 'Last Updated',  value: `<t:${Math.floor(link.last_updated / 1000)}:R>`, inline: true },
      );

    if (graphFile)          e.setImage('attachment://rr-graph.png');
    if (rank?.smallIcon)    e.setThumbnail(rank.smallIcon);
    if (rank?.peakSmallIcon && rank?.peakTierName) {
      e.setAuthor({
        name:    `Peak: ${rank.peakTierName}${formatSeason(rank.peakSeason) ? ` · ${formatSeason(rank.peakSeason)}` : ''}`,
        iconURL: rank.peakSmallIcon,
      });
    }

    await interaction.editReply({ embeds: [e], files: graphFile ? [graphFile] : [] });
  },
};

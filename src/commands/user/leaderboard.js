const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
} = require('discord.js');
const db     = require('../../modules/database');
const config = require('../../../config');
const { generateRankChart } = require('../../utils/rank-chart');

const PAGE_SIZE = 10;

// ─────────────────────────────────────────────
// Rank tier helpers
// ─────────────────────────────────────────────

function tierColor(tier) {
  if (tier >= 27) return 0xFFD63A; // Radiant
  if (tier >= 24) return 0xBF3136; // Immortal
  if (tier >= 21) return 0x19A97B; // Ascendant
  if (tier >= 18) return 0x6B56C4; // Diamond
  if (tier >= 15) return 0x3AB8B3; // Platinum
  if (tier >= 12) return 0xD4AF51; // Gold
  if (tier >=  9) return 0x8BA7B7; // Silver
  if (tier >=  6) return 0x9E6230; // Bronze
  if (tier >=  3) return 0x594134; // Iron
  return 0x9B9B9B;                  // Unranked
}

function tierEmoji(tier) {
  if (tier >= 27) return '<:radiant:894407558519984209>';
  if (tier >= 26) return '<:immortal3:894407558452899871>';
  if (tier >= 25) return '<:immortal2:862005462580985856>';
  if (tier >= 24) return '<:immortal1:862005437264429056>';
  if (tier >= 21) return '<:ascendant:987673921002303538>';
  if (tier >= 18) return '<:diamond:894407558704553994>';
  if (tier >= 15) return '<:platinum:894407559778295829>';
  if (tier >= 12) return '<:gold:894407558910066758>';
  if (tier >=  9) return '<:silver:894407558427738163>';
  if (tier >=  6) return '<:bronze:894407558129938443>';
  if (tier >=  3) return '<:iron:894407559052656671>';
  return '<:unranked:1067377487153209384>';
}


// ─────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────

function getSortedEntries() {
  const links = db.getAllLinks();
  return links
    .map((link) => {
      let rank = null;
      if (link.cached_rank) {
        try { rank = JSON.parse(link.cached_rank); } catch { /* ignore */ }
      }
      return {
        discordId:      link.discord_id,
        riotName:       `${link.riot_name}#${link.riot_tag}`,
        tier:           rank?.tier ?? 0,
        tierName:       rank?.tierName ?? 'Unranked',
        rr:             rank?.rr ?? 0,
        leaderboardRank: rank?.leaderboardRank ?? null,
      };
    })
    .sort((a, b) => b.tier - a.tier || b.rr - a.rr);
}

function formatEntry(entry, pos) {
  const padded = pos.toString().padStart(2, '0');
  const emoji  = tierEmoji(entry.tier);
  let line = `\`${padded}.\` ${emoji} **${entry.riotName}** — ${entry.tierName}`;

  if (entry.tier > 0 && entry.rr > 0) line += ` · ${entry.rr} RR`;
  if (entry.tier >= 24 && entry.leaderboardRank) line += ` · **#${entry.leaderboardRank}**`;
  return line;
}

function buildLeaderboardPage(entries, page, totalPages, totalMembers, viewerDiscordId = null) {
  const start       = page * PAGE_SIZE;
  const pageEntries = entries.slice(start, start + PAGE_SIZE);
  const topTier     = pageEntries[0]?.tier ?? 0;

  const lines = pageEntries.map((entry, i) => formatEntry(entry, start + i + 1));

  const embed = new EmbedBuilder()
    .setColor(tierColor(topTier))
    .setTitle('🏆 Server Leaderboard')
    .setImage('attachment://ranks.png')
    .setDescription(lines.join('\n') || 'No entries on this page.')
    .setFooter({ text: `Valorant OCE Utilities · Page ${page + 1}/${totalPages} · ${totalMembers} linked members` })
    .setTimestamp();

  // Sticky viewer position — only when not on current page
  if (viewerDiscordId) {
    const viewerIdx = entries.findIndex((e) => e.discordId === viewerDiscordId);
    if (viewerIdx !== -1) {
      const isOnPage = viewerIdx >= start && viewerIdx < start + PAGE_SIZE;
      if (!isOnPage) {
        embed.addFields({
          name:  '— Your Position —',
          value: formatEntry(entries[viewerIdx], viewerIdx + 1),
          inline: false,
        });
      }
    }
  }

  return embed;
}

/**
 * Build the chart AttachmentBuilder for a leaderboard reply.
 * Looks up the viewer's tier from the DB automatically.
 * @param {Array} entries
 * @param {string|null} viewerDiscordId
 * @returns {AttachmentBuilder}
 */
function buildLeaderboardAttachment(entries, viewerDiscordId = null) {
  let viewerTier = null;
  if (viewerDiscordId) {
    const link = db.getLinkByDiscord(viewerDiscordId);
    if (link?.cached_rank) {
      try { viewerTier = JSON.parse(link.cached_rank).tier ?? null; } catch { /* ignore */ }
    }
  }

  const { buffer } = generateRankChart(entries, viewerTier);
  return new AttachmentBuilder(buffer, { name: 'ranks.png' });
}

function buildRow(page, totalPages) {
  const prev = new ButtonBuilder()
    .setCustomId(`leaderboard_page_${page - 1}`)
    .setLabel('◀ Previous')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page === 0);

  const next = new ButtonBuilder()
    .setCustomId(`leaderboard_page_${page + 1}`)
    .setLabel('Next ▶')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= totalPages - 1);

  return new ActionRowBuilder().addComponents(prev, next);
}

// ─────────────────────────────────────────────
// Command
// ─────────────────────────────────────────────

module.exports = {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Ranked list of linked server members by rank.')
    .addIntegerOption((opt) =>
      opt
        .setName('page')
        .setDescription('Page number (default: 1)')
        .setRequired(false)
        .setMinValue(1),
    ),

  async execute(interaction) {
    await interaction.deferReply();

    const entries = getSortedEntries();

    if (!entries.length) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x9B9B9B)
            .setTitle('🏆 Server Leaderboard')
            .setDescription('No linked members found in this server.')
            .setFooter({ text: 'Valorant OCE Utilities' })
            .setTimestamp(),
        ],
      });
    }

    const totalPages = Math.ceil(entries.length / PAGE_SIZE);
    const reqPage    = Math.max(0, Math.min((interaction.options.getInteger('page') ?? 1) - 1, totalPages - 1));

    const attachment = buildLeaderboardAttachment(entries, interaction.user.id);
    const e          = buildLeaderboardPage(entries, reqPage, totalPages, entries.length, interaction.user.id);
    const row        = buildRow(reqPage, totalPages);

    await interaction.editReply({
      embeds:     [e],
      files:      [attachment],
      components: totalPages > 1 ? [row] : [],
    });
  },

  // Exported for leaderboard button handler in interactionCreate.js
  getSortedEntries,
  buildLeaderboardPage,
  buildLeaderboardAttachment,
  buildRow,
  PAGE_SIZE,
};

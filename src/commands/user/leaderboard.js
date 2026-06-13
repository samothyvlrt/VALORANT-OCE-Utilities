const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const db     = require('../../modules/database');
const config = require('../../../config');

const PAGE_SIZE = 10;

// ─────────────────────────────────────────────
// Rank tier helpers
// ─────────────────────────────────────────────

// HenrikDev tier numbers:
//  0 = Unranked, 3-5 = Iron, 6-8 = Bronze, 9-11 = Silver,
//  12-14 = Gold, 15-17 = Platinum, 18-20 = Diamond,
//  21-23 = Ascendant, 24-26 = Immortal, 27 = Radiant

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
  if (tier >= 27) return '✨'; // Radiant
  if (tier >= 24) return '🔴'; // Immortal
  if (tier >= 21) return '🟢'; // Ascendant
  if (tier >= 18) return '💜'; // Diamond
  if (tier >= 15) return '🩵'; // Platinum
  if (tier >= 12) return '🟡'; // Gold
  if (tier >=  9) return '⚪'; // Silver
  if (tier >=  6) return '🟫'; // Bronze
  if (tier >=  3) return '⬛'; // Iron
  return '❔';
}

// ─────────────────────────────────────────────
// Shared helpers (also used by interactionCreate button handler)
// ─────────────────────────────────────────────

/**
 * Parse + sort all linked accounts by rank, no guild member fetch required.
 * @returns {Array}
 */
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

/**
 * Build the leaderboard embed for a given page.
 */
/**
 * Build the leaderboard embed for a given page.
 * @param {string|null} viewerDiscordId — if provided, appends the viewer's own position when they're off the current page
 */
function buildLeaderboardPage(entries, page, totalPages, totalMembers, viewerDiscordId = null) {
  const start       = page * PAGE_SIZE;
  const pageEntries = entries.slice(start, start + PAGE_SIZE);
  const topTier     = pageEntries[0]?.tier ?? 0;

  const lines = pageEntries.map((entry, i) => {
    const rank  = start + i + 1;
    const pos   = rank.toString().padStart(2, '0');
    const emoji = tierEmoji(entry.tier);

    let line = `\`${pos}.\` ${emoji} **${entry.riotName}** — ${entry.tierName}`;
    if (entry.tier > 0) line += ` · ${entry.rr} RR`;
    if (entry.tier >= 24 && entry.leaderboardRank) line += ` · **#${entry.leaderboardRank}**`;

    return line;
  });

  const embed = new EmbedBuilder()
    .setColor(tierColor(topTier))
    .setTitle('🏆 Server Leaderboard')
    .setDescription(lines.join('\n') || 'No entries on this page.')
    .setFooter({ text: `Valorant OCE Utilities · Page ${page + 1}/${totalPages} · ${totalMembers} linked members` })
    .setTimestamp();

  // Sticky viewer position — only shown when the viewer isn't on this page
  if (viewerDiscordId) {
    const viewerIdx = entries.findIndex((e) => e.discordId === viewerDiscordId);
    if (viewerIdx !== -1) {
      const isOnPage = viewerIdx >= start && viewerIdx < start + PAGE_SIZE;
      if (!isOnPage) {
        const entry = entries[viewerIdx];
        const pos   = (viewerIdx + 1).toString().padStart(2, '0');
        const emoji = tierEmoji(entry.tier);
        let line = `\`${pos}.\` ${emoji} **${entry.riotName}** — ${entry.tierName}`;
        if (entry.tier > 0) line += ` · ${entry.rr} RR`;
        if (entry.tier >= 24 && entry.leaderboardRank) line += ` · **#${entry.leaderboardRank}**`;
        embed.addFields({ name: '— Your Position —', value: line, inline: false });
      }
    }
  }

  return embed;
}

/**
 * Build the Previous / Next button row.
 */
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

    const e   = buildLeaderboardPage(entries, reqPage, totalPages, entries.length, interaction.user.id);
    const row = buildRow(reqPage, totalPages);

    await interaction.editReply({
      embeds:     [e],
      components: totalPages > 1 ? [row] : [],
    });
  },

  // Exported for use by the leaderboard_page_N button handler in interactionCreate.js
  getSortedEntries,
  buildLeaderboardPage,
  buildRow,
  PAGE_SIZE,
};

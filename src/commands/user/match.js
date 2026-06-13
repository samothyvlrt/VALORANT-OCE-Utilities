const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db = require('../../modules/database');
const { getMatchHistory, parseRiotId, getAccount, RiotApiError } = require('../../modules/riot-api');
const config = require('../../../config');

// ─────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────

/**
 * Resolve the target player (puuid, region, displayName) from interaction options.
 * Checks riot_id string first, then user mention, then the command invoker.
 * Returns { puuid, region, displayName } or throws with an embed to send.
 */
async function resolveTarget(interaction) {
  const riotIdStr     = interaction.options.getString('riot_id');
  const mentionedUser = interaction.options.getUser('user');

  if (riotIdStr) {
    const { name, tag } = parseRiotId(riotIdStr);
    const account = await getAccount(name, tag, config.riot.defaultRegion);
    return {
      puuid:       account.puuid,
      region:      account.region,
      displayName: `${account.name}#${account.tag}`,
    };
  }

  const target = mentionedUser ?? interaction.user;
  const link   = db.getLinkByDiscord(target.id);
  if (!link) {
    const isSelf = target.id === interaction.user.id;
    const err    = new Error('not_linked');
    err.embed    = new EmbedBuilder()
      .setColor(0xFEE75C)
      .setTitle('⚠️ No Account Linked')
      .setDescription(
        isSelf
          ? "You haven't linked a Riot account yet. Use `/link` to get started."
          : `<@${target.id}> hasn't linked a Riot account.`,
      )
      .setFooter({ text: 'Valorant OCE Utilities' })
      .setTimestamp();
    throw err;
  }

  return {
    puuid:       link.riot_puuid,
    region:      link.region,
    displayName: `${link.riot_name}#${link.riot_tag}`,
  };
}

/**
 * Parse a started_at value into Unix seconds.
 * Handles ISO strings and both ms / s integers.
 */
function toUnixSeconds(value) {
  if (!value) return null;
  if (typeof value === 'string') return Math.floor(new Date(value).getTime() / 1000);
  return value > 1e12 ? Math.floor(value / 1000) : value;
}

/**
 * Format a single player row for the detailed team table (fixed-width code block).
 * Example:  `Reyna      22/5/4    245 ACS` ◀
 */
function formatPlayerRow(p, totalRounds, highlightPuuid) {
  const k   = p.stats?.kills   ?? 0;
  const d   = p.stats?.deaths  ?? 0;
  const a   = p.stats?.assists ?? 0;
  const s   = p.stats?.score   ?? 0;
  const acs = Math.round(s / Math.max(totalRounds, 1));

  const agent  = (p.character ?? 'Unknown').slice(0, 10).padEnd(10, ' ');
  const kda    = `${k}/${d}/${a}`.padEnd(7, ' ');
  const acsStr = String(acs).padStart(3, ' ');
  const you    = p.puuid === highlightPuuid ? ' ◀' : '';

  return `\`${agent} ${kda} ${acsStr} ACS\`${you}`;
}

// ─────────────────────────────────────────────
// Match validity check
// ─────────────────────────────────────────────

/**
 * Returns true if a match has enough data to display.
 * Filters out Deathmatch, Swift Play, and any mode where
 * the API returns no player/map data.
 */
function isValidMatch(match) {
  const players = match?.players?.all_players ?? [];
  const map     = match?.metadata?.map;
  return players.length > 0 && map && map !== 'Unknown';
}

// ─────────────────────────────────────────────
// Error embed for API failures
// ─────────────────────────────────────────────

function apiErrorEmbed() {
  return new EmbedBuilder()
    .setColor(0xED4245)
    .setTitle('❌ API Error')
    .setDescription('Could not fetch match data. Please try again later.')
    .setFooter({ text: 'Valorant OCE Utilities' })
    .setTimestamp();
}

function notFoundEmbed(displayName) {
  return new EmbedBuilder()
    .setColor(0x9B9B9B)
    .setTitle('No Recent Matches')
    .setDescription(`No matches found for **${displayName}**.`)
    .setFooter({ text: 'Valorant OCE Utilities' })
    .setTimestamp();
}

// ─────────────────────────────────────────────
// Subcommand: /match current
// ─────────────────────────────────────────────

async function executeCurrent(interaction) {
  await interaction.deferReply();
  let target;
  try {
    target = await resolveTarget(interaction);
  } catch (err) {
    if (err.embed) return interaction.editReply({ embeds: [err.embed] });
    return interaction.editReply({ embeds: [
      new EmbedBuilder().setColor(0xED4245).setTitle('❌ Not Found').setDescription(err.message)
        .setFooter({ text: 'Valorant OCE Utilities' }).setTimestamp(),
    ]});
  }

  const { puuid, region, displayName } = target;

  // Fetch a few matches so we can skip past Deathmatch/Swift Play entries
  let matches;
  try {
    matches = await getMatchHistory(puuid, region, 5);
  } catch {
    return interaction.editReply({ embeds: [apiErrorEmbed()] });
  }

  const match = (matches ?? []).find(isValidMatch);
  if (!match) return interaction.editReply({ embeds: [notFoundEmbed(displayName)] });

  const meta       = match.metadata ?? {};
  const allPlayers = match.players?.all_players ?? [];
  const teams      = match.teams ?? {};

  const player     = allPlayers.find((p) => p.puuid === puuid) ?? allPlayers[0];
  const playerTeam = (player?.team ?? 'blue').toLowerCase();
  const enemyTeam  = playerTeam === 'red' ? 'blue' : 'red';

  const won         = teams[playerTeam]?.has_won ?? false;
  const myRounds    = teams[playerTeam]?.rounds_won ?? 0;
  const theirRounds = teams[enemyTeam]?.rounds_won  ?? 0;
  const totalRounds = Math.max(myRounds + theirRounds, 1);

  const kills   = player?.stats?.kills   ?? 0;
  const deaths  = player?.stats?.deaths  ?? 0;
  const assists = player?.stats?.assists ?? 0;
  const score   = player?.stats?.score   ?? 0;
  const acs     = Math.round(score / totalRounds);
  const kd      = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);

  const hs      = player?.stats?.headshots ?? 0;
  const bs      = player?.stats?.bodyshots ?? 0;
  const ls      = player?.stats?.legshots  ?? 0;
  const hsTotal = hs + bs + ls;
  const hsPct   = hsTotal > 0 ? Math.round((hs / hsTotal) * 100) : 0;

  const agent = player?.character ?? 'Unknown';

  const myTeamPlayers = allPlayers
    .filter((p) => p.team?.toLowerCase() === playerTeam)
    .sort((a, b) => (b.stats?.score ?? 0) - (a.stats?.score ?? 0));
  const enemyPlayers = allPlayers
    .filter((p) => p.team?.toLowerCase() === enemyTeam)
    .sort((a, b) => (b.stats?.score ?? 0) - (a.stats?.score ?? 0));

  const myTeamLines = myTeamPlayers.map((p) => formatPlayerRow(p, totalRounds, puuid)).join('\n');
  const enemyLines  = enemyPlayers.map((p) => formatPlayerRow(p, totalRounds, null)).join('\n');

  const mapName  = meta.map  ?? 'Unknown Map';
  const modeName = meta.mode ?? 'Unknown Mode';
  const ts       = toUnixSeconds(meta.started_at ?? meta.game_start ?? null);
  const timeStr  = ts ? ` · <t:${ts}:R>` : '';

  const result     = won ? '🏆 **Victory**' : '💀 **Defeat**';
  const scoreLine  = `${myRounds} — ${theirRounds}`;
  const embedColor = won ? 0x57F287 : 0xED4245;

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`${displayName} — Latest Match`)
        .setDescription([
          `🗺️ **${mapName}** · ${modeName}${timeStr}`,
          ``,
          `${result}  ${scoreLine}`,
          ``,
          `🎭 **${agent}** · ${kills}/${deaths}/${assists} · ${acs} ACS · K/D ${kd} · ${hsPct}% HS`,
        ].join('\n'))
        .addFields(
          { name: `Your Team (${playerTeam.toUpperCase()})`,  value: myTeamLines || '—', inline: false },
          { name: `Enemy Team (${enemyTeam.toUpperCase()})`,  value: enemyLines  || '—', inline: false },
        )
        .setFooter({ text: 'Valorant OCE Utilities · Latest Match' })
        .setTimestamp(),
    ],
  });
}

// ─────────────────────────────────────────────
// Subcommand: /match history
// ─────────────────────────────────────────────

async function executeHistory(interaction) {
  await interaction.deferReply();
  let target;
  try {
    target = await resolveTarget(interaction);
  } catch (err) {
    if (err.embed) return interaction.editReply({ embeds: [err.embed] });
    return interaction.editReply({ embeds: [
      new EmbedBuilder().setColor(0xED4245).setTitle('❌ Not Found').setDescription(err.message)
        .setFooter({ text: 'Valorant OCE Utilities' }).setTimestamp(),
    ]});
  }

  const { puuid, region, displayName } = target;

  let matches;
  try {
    // Fetch extra to account for Deathmatch/Swift Play entries with no data
    matches = await getMatchHistory(puuid, region, 15);
  } catch {
    return interaction.editReply({ embeds: [apiErrorEmbed()] });
  }

  // Filter out game modes the API returns no player data for, cap at 10
  matches = (matches ?? []).filter(isValidMatch).slice(0, 10);
  if (!matches.length) return interaction.editReply({ embeds: [notFoundEmbed(displayName)] });

  const lines = matches.map((match, i) => {
    const meta       = match.metadata ?? {};
    const allPlayers = match.players?.all_players ?? [];
    const teams      = match.teams ?? {};

    const player     = allPlayers.find((p) => p.puuid === puuid) ?? allPlayers[0];
    const playerTeam = (player?.team ?? 'blue').toLowerCase();
    const enemyTeam  = playerTeam === 'red' ? 'blue' : 'red';

    const won         = teams[playerTeam]?.has_won ?? false;
    const myRounds    = teams[playerTeam]?.rounds_won ?? 0;
    const theirRounds = teams[enemyTeam]?.rounds_won  ?? 0;
    const totalRounds = Math.max(myRounds + theirRounds, 1);

    const kills   = player?.stats?.kills   ?? 0;
    const deaths  = player?.stats?.deaths  ?? 0;
    const assists = player?.stats?.assists ?? 0;
    const score   = player?.stats?.score   ?? 0;
    const acs     = Math.round(score / totalRounds);

    const agent    = (player?.character ?? 'Unknown').slice(0, 8);
    const mapName  = (meta.map  ?? 'Unknown').slice(0, 8);
    const modeName = (meta.mode ?? '?').slice(0, 4);
    const result   = won ? '🏆' : '💀';
    const ts       = toUnixSeconds(meta.started_at ?? meta.game_start ?? null);
    const timeStr  = ts ? `<t:${ts}:d>` : '';

    const num = String(i + 1).padStart(2, '0');

    return `\`${num}.\` ${result} **${mapName}** · ${modeName} · ${agent} · ${kills}/${deaths}/${assists} · ${acs} ACS · ${myRounds}-${theirRounds}${timeStr ? ` · ${timeStr}` : ''}`;
  });

  // Overall W/L for the 10 games
  const wins   = matches.filter((m) => {
    const player = m.players?.all_players?.find((p) => p.puuid === puuid);
    const team   = (player?.team ?? '').toLowerCase();
    return m.teams?.[team]?.has_won ?? false;
  }).length;
  const losses = matches.length - wins;

  return interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setColor(wins >= losses ? 0x57F287 : 0xED4245)
        .setTitle(`${displayName} — Last ${matches.length} Matches`)
        .setDescription(lines.join('\n'))
        .addFields({ name: 'Record', value: `**${wins}W — ${losses}L**`, inline: true })
        .setFooter({ text: 'Valorant OCE Utilities · Match History' })
        .setTimestamp(),
    ],
  });
}

// ─────────────────────────────────────────────
// Command definition
// ─────────────────────────────────────────────

const sharedOptions = (sub) =>
  sub
    .addUserOption((opt) =>
      opt.setName('user').setDescription('Discord user to look up (must be linked)').setRequired(false),
    )
    .addStringOption((opt) =>
      opt.setName('riot_id').setDescription('Riot ID to look up directly (e.g. Name#TAG)').setRequired(false),
    );

module.exports = {
  data: new SlashCommandBuilder()
    .setName('match')
    .setDescription('View match stats for a linked member.')
    .addSubcommand((sub) =>
      sharedOptions(
        sub
          .setName('latest')
          .setDescription('Detailed view of your latest match with full team breakdown.'),
      ),
    )
    .addSubcommand((sub) =>
      sharedOptions(
        sub
          .setName('history')
          .setDescription('Your last 10 matches — result, agent, K/D/A, ACS at a glance.'),
      ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'latest') return executeCurrent(interaction);
    if (sub === 'history') return executeHistory(interaction);
  },
};

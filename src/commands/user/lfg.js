/**
 * /lfg — post a looking-for-group for your current Comp/Squad voice channel.
 *
 * Must be run in one of the LFG text channels, while connected to a Comp/Squad VC.
 * Posts an embed (mode, LF count, members in voice, auto rank range, lobby code)
 * with a Join link button (an invite to the VC) and a Refresh button.
 */
const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const config = require('../../../config');
const embed  = require('../../utils/embed');
const db     = require('../../modules/database');
const { COMP_SQUAD_VCS, LFG_CHANNELS } = require('../../modules/channels');

const TEST_GUILD_ID = config.discord.devGuildId;

const MODES = ['Competitive', 'Casual', 'Premier'];

/**
 * Compute a low–high rank range from a list of linked_accounts rows.
 * Pure function (no I/O) so it can be unit-tested.
 * @param {Array<{cached_rank?: string}>} links
 * @returns {{ text: string, linkedCount: number }}
 */
function rankRangeFromLinks(links) {
  const ranks = [];
  for (const l of links) {
    if (!l || !l.cached_rank) continue;
    try {
      const r = JSON.parse(l.cached_rank);
      if (typeof r.tier === 'number' && r.tier > 0 && r.tierName) ranks.push(r);
    } catch { /* ignore malformed cache */ }
  }
  if (!ranks.length) return { text: 'No linked players yet', linkedCount: 0 };
  ranks.sort((a, b) => a.tier - b.tier);
  const low  = ranks[0];
  const high = ranks[ranks.length - 1];
  const text = low.tier === high.tier ? low.tierName : `${low.tierName} – ${high.tierName}`;
  return { text, linkedCount: ranks.length };
}

/**
 * Build the LFG embed from a live voice channel.
 * @param {object} opts
 * @param {import('discord.js').VoiceChannel} opts.vc
 * @param {string} opts.mode
 * @param {number|string} opts.players
 * @param {?string} opts.code
 * @param {?string} opts.footerText
 */
function buildLfgEmbed({ vc, mode, players, code, footerText }) {
  const members  = [...vc.members.values()];
  const mentions = members.length ? members.map((m) => `<@${m.id}>`).join(' ') : '*nobody yet*';
  const { text: rankText, linkedCount } = rankRangeFromLinks(db.getLinksByDiscordIds(members.map((m) => m.id)));

  const e = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${mode} | LF${players}`)
    .addFields(
      { name: 'Voice channel', value: vc.name, inline: true },
      { name: 'Average rank', value: linkedCount ? `${rankText} *(${linkedCount} linked)*` : rankText, inline: true },
      { name: `Members in voice (${members.length})`, value: mentions, inline: false },
    );
  if (code) e.addFields({ name: 'Lobby code', value: `\`${code}\``, inline: true });
  if (footerText) e.setFooter({ text: footerText });
  e.setTimestamp();
  return e;
}

/**
 * Build the action row: an optional Join link button + a Refresh button.
 * Refresh state is encoded in the customId so it survives bot restarts.
 */
function buildLfgRow({ joinUrl, vcId, mode, players, code }) {
  const row = new ActionRowBuilder();
  if (joinUrl) {
    row.addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Join VC').setURL(joinUrl).setEmoji('🔊'),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Secondary)
      .setCustomId(`lfg_refresh|${vcId}|${mode}|${players}|${code || ''}`)
      .setLabel('Refresh')
      .setEmoji('🔄'),
  );
  return row;
}

module.exports = {
  // Exported for the refresh handler + unit tests.
  rankRangeFromLinks,
  buildLfgEmbed,
  buildLfgRow,

  data: new SlashCommandBuilder()
    .setName('lfg')
    .setDescription('Post a looking-for-group for the Comp/Squad VC you\'re in.')
    .addStringOption((o) =>
      o.setName('mode').setDescription('Game mode').setRequired(true)
        .addChoices(...MODES.map((m) => ({ name: m, value: m }))),
    )
    .addIntegerOption((o) =>
      o.setName('players').setDescription('How many players are you looking for? (1–4)')
        .setRequired(true).setMinValue(1).setMaxValue(4),
    )
    .addStringOption((o) =>
      o.setName('code').setDescription('Party/lobby code (optional)').setRequired(false).setMaxLength(16),
    ),

  async execute(interaction) {
    // Must be run in a designated looking-for-games channel.
    if (!LFG_CHANNELS.has(interaction.channelId) && interaction.guildId !== TEST_GUILD_ID) {
      return interaction.reply({
        embeds: [embed.warning('Wrong Channel', 'Run `/lfg` in a looking-for-games channel.')],
        ephemeral: true,
      });
    }

    // Poster must be in a Comp/Squad VC (the join target + rank source).
    const vc = interaction.member.voice?.channel;
    if (!vc) {
      return interaction.reply({
        embeds: [embed.warning('Not in a Voice Channel', 'Join a Comp or Squad VC first, then run `/lfg`.')],
        ephemeral: true,
      });
    }
    if (!COMP_SQUAD_VCS.has(vc.id) && interaction.guildId !== TEST_GUILD_ID) {
      return interaction.reply({
        embeds: [embed.warning('Wrong Voice Channel', 'You need to be in a Comp or Squad VC to post an LFG.')],
        ephemeral: true,
      });
    }

    const mode    = interaction.options.getString('mode');
    const players = interaction.options.getInteger('players');
    const codeRaw = interaction.options.getString('code');
    const code    = codeRaw ? codeRaw.replace(/[|`]/g, '').trim().slice(0, 16) : null;

    // Deep-link straight to the voice channel — no invite permission needed
    // (members are already in the guild). Clicking jumps them to the VC to join.
    const joinUrl = `https://discord.com/channels/${interaction.guildId}/${vc.id}`;

    const e   = buildLfgEmbed({ vc, mode, players, code, footerText: `LFG by ${interaction.user.tag}` });
    const row = buildLfgRow({ joinUrl, vcId: vc.id, mode, players, code });

    await interaction.reply({ embeds: [e], components: [row] });
  },
};

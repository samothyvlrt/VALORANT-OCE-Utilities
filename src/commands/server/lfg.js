/**
 * /lfg — looking-for-group post.
 *
 * Run in an LFG channel. If you're in a Comp/Squad VC, the post ties to it
 * (members-in-voice updates live via voiceStateUpdate, a Join invite button,
 * auto-expires when the VC empties). If you're not in such a VC, it posts a
 * minimal version (just LF count + rank/division + lobby code).
 *
 * Rank/division is entered manually (no linked-account requirement).
 * Future: require a verified (RSO) linked account and auto-derive Competitive
 * range / Premier division.
 */
const { SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const config = require('../../../config');
const embed  = require('../../utils/embed');
const { COMP_SQUAD_VCS, LFG_CHANNELS } = require('../../modules/channels');
const lfgPosts = require('../../modules/lfg-posts');

const TEST_GUILD_ID = config.discord.devGuildId;
const MODES = ['Competitive', 'Casual', 'Premier'];
// Premier divisions, lowest → highest. Invite is the apex.
const PREMIER_DIVISIONS = ['Open', 'Intermediate', 'Advanced', 'Elite', 'Contender', 'Invite'];

/**
 * Build the LFG embed. `vc` is optional — when absent, the Voice channel and
 * Members-in-voice fields are omitted (the "not in a VC" minimal post).
 */
function buildLfgEmbed({ vc, mode, players, rank, division, code, footerText }) {
  const e = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${mode} | LF${players}`);

  if (vc) e.addFields({ name: 'Voice channel', value: vc.name, inline: true });

  // Rank/division field is mode-specific. Casual shows nothing rank-related.
  if (mode === 'Competitive') {
    e.addFields({ name: 'Rank range', value: rank || 'Any', inline: true });
  } else if (mode === 'Premier') {
    e.addFields({ name: 'Division', value: division || 'Any', inline: true });
  }

  if (vc) {
    const members  = [...vc.members.values()];
    const mentions = members.length ? members.map((m) => `<@${m.id}>`).join(' ') : '*nobody yet*';
    e.addFields({ name: `Members in voice (${members.length})`, value: mentions, inline: false });
  }
  if (code) e.addFields({ name: 'Lobby code', value: `\`${code}\``, inline: true });
  if (footerText) e.setFooter({ text: footerText });
  e.setTimestamp();
  return e;
}

/** Join row — a real VC invite (connects on click). Empty row if no invite. */
function buildLfgRow({ joinUrl }) {
  const row = new ActionRowBuilder();
  if (joinUrl) {
    row.addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Join VC').setURL(joinUrl).setEmoji('🔊'),
    );
  }
  return row;
}

/**
 * Build the message payload for a stored (VC-tied) LFG post from the live VC.
 * Returns null if the VC is gone.
 */
function renderLfg(guild, post) {
  const vc = guild.channels.cache.get(post.vcId);
  if (!vc) return null;
  const components = post.joinUrl ? [buildLfgRow({ joinUrl: post.joinUrl })] : [];
  return {
    embeds: [buildLfgEmbed({ vc, mode: post.mode, players: post.players, rank: post.rank, division: post.division, code: post.code, footerText: post.footerText })],
    components,
  };
}

/** The "expired" payload — shown once the tied VC empties. No buttons. */
function renderExpired(post) {
  const e = new EmbedBuilder()
    .setColor(config.colors.neutral)
    .setTitle(`${post.mode} | LF${post.players} — Expired`)
    .setDescription('This LFG has expired — the voice channel is empty.')
    .setTimestamp();
  if (post.footerText) e.setFooter({ text: post.footerText });
  return { embeds: [e], components: [] };
}

module.exports = {
  buildLfgEmbed,
  buildLfgRow,
  renderLfg,
  renderExpired,

  data: new SlashCommandBuilder()
    .setName('lfg')
    .setDescription('Post a looking-for-group (ties to your Comp/Squad VC if you\'re in one).')
    .addStringOption((o) =>
      o.setName('mode').setDescription('Game mode').setRequired(true)
        .addChoices(...MODES.map((m) => ({ name: m, value: m }))),
    )
    .addIntegerOption((o) =>
      o.setName('players').setDescription('How many players are you looking for? (1–4)')
        .setRequired(true).setMinValue(1).setMaxValue(4),
    )
    .addStringOption((o) =>
      o.setName('rank').setDescription('Competitive only — rank range, e.g. "Silver - Gold"')
        .setRequired(false).setMaxLength(32),
    )
    .addStringOption((o) =>
      o.setName('division').setDescription('Premier only — your team\'s division')
        .setRequired(false)
        .addChoices(...PREMIER_DIVISIONS.map((d) => ({ name: d, value: d }))),
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

    const mode     = interaction.options.getString('mode');
    const players  = interaction.options.getInteger('players');
    const rankRaw  = interaction.options.getString('rank');
    const division = interaction.options.getString('division');
    const codeRaw  = interaction.options.getString('code');
    const rank     = rankRaw ? rankRaw.trim().slice(0, 32) : null;
    const code     = codeRaw ? codeRaw.replace(/`/g, '').trim().slice(0, 16) : null;
    const footerText = `LFG by ${interaction.user.tag}`;

    // Tie to a Comp/Squad VC if the poster is in one; otherwise post a minimal LFG.
    const vc = interaction.member.voice?.channel;
    const useVc = vc && (COMP_SQUAD_VCS.has(vc.id) || interaction.guildId === TEST_GUILD_ID);

    if (!useVc) {
      return interaction.reply({
        embeds: [buildLfgEmbed({ vc: null, mode, players, rank, division, code, footerText })],
      });
    }

    // Real VC invite so the Join button actually connects (bot has the perm).
    let joinUrl = null;
    try {
      const invite = await vc.createInvite({ maxAge: 1800, maxUses: 0, reason: 'LFG join link' });
      joinUrl = invite.url;
    } catch (err) {
      console.warn('[lfg] could not create invite:', err.message);
    }

    const post = {
      guildId:    interaction.guildId,
      channelId:  interaction.channelId,
      vcId:       vc.id,
      mode, players, rank, division, code, joinUrl, footerText,
    };

    await interaction.reply({
      embeds:     [buildLfgEmbed({ vc, mode, players, rank, division, code, footerText })],
      components: joinUrl ? [buildLfgRow({ joinUrl })] : [],
    });

    // Register for live updates + auto-expire.
    try {
      const msg = await interaction.fetchReply();
      lfgPosts.register(msg.id, post);
    } catch (err) {
      console.warn('[lfg] could not register post for live updates:', err.message);
    }
  },
};

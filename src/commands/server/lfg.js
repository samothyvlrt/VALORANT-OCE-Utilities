/**
 * /lfg — looking-for-group post for the Comp/Squad VC you're in.
 *
 * Run in an LFG channel while connected to a Comp/Squad VC. Posts an embed
 * (mode, LF count, rank range, members in voice, lobby code) with a Join
 * deep-link button and a Refresh button. Members-in-voice updates LIVE via
 * voiceStateUpdate; state is tracked in src/modules/lfg-posts.js.
 *
 * The rank range is entered manually for now (no linked-account requirement).
 * Future: require a verified (RSO) linked account and auto-derive the range.
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

function buildLfgEmbed({ vc, mode, players, rank, division, code, footerText }) {
  const members  = [...vc.members.values()];
  const mentions = members.length ? members.map((m) => `<@${m.id}>`).join(' ') : '*nobody yet*';

  const e = new EmbedBuilder()
    .setColor(config.colors.primary)
    .setTitle(`${mode} | LF${players}`)
    .addFields({ name: 'Voice channel', value: vc.name, inline: true });

  // Rank/division field is mode-specific. Casual shows nothing rank-related.
  if (mode === 'Competitive') {
    e.addFields({ name: 'Rank range', value: rank || 'Any', inline: true });
  } else if (mode === 'Premier') {
    e.addFields({ name: 'Division', value: division || 'Any', inline: true });
  }

  e.addFields({ name: `Members in voice (${members.length})`, value: mentions, inline: false });
  if (code) e.addFields({ name: 'Lobby code', value: `\`${code}\``, inline: true });
  if (footerText) e.setFooter({ text: footerText });
  e.setTimestamp();
  return e;
}

// Single Join deep-link button (no invite permission needed). Refresh was removed
// now that members update live; a "Refresh rank" button can return once rank is
// auto-derived from linked PUUIDs.
function buildLfgRow({ guildId, vcId }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Join VC')
      .setURL(`https://discord.com/channels/${guildId}/${vcId}`).setEmoji('🔊'),
  );
}

/**
 * Build the full message payload for a stored LFG post by reading the live VC.
 * Returns null if the VC no longer exists.
 * @param {import('discord.js').Guild} guild
 * @param {object} post  registry entry
 */
function renderLfg(guild, post) {
  const vc = guild.channels.cache.get(post.vcId);
  if (!vc) return null;
  return {
    embeds:     [buildLfgEmbed({ vc, mode: post.mode, players: post.players, rank: post.rank, division: post.division, code: post.code, footerText: post.footerText })],
    components: [buildLfgRow({ guildId: guild.id, vcId: post.vcId })],
  };
}

module.exports = {
  buildLfgEmbed,
  buildLfgRow,
  renderLfg,

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

    // Poster must be in a Comp/Squad VC (the join target).
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

    const mode     = interaction.options.getString('mode');
    const players  = interaction.options.getInteger('players');
    const rankRaw  = interaction.options.getString('rank');
    const division = interaction.options.getString('division');
    const codeRaw  = interaction.options.getString('code');
    const rank     = rankRaw ? rankRaw.trim().slice(0, 32) : null;
    const code     = codeRaw ? codeRaw.replace(/`/g, '').trim().slice(0, 16) : null;

    const post = {
      guildId:    interaction.guildId,
      channelId:  interaction.channelId,
      vcId:       vc.id,
      mode, players, rank, division, code,
      footerText: `LFG by ${interaction.user.tag}`,
    };

    await interaction.reply({
      embeds:     [buildLfgEmbed({ vc, mode, players, rank, division, code, footerText: post.footerText })],
      components: [buildLfgRow({ guildId: interaction.guildId, vcId: vc.id })],
    });

    // Register for live updates.
    try {
      const msg = await interaction.fetchReply();
      lfgPosts.register(msg.id, post);
    } catch (err) {
      console.warn('[lfg] could not register post for live updates:', err.message);
    }
  },
};

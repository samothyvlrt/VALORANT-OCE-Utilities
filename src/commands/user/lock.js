const { SlashCommandBuilder } = require('discord.js');
const config = require('../../../config');
const embed  = require('../../utils/embed');
const vcLock = require('../../modules/vc-lock');
const { COMP_SQUAD_VCS } = require('../../modules/channels');

// Dev/testing server — any VC is allowed (set via DEV_GUILD_ID in .env)
const TEST_GUILD_ID = config.discord.devGuildId;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock the voice channel you\'re currently in (Comp/Squad only).'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
      const vc = interaction.member.voice?.channel;

      if (!vc) {
        return interaction.editReply({
          embeds: [embed.warning('Not in a Voice Channel', 'You need to be in a Comp or Squad VC to use this command.')],
        });
      }

      if (!COMP_SQUAD_VCS.has(vc.id) && interaction.guildId !== TEST_GUILD_ID) {
        return interaction.editReply({
          embeds: [embed.warning('Wrong Channel', 'This command only works in Comp or Squad voice channels.')],
        });
      }

      if (vcLock.isLocked(vc.id)) {
        return interaction.editReply({
          embeds: [embed.warning('Already Locked', `**${vc.name}** is already locked.`)],
        });
      }

      // Give the bot an explicit Connect: true BEFORE denying @everyone,
      // otherwise the bot loses channel access and can't make further API calls
      await vc.permissionOverwrites.edit(interaction.client.user.id, { Connect: true });

      // Deny @everyone Connect
      await vc.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: false });

      // Allow Connect for every member currently in the channel
      // Skip members we can't set overwrites for (role hierarchy issue)
      const memberIds = [];
      for (const [id] of vc.members) {
        try {
          await vc.permissionOverwrites.edit(id, { Connect: true });
          memberIds.push(id);
        } catch (err) {
          console.warn(`[lock] Skipped overwrite for ${id}: ${err.message}`);
        }
      }

      vcLock.lock(vc.id, memberIds);

      return interaction.editReply({
        embeds: [
          embed.success(
            '🔒 Channel Locked',
            [
              `**${vc.name}** is now locked — no new players can join.`,
              ``,
              `${memberIds.length} member(s) have a 10-minute window to reconnect if they disconnect.`,
              `After 10 minutes their reconnect access is removed.`,
              ``,
              `Run \`/unlock\` to open the channel again.`,
            ].join('\n'),
          ),
        ],
      });
    } catch (err) {
      const msg = err?.message ?? String(err) ?? 'unknown error';
      console.error('[lock] Error:', msg, err);
      try {
        await interaction.editReply({ content: `🔒 Lock failed: \`${msg}\`` });
      } catch (e2) {
        console.error('[lock] Also failed to send error reply:', e2);
      }
    }
  },
};

const { SlashCommandBuilder, OverwriteType } = require('discord.js');
const config = require('../../../config');
const embed  = require('../../utils/embed');
const vcLock = require('../../modules/vc-lock');

// Dev/testing server — any VC is allowed (set via DEV_GUILD_ID in .env)
const TEST_GUILD_ID = config.discord.devGuildId;

// Comp 1–15 + Squad 0–10 channel IDs
const ALLOWED_CHANNELS = new Set([
  // Comp
  '727443108488282152', '727443150460813383', '727443244228542514',
  '727443265875607583', '727443309919993916', '727443287585194035',
  '727443329243021332', '727443351045144587', '727443372834422794',
  '727443395685122119', '727703119617851403', '727703138542551112',
  '729663370692788255', '729663393421590558', '729663413432877076',
  // Squad
  '899115364728848415', '537889557853634571', '537932400831758357',
  '537932424953331722', '537932451935420416', '537932476832677898',
  '698801565070262354', '698801587929219113', '698801612835258368',
  '798981457900601396', '701277690660913223',
]);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlock a locked voice channel (Comp/Squad only).'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const vc = interaction.member.voice?.channel;

    if (!vc) {
      return interaction.editReply({
        embeds: [embed.warning('Not in a Voice Channel', 'Join the locked VC first, then run `/unlock`.')],
      });
    }

    if (!ALLOWED_CHANNELS.has(vc.id) && interaction.guildId !== TEST_GUILD_ID) {
      return interaction.editReply({
        embeds: [embed.warning('Wrong Channel', 'This command only works in Comp or Squad voice channels.')],
      });
    }

    // Check both in-memory state and actual channel overwrites (handles bot restarts
    // or cases where /lock crashed partway through)
    const everyoneOverwrite = vc.permissionOverwrites.cache.get(interaction.guild.roles.everyone.id);
    const isActuallyLocked  = vcLock.isLocked(vc.id) || everyoneOverwrite?.deny.has('Connect');

    if (!isActuallyLocked) {
      return interaction.editReply({
        embeds: [embed.warning('Not Locked', `**${vc.name}** is not currently locked.`)],
      });
    }

    try {
      // Reset @everyone Connect (null = inherit from category/role)
      await vc.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: null });

      // Remove the bot's own Connect overwrite added during lock
      try {
        await vc.permissionOverwrites.delete(interaction.client.user.id);
      } catch { /* fine if it doesn't exist */ }

      // Remove all individual member overwrites added by the lock
      const memberOverwrites = [...vc.permissionOverwrites.cache.values()]
        .filter((o) => o.type === OverwriteType.Member);

      for (const overwrite of memberOverwrites) {
        try {
          await vc.permissionOverwrites.delete(overwrite.id);
        } catch (err) {
          console.warn(`[unlock] Skipped overwrite removal for ${overwrite.id}: ${err.message}`);
        }
      }
    } catch (err) {
      console.error('[unlock] Failed to remove @everyone overwrite:', err.message);
      return interaction.editReply({
        embeds: [embed.error('Unlock Failed', `Could not unlock the channel: ${err.message}`)],
      });
    }

    // Cancel all reconnect timers and clear lock state
    vcLock.unlock(vc.id);

    return interaction.editReply({
      embeds: [embed.success('🔓 Channel Unlocked', `**${vc.name}** is now open. All reconnect timers have been cleared.`)],
    });
  },
};

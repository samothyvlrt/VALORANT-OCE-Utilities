const { SlashCommandBuilder } = require('discord.js');
const embed  = require('../../utils/embed');
const vcLock = require('../../modules/vc-lock');

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
    .setName('lock')
    .setDescription('Lock the voice channel you\'re currently in (Comp/Squad only).'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const vc = interaction.member.voice?.channel;

    if (!vc) {
      return interaction.editReply({
        embeds: [embed.warning('Not in a Voice Channel', 'You need to be in a Comp or Squad VC to use this command.')],
      });
    }

    if (!ALLOWED_CHANNELS.has(vc.id)) {
      return interaction.editReply({
        embeds: [embed.warning('Wrong Channel', 'This command only works in Comp or Squad voice channels.')],
      });
    }

    if (vcLock.isLocked(vc.id)) {
      return interaction.editReply({
        embeds: [embed.warning('Already Locked', `**${vc.name}** is already locked.`)],
      });
    }

    // Deny @everyone Connect
    await vc.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: false });

    // Allow Connect for every member currently in the channel
    const memberIds = [...vc.members.keys()];
    for (const id of memberIds) {
      await vc.permissionOverwrites.edit(id, { Connect: true });
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
  },
};

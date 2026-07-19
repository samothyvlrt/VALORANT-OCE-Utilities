/**
 * /privacy — toggle leaderboard visibility for your linked account.
 *
 * When hidden=true the user still appears in admin link list and stats,
 * but is excluded from the public /leaderboard command.
 */

const { SlashCommandBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db    = require('../../modules/database');
const { scheduleLeaderboardRegen } = require('../../utils/generate-leaderboard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('privacy')
    .setDescription('Toggle whether your account appears on the public leaderboard.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const link = db.getLinkByDiscord(interaction.user.id);
    if (!link) {
      return interaction.editReply({
        embeds: [embed.warning('Not Linked', 'You need to link your Riot account first with `/link`.')],
      });
    }

    const nowHidden = !link.hidden;
    db.setHidden(interaction.user.id, nowHidden);
    scheduleLeaderboardRegen();

    if (nowHidden) {
      return interaction.editReply({
        embeds: [
          embed.info(
            '🙈 Hidden from Leaderboard',
            [
              `Your account (**${link.riot_name}#${link.riot_tag}**) is now **hidden** from the public leaderboard.`,
              ``,
              `Admins can still see your link. Run \`/privacy\` again to make yourself visible.`,
            ].join('\n'),
          ),
        ],
      });
    }

    return interaction.editReply({
      embeds: [
        embed.success(
          '👁️ Visible on Leaderboard',
          [
            `Your account (**${link.riot_name}#${link.riot_tag}**) is now **visible** on the public leaderboard.`,
            ``,
            `Run \`/privacy\` again to hide yourself.`,
          ].join('\n'),
        ),
      ],
    });
  },
};

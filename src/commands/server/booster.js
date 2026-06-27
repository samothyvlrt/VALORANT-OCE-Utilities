/**
 * /booster — show your accumulated boost tenure and sync your tenure role.
 *
 * Total tenure = banked time (past streaks the bot observed + staff credits) +
 * your current streak. Self-service: reconciles the runner's role on demand.
 */
const { SlashCommandBuilder } = require('discord.js');
const config = require('../../../config');
const embed  = require('../../utils/embed');
const db     = require('../../modules/database');
const { reconcileMember, formatDuration, MONTH_MS } = require('../../utils/booster');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('booster')
    .setDescription('Check your accumulated boost tenure and update your tenure role.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (!config.discord.boosterRoles.length) {
      return interaction.editReply({
        embeds: [embed.error('Not Configured', 'Booster tenure roles are not set up. Contact an admin.')],
      });
    }

    const member = interaction.member;
    const banked = db.getBoosterBanked(member.id);
    const r = await reconcileMember(member, banked);

    const lines = [`Total tenure: **${formatDuration(r.totalMs)}** (${r.totalMonths} month${r.totalMonths !== 1 ? 's' : ''}).`];

    if (r.boosting) {
      lines.push(`Boosting since <t:${Math.floor(member.premiumSinceTimestamp / 1000)}:D> — current streak **${formatDuration(r.streakMs)}**.`);
    }
    if (r.bankedMs > 0) {
      lines.push(`Banked from past boosting / credits: **${formatDuration(r.bankedMs)}**.`);
    }

    if (r.targetTier) {
      lines.push(`Tenure role: <@&${r.targetTier}>`);
      const next = config.discord.boosterRoles.find((x) => x.months > r.totalMonths);
      if (next) lines.push(`Next role <@&${next.roleId}> at **${next.months} months** (${next.months - r.totalMonths} to go).`);
    } else if (r.boosting) {
      const next = config.discord.boosterRoles.find((x) => x.months > r.totalMonths);
      lines.push(next
        ? `No milestone role yet — next is <@&${next.roleId}> at **${next.months} months**.`
        : 'No milestone role configured.');
    }

    if (!r.boosting) {
      if (config.discord.boosterBrokenRoleId && member.roles.cache.has(config.discord.boosterBrokenRoleId)) {
        return interaction.editReply({
          embeds: [embed.info('Not Currently Boosting',
            `${lines.join('\n')}\n\nYou're not boosting right now, but you reached **${config.discord.boosterBrokenThreshold}+ months** — so you keep your <@&${config.discord.boosterBrokenRoleId}> role.`)],
        });
      }
      return interaction.editReply({
        embeds: [embed.info('Not Currently Boosting', `${lines.join('\n')}\n\nBoost the server to start earning tenure roles!`)],
      });
    }

    return interaction.editReply({ embeds: [embed.success('Thanks for Boosting! 💎', lines.join('\n'))] });
  },
};

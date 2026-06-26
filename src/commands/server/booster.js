/**
 * /booster — show your boost tenure and sync your tenure role.
 *
 * Self-service: reads the runner's `premiumSince` (when they started boosting
 * this server), assigns the correct continuous-tenure role, and reports it.
 */
const { SlashCommandBuilder } = require('discord.js');
const config = require('../../../config');
const embed  = require('../../utils/embed');
const { reconcileMember, formatDuration } = require('../../utils/booster');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('booster')
    .setDescription('Check your server-boost tenure and update your tenure role.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (!config.discord.boosterRoles.length) {
      return interaction.editReply({
        embeds: [embed.error('Not Configured', 'Booster tenure roles are not set up. Contact an admin.')],
      });
    }

    const member  = interaction.member;
    const premium = member.premiumSinceTimestamp ?? null;

    // Assign/correct roles based on current continuous tenure.
    const plan = await reconcileMember(member);

    const brokenId  = config.discord.boosterBrokenRoleId;
    const tierId    = config.discord.boosterRoles.map((r) => r.roleId).find((id) => member.roles.cache.has(id)) || null;
    const hasBroken = brokenId && member.roles.cache.has(brokenId);

    if (premium) {
      const lines = [
        `Boosting since <t:${Math.floor(premium / 1000)}:D> — **${formatDuration(Date.now() - premium)}**.`,
      ];
      lines.push(tierId
        ? `Tenure role: <@&${tierId}>`
        : 'No tenure role yet — reach your first threshold to earn one.');

      const next = config.discord.boosterRoles.find((r) => r.months > (plan.months ?? 0));
      if (next) {
        lines.push(`Next role <@&${next.roleId}> at **${next.months} months** (${next.months - (plan.months ?? 0)} to go).`);
      }

      return interaction.editReply({ embeds: [embed.success('Thanks for Boosting! 💎', lines.join('\n'))] });
    }

    if (hasBroken) {
      return interaction.editReply({
        embeds: [embed.info('Not Currently Boosting',
          `You're not boosting right now, but you previously reached **${config.discord.boosterBrokenThreshold}+ months** — so you keep your <@&${brokenId}> role.`)],
      });
    }

    return interaction.editReply({
      embeds: [embed.info('Not Currently Boosting',
        'You\'re not currently boosting this server, so you have no tenure role. Boost to start earning them!')],
    });
  },
};

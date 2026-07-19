/**
 * /boostercredit — staff: credit (or deduct) booster months for a member's
 * past boosting the bot never observed. Updates their banked tenure + role.
 * Minimum tier: Admin.
 */
const { SlashCommandBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { requireTier, LEVELS } = require('../../utils/permissions');
const { reconcileMember, formatDuration, MONTH_MS } = require('../../utils/booster');
const { logAdminAction } = require('../../utils/activity-log');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('boostercredit')
    .setDescription('Staff: credit a member booster months for past boosting.')
    .setDefaultMemberPermissions('0')
    .addUserOption((o) =>
      o.setName('user').setDescription('Member to credit').setRequired(true),
    )
    .addIntegerOption((o) =>
      o.setName('months').setDescription('Months to add (negative to deduct)')
        .setRequired(true).setMinValue(-120).setMaxValue(120),
    ),

  async execute(interaction) {
    if (!(await requireTier(interaction, LEVELS.ADMIN))) return;

    await interaction.deferReply({ ephemeral: true });

    const target = interaction.options.getUser('user');
    const months = interaction.options.getInteger('months');

    const newBanked = db.addBoosterBanked(target.id, months * MONTH_MS);

    // Re-sync their role with the new banked total.
    let roleLine = '';
    let totalLine = `Banked total: **${formatDuration(newBanked)}**.`;
    try {
      const member = await interaction.guild.members.fetch(target.id);
      const r = await reconcileMember(member, newBanked);
      totalLine = `Total tenure: **${formatDuration(r.totalMs)}** (${r.totalMonths} months).`;
      roleLine = r.targetTier ? `\nTenure role: <@&${r.targetTier}>` : '';
    } catch {
      roleLine = '\n*(Member not in the server — banked time saved; role will apply when they\'re present and boosting.)*';
    }

    logAdminAction(interaction.client, {
      action:    'Booster Credit',
      moderator: interaction.user,
      target:    `<@${target.id}>`,
      fields:    { Months: months, 'Banked total': formatDuration(newBanked) },
      guildId:   interaction.guildId,
    });

    await interaction.editReply({
      embeds: [embed.success('Booster Tenure Updated',
        `${months >= 0 ? 'Credited' : 'Deducted'} **${Math.abs(months)} month(s)** ${months >= 0 ? 'to' : 'from'} <@${target.id}>.\n${totalLine}${roleLine}`)],
    });
  },
};

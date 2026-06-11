const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Remove the Riot account linked to your Discord profile.'),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const existing = db.getLinkByDiscord(interaction.user.id);
    if (!existing) {
      return interaction.editReply({
        embeds: [embed.warning('No Link Found', "You don't have a Riot account linked. Use `/link` to get started.")],
      });
    }

    // Confirmation button
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`unlink_confirm_${interaction.user.id}`)
        .setLabel('Yes, unlink my account')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`unlink_cancel_${interaction.user.id}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    const confirmMsg = await interaction.editReply({
      embeds: [
        embed.warning(
          'Confirm Unlink',
          `This will remove the link between your Discord account and **${existing.riot_name}#${existing.riot_tag}**.\n\nAre you sure?`,
        ),
      ],
      components: [confirmRow],
    });

    // Collect the button interaction
    const filter = (i) => i.user.id === interaction.user.id;
    try {
      const btn = await confirmMsg.awaitMessageComponent({ filter, time: 30_000 });

      if (btn.customId.startsWith('unlink_confirm')) {
        db.removeLink(interaction.user.id);
        db.audit({
          action: 'LINK_REMOVE',
          targetDiscordId: interaction.user.id,
          targetRiotId: `${existing.riot_name}#${existing.riot_tag}`,
          performedBy: interaction.user.id,
          guildId: interaction.guildId,
          details: { selfRemoval: true },
        });
        await btn.update({
          embeds: [embed.success('Account Unlinked', `**${existing.riot_name}#${existing.riot_tag}** has been unlinked from your Discord profile.`)],
          components: [],
        });
      } else {
        await btn.update({
          embeds: [embed.info('Cancelled', 'Your account link has not been changed.')],
          components: [],
        });
      }
    } catch {
      // Timed out
      await interaction.editReply({
        embeds: [embed.info('Timed Out', 'Unlink confirmation expired.')],
        components: [],
      });
    }
  },
};

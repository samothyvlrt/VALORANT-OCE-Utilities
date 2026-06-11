const { Events, InteractionType } = require('discord.js');
const embed = require('../utils/embed');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) {
        console.warn(`[interaction] Unknown command: ${interaction.commandName}`);
        return;
      }
      try {
        await command.execute(interaction);
      } catch (err) {
        console.error(`[interaction] Error in /${interaction.commandName}:`, err);
        const errEmbed = embed.error('Unexpected Error', 'Something went wrong. Please try again.');
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ embeds: [errEmbed] }).catch(() => {});
        } else {
          await interaction.reply({ embeds: [errEmbed], ephemeral: true }).catch(() => {});
        }
      }
      return;
    }

    // Button interactions (used by /unlink confirm/cancel)
    if (interaction.isButton()) {
      // These are handled by collectors inside each command — nothing to do here.
      return;
    }
  },
};

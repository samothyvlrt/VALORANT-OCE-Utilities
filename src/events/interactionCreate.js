const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const embed   = require('../utils/embed');
const config  = require('../../config');
const db      = require('../modules/database');
const { assignRankRole, removeAllRankRoles } = require('../utils/roles');
const { getRank } = require('../modules/riot-api');
const { startChallenge, VerificationError } = require('../modules/verification');
const { RiotApiError } = require('../modules/riot-api');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {

    // ── Server lock ──────────────────────────────────────────────
    if (config.discord.allowedGuildIds.length && !config.discord.allowedGuildIds.includes(interaction.guildId)) return;

    // ── Slash commands ───────────────────────────────────────────
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

    // ── Buttons ──────────────────────────────────────────────────
    if (interaction.isButton()) {
      const { customId } = interaction;

      // Link button — show Riot ID modal
      if (customId === 'link_btn') {
        const modal = new ModalBuilder()
          .setCustomId('link_modal')
          .setTitle('Link your Valorant Account');

        const riotIdInput = new TextInputBuilder()
          .setCustomId('riot_id')
          .setLabel('Riot ID')
          .setPlaceholder('Name#TAG  e.g. Aceship#OCE')
          .setStyle(TextInputStyle.Short)
          .setMinLength(3)
          .setMaxLength(64)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(riotIdInput));
        await interaction.showModal(modal);
        return;
      }

      // Update Rank button
      if (customId === 'update_rank_btn') {
        await interaction.deferReply({ ephemeral: true });
        const link = db.getLinkByDiscord(interaction.user.id);

        if (!link) {
          return interaction.editReply({
            embeds: [embed.warning('Not Linked', "You haven't linked a Riot account yet. Use the **Link** button to get started.")],
          });
        }

        const rank = await getRank(link.riot_name, link.riot_tag, link.region).catch(() => null);

        if (!rank) {
          return interaction.editReply({
            embeds: [embed.error('Rank Unavailable', 'Could not fetch your rank. Please try again later.')],
          });
        }

        // Update rank cache
        db.updateRankCache(link.discord_id, rank);

        // Assign rank role
        try {
          const guild  = interaction.guild ?? await interaction.client.guilds.fetch(config.discord.guildId);
          const member = await guild.members.fetch(interaction.user.id);
          await assignRankRole(member, rank.tier);
        } catch (err) {
          console.error('[update_rank_btn] role assignment error:', err);
        }

        const rankStr = rank.tier > 0 ? `**${rank.tierName}** — ${rank.rr} RR` : 'Unranked';
        return interaction.editReply({
          embeds: [embed.success('Rank Updated', `Your rank role has been updated.\nCurrent rank: ${rankStr}`)],
        });
      }

      // Unlink button
      if (customId === 'unlink_btn') {
        await interaction.deferReply({ ephemeral: true });
        const link = db.getLinkByDiscord(interaction.user.id);

        if (!link) {
          return interaction.editReply({
            embeds: [embed.warning('Not Linked', "You don't have a linked Riot account.")],
          });
        }

        db.removeLink(interaction.user.id);
        db.audit({
          action:          'LINK_REMOVE_SELF',
          targetDiscordId: interaction.user.id,
          targetRiotId:    `${link.riot_name}#${link.riot_tag}`,
          performedBy:     interaction.user.id,
          guildId:         interaction.guildId,
          details:         { method: 'panel_button' },
        });

        // Strip rank roles
        try {
          const guild  = interaction.guild ?? await interaction.client.guilds.fetch(config.discord.guildId);
          const member = await guild.members.fetch(interaction.user.id);
          await removeAllRankRoles(member);
        } catch (err) {
          console.error('[unlink_btn] role removal error:', err);
        }

        return interaction.editReply({
          embeds: [embed.success('Unlinked', `**${link.riot_name}#${link.riot_tag}** has been unlinked from your Discord account.`)],
        });
      }

      return;
    }

    // ── Modal submissions ────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'link_modal') {
        await interaction.deferReply({ ephemeral: true });
        const riotId = interaction.fields.getTextInputValue('riot_id');

        try {
          const challenge = await startChallenge(interaction.user.id, riotId, config.riot.defaultRegion);
          const expiresTs = Math.floor(challenge.expiresAt / 1000);

          const instructions = embed
            .primary(
              '🔗 Verify Account Ownership',
              [
                `Account found: **${challenge.riotName}#${challenge.riotTag}** (${challenge.region.toUpperCase()})`,
                `Level **${challenge.accountLevel}**`,
                ``,
                `To prove you own this account:`,
                ``,
                `> 1. Make sure **${challenge.riotName}#${challenge.riotTag}** is connected in **Discord Settings → Connections → Riot Games**`,
                `> 2. Click the verification link sent to your **DMs**`,
                `> 3. Hit **Authorize** — you'll be verified instantly`,
                ``,
                `⏰ Link expires <t:${expiresTs}:R>`,
              ].join('\n'),
            )
            .setColor(config.colors.primary);

          if (challenge.cardUrl) instructions.setThumbnail(challenge.cardUrl);
          await interaction.editReply({ embeds: [instructions] });

          // DM the OAuth link
          try {
            const dm = await interaction.user.createDM();
            await dm.send({
              embeds: [
                embed
                  .primary(
                    '🔗 Verify your Valorant account',
                    [
                      `You asked to link **${challenge.riotName}#${challenge.riotTag}** to your Discord.`,
                      ``,
                      `**[Click here to verify →](${challenge.oauthUrl})**`,
                      ``,
                      `This opens a Discord authorization screen. Hit **Authorize** and you're done.`,
                      ``,
                      `⏰ Expires <t:${expiresTs}:R>`,
                    ].join('\n'),
                  )
                  .setColor(config.colors.primary),
              ],
            });
          } catch {
            await interaction.followUp({
              embeds: [embed.warning('DMs Closed', `[Click here to verify →](${challenge.oauthUrl})\n\n⏰ Expires <t:${expiresTs}:R>`)],
              ephemeral: true,
            }).catch(() => {});
          }

        } catch (err) {
          if (err instanceof VerificationError || err instanceof RiotApiError) {
            return interaction.editReply({ embeds: [embed.error('Failed', err.message)] });
          }
          console.error('[link_modal]', err);
          return interaction.editReply({ embeds: [embed.error('Unexpected Error', 'Something went wrong. Please try again.')] });
        }
      }
      return;
    }
  },
};

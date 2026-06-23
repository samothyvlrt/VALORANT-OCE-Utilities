const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const { getSortedEntries, buildLeaderboardPage, buildLeaderboardAttachment, buildRow, PAGE_SIZE } = require('../commands/user/leaderboard');
const embed   = require('../utils/embed');
const config  = require('../../config');
const db      = require('../modules/database');
const { assignRankRole, removeAllRankRoles } = require('../utils/roles');
const { getRank, getAccount, RiotApiError } = require('../modules/riot-api');
const { startChallenge, VerificationError } = require('../modules/verification');
const { isRestricted, isBypass, ALWAYS_ALLOWED } = require('../utils/permissions');
const { logAdminAction } = require('../utils/activity-log');

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

      // ── Restricted gate ──────────────────────────────────────────
      // Restricted members may only run the always-allowed commands
      // (lock / unlock). Bypass users are exempt.
      if (
        isRestricted(interaction.member) &&
        !ALWAYS_ALLOWED.has(interaction.commandName) &&
        !isBypass(interaction.user.id)
      ) {
        return interaction.reply({
          embeds: [embed.error('Restricted', 'You are not permitted to use this command.')],
          ephemeral: true,
        }).catch(() => {});
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
        if (isRestricted(interaction.member)) {
          return interaction.reply({
            embeds: [embed.error('Linking Restricted', 'You are not permitted to link a Valorant account. Please contact a moderator if you believe this is a mistake.')],
            ephemeral: true,
          });
        }

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

        // ── Stage 1: show checking state ───────────────────────────────────
        const stageEmbed = (desc) => new EmbedBuilder()
          .setColor(0x5865F2)
          .setDescription(desc)
          .setFooter({ text: 'Valorant OCE Utilities' });

        await interaction.editReply({
          embeds: [stageEmbed('🔍 **Checking your account…**\nVerifying your Discord connection')],
        });

        // ── Check Discord connections for account swap ─────────────────────
        let verifiedAccount = null;
        const tokens = db.getTokens(interaction.user.id);
        if (tokens?.discord_access_token) {
          try {
            let accessToken = tokens.discord_access_token;

            // Refresh if expired
            if (tokens.discord_token_expires_at && Date.now() > tokens.discord_token_expires_at) {
              const refreshRes = await fetch('https://discord.com/api/oauth2/token', {
                method:  'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  client_id:     config.discord.clientId,
                  client_secret: config.oauth.clientSecret,
                  grant_type:    'refresh_token',
                  refresh_token: tokens.discord_refresh_token,
                }),
              });
              const refreshData = await refreshRes.json();
              if (refreshData.access_token) {
                accessToken = refreshData.access_token;
                db.updateTokens(interaction.user.id, {
                  accessToken:  refreshData.access_token,
                  refreshToken: refreshData.refresh_token,
                  expiresAt:    Date.now() + ((refreshData.expires_in ?? 604800) * 1000),
                });
              }
            }

            // Fetch current Discord connections
            const connRes     = await fetch('https://discord.com/api/users/@me/connections', {
              headers: { Authorization: `Bearer ${accessToken}` },
            });
            const connections = await connRes.json();

            if (Array.isArray(connections)) {
              const riotConn = connections.find((c) => c.type === 'riotgames');

              if (!riotConn) {
                return interaction.editReply({
                  embeds: [embed.warning('Riot Account Disconnected',
                    `You no longer have a Riot account connected in Discord.\n\n` +
                    `Go to **Discord Settings → Connections → Riot Games**, reconnect your account, then use the **Link** button to re-link.`,
                  )],
                });
              }

              const [connName, connTag] = riotConn.name.split('#');
              if (connName && connTag) {
                const currentAccount = await getAccount(connName, connTag, link.region).catch(() => null);
                if (currentAccount && currentAccount.puuid !== link.riot_puuid) {
                  return interaction.editReply({
                    embeds: [embed.warning('Different Account Detected',
                      `Your Discord connections now show **${riotConn.name}**, but your bot link is still for **${link.riot_name}#${link.riot_tag}**.\n\n` +
                      `Use the **Link** button to re-link with your new account.`,
                    )],
                  });
                }

                // Name/tag changed but same PUUID — silently update
                if (currentAccount && (currentAccount.name !== link.riot_name || currentAccount.tag !== link.riot_tag)) {
                  db.updateLinkRiotId(interaction.user.id, currentAccount.name, currentAccount.tag);
                }

                verifiedAccount = riotConn.name;
              }
            }
          } catch (err) {
            console.error('[update_rank_btn] connection check error:', err);
            // Gracefully continue
          }
        }

        // ── Stage 2: connection verified, now fetching rank ────────────────
        const accountLabel = verifiedAccount ?? `${link.riot_name}#${link.riot_tag}`;
        await interaction.editReply({
          embeds: [stageEmbed(`📡 **Fetching your rank…**\n${accountLabel} ✓`)],
        });

        // ──────────────────────────────────────────────────────────────────
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

        // ── Final: success with verified badge ─────────────────────────────
        const rankStr = rank.tier > 0 ? `**${rank.tierName}** — ${rank.rr} RR` : 'Unranked';
        const successEmbed = embed.success('Rank Updated', `Your rank role has been updated.\nCurrent rank: ${rankStr}`);
        if (verifiedAccount) {
          successEmbed.addFields(
            { name: 'Account', value: `${accountLabel} ✓`, inline: true },
            { name: 'Verified', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
          );
        }
        return interaction.editReply({ embeds: [successEmbed] });
      }

      // Leaderboard pagination
      if (customId.startsWith('leaderboard_page_')) {
        const page = parseInt(customId.slice('leaderboard_page_'.length), 10);
        if (isNaN(page) || page < 0) return;

        await interaction.deferUpdate();

        const entries     = getSortedEntries();
        const totalPages  = Math.ceil(entries.length / PAGE_SIZE);
        const clampedPage = Math.max(0, Math.min(page, totalPages - 1));

        const attachment = buildLeaderboardAttachment(entries, interaction.user.id);
        const e          = buildLeaderboardPage(entries, clampedPage, totalPages, entries.length, interaction.user.id);
        const row        = buildRow(clampedPage, totalPages);

        return interaction.editReply({
          embeds:     [e],
          files:      [attachment],
          components: totalPages > 1 ? [row] : [],
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

        logAdminAction(interaction.client, {
          action:    'Account Unlinked',
          moderator: interaction.user,
          fields:    { 'Riot ID': `${link.riot_name}#${link.riot_tag}`, Method: 'Panel button' },
          guildId:   interaction.guildId,
        });

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

        if (isRestricted(interaction.member)) {
          return interaction.editReply({
            embeds: [embed.error('Linking Restricted', 'You are not permitted to link a Valorant account. Please contact a moderator if you believe this is a mistake.')],
          });
        }

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

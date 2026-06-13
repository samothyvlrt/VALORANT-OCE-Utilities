const { SlashCommandBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const { startChallenge, VerificationError } = require('../../modules/verification');
const { RiotApiError } = require('../../modules/riot-api');
const { isRestricted } = require('../../utils/permissions');
const { logAdminAction } = require('../../utils/activity-log');
const config = require('../../../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Riot account to your Discord profile.')
    .addStringOption((opt) =>
      opt
        .setName('riot_id')
        .setDescription('Your Riot ID, e.g. Aceship#OCE')
        .setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('region')
        .setDescription('Your Valorant region (default: ap)')
        .setRequired(false)
        .addChoices(
          { name: 'Asia-Pacific (AP / OCE)', value: 'ap' },
          { name: 'North America (NA)',       value: 'na' },
          { name: 'Europe (EU)',              value: 'eu' },
          { name: 'Latin America (LATAM)',    value: 'latam' },
          { name: 'Brazil (BR)',              value: 'br' },
          { name: 'Korea (KR)',               value: 'kr'  },
        ),
    ),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    if (isRestricted(interaction.member)) {
      return interaction.editReply({
        embeds: [embed.error('Linking Restricted', 'You are not permitted to link a Valorant account. Please contact a moderator if you believe this is a mistake.')],
      });
    }

    const riotId = interaction.options.getString('riot_id');
    const region = interaction.options.getString('region') || config.riot.defaultRegion;

    try {
      const challenge = await startChallenge(interaction.user.id, riotId, region);
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

      // DM the user their private OAuth link
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
        // DMs are closed — put the link directly in the ephemeral reply
        await interaction.editReply({
          embeds: [
            embed.warning(
              '⚠️ Could not send you a DM',
              [
                `Please enable DMs from server members so I can send you verification links privately.`,
                ``,
                `In the meantime, use this link (keep it private — it's tied to your account):`,
                `**[Verify here →](${challenge.oauthUrl})**`,
                ``,
                `⏰ Expires <t:${expiresTs}:R>`,
              ].join('\n'),
            ),
          ],
        });
      }

    } catch (err) {
      if (err instanceof VerificationError || err instanceof RiotApiError) {
        // Log to staff channel when someone tries to claim an account already linked to another user
        if (err.code === 'RIOT_ALREADY_LINKED') {
          logAdminAction(interaction.client, {
            action:  'Duplicate Link Attempt',
            fields:  {
              'Claimant':       `<@${err.claimantDiscordId}>`,
              'Riot ID':        err.riotId,
              'Currently Owned By': `<@${err.ownerDiscordId}>`,
            },
            guildId: config.discord.guildId,
          });
        }
        return interaction.editReply({ embeds: [embed.error('Link Failed', err.message)] });
      }
      console.error('[link]', err);
      return interaction.editReply({
        embeds: [embed.error('Unexpected Error', 'Something went wrong. Please try again in a moment.')],
      });
    }
  },
};

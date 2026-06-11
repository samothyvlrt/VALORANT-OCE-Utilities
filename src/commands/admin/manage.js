/**
 * /admin link — all admin link management subcommands.
 *
 * Subcommands:
 *   get <user>              — show a user's link
 *   remove <user>           — force-remove a user's link
 *   set <user> <riot_id>    — force-set a user's link (no ownership challenge)
 *   reset <user>            — invalidate link and require re-verification
 *   list [role]             — list all linked members in the server (optionally filtered by role)
 *   bulk-reset <role>       — force re-verify for every member of a role
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const embed = require('../../utils/embed');
const db = require('../../modules/database');
const { adminForceLink, VerificationError } = require('../../modules/verification');
const { RiotApiError } = require('../../modules/riot-api');
const { isAdmin } = require('../../utils/permissions');
const config = require('../../../config');

const ITEMS_PER_PAGE = 20;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin commands for managing Riot account links.')

    // ── get ──────────────────────────────────────────────────────
    .addSubcommandGroup((grp) =>
      grp
        .setName('link')
        .setDescription('Manage user account links.')

        .addSubcommand((sub) =>
          sub
            .setName('get')
            .setDescription("View a member's linked Riot account.")
            .addUserOption((opt) =>
              opt.setName('user').setDescription('Discord member').setRequired(true),
            ),
        )

        // ── remove ───────────────────────────────────────────────
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription("Force-remove a member's linked Riot account.")
            .addUserOption((opt) =>
              opt.setName('user').setDescription('Discord member').setRequired(true),
            )
            .addStringOption((opt) =>
              opt.setName('reason').setDescription('Audit reason (optional)').setRequired(false),
            )
            .addBooleanOption((opt) =>
              opt.setName('silent').setDescription('If true, the user will NOT be sent a DM (default: false)').setRequired(false),
            ),
        )

        // ── set ──────────────────────────────────────────────────
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription("Force-set a member's linked Riot account (bypasses verification).")
            .addUserOption((opt) =>
              opt.setName('user').setDescription('Discord member').setRequired(true),
            )
            .addStringOption((opt) =>
              opt.setName('riot_id').setDescription('Riot ID e.g. Aceship#OCE').setRequired(true),
            )
            .addStringOption((opt) =>
              opt
                .setName('region')
                .setDescription('Valorant region')
                .setRequired(false)
                .addChoices(
                  { name: 'Asia-Pacific (AP / OCE)', value: 'ap' },
                  { name: 'North America (NA)', value: 'na' },
                  { name: 'Europe (EU)', value: 'eu' },
                  { name: 'Latin America (LATAM)', value: 'latam' },
                  { name: 'Brazil (BR)', value: 'br' },
                  { name: 'Korea (KR)', value: 'kr' },
                ),
            )
            .addBooleanOption((opt) =>
              opt.setName('silent').setDescription('If true, the user will NOT be sent a DM (default: false)').setRequired(false),
            ),
        )

        // ── reset ────────────────────────────────────────────────
        .addSubcommand((sub) =>
          sub
            .setName('reset')
            .setDescription("Invalidate a member's link and require them to re-verify.")
            .addUserOption((opt) =>
              opt.setName('user').setDescription('Discord member').setRequired(true),
            )
            .addStringOption((opt) =>
              opt.setName('reason').setDescription('Reason shown to the user (optional)').setRequired(false),
            )
            .addBooleanOption((opt) =>
              opt.setName('silent').setDescription('If true, the user will NOT be sent a DM (default: false)').setRequired(false),
            ),
        )

        // ── list ─────────────────────────────────────────────────
        .addSubcommand((sub) =>
          sub
            .setName('list')
            .setDescription('List all linked members in this server, optionally filtered by role.')
            .addRoleOption((opt) =>
              opt.setName('role').setDescription('Filter by role (optional)').setRequired(false),
            )
            .addIntegerOption((opt) =>
              opt.setName('page').setDescription('Page number (default: 1)').setRequired(false).setMinValue(1),
            ),
        )

        // ── bulk-reset ───────────────────────────────────────────
        .addSubcommand((sub) =>
          sub
            .setName('bulk-reset')
            .setDescription('Force all members of a role to re-verify their linked accounts.')
            .addRoleOption((opt) =>
              opt.setName('role').setDescription('Role to reset').setRequired(true),
            )
            .addStringOption((opt) =>
              opt.setName('reason').setDescription('Reason for bulk reset (optional)').setRequired(false),
            )
            .addBooleanOption((opt) =>
              opt.setName('silent').setDescription('If true, affected users will NOT be sent a DM (default: false)').setRequired(false),
            ),
        ),
    ),

  // ─────────────────────────────────────────────
  async execute(interaction) {
    if (!isAdmin(interaction.member)) {
      return interaction.reply({
        embeds: [embed.error('Access Denied', 'You need administrator permissions or an admin role to use this command.')],
        ephemeral: true,
      });
    }

    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case 'get':       return handleGet(interaction);
      case 'remove':    return handleRemove(interaction);
      case 'set':       return handleSet(interaction);
      case 'reset':     return handleReset(interaction);
      case 'list':      return handleList(interaction);
      case 'bulk-reset': return handleBulkReset(interaction);
      default:
        return interaction.reply({ embeds: [embed.error('Unknown subcommand', sub)], ephemeral: true });
    }
  },
};

// ─────────────────────────────────────────────
// get
// ─────────────────────────────────────────────
async function handleGet(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const target = interaction.options.getUser('user');
  const link = db.getLinkByDiscord(target.id);

  if (!link) {
    return interaction.editReply({
      embeds: [embed.warning('No Link', `<@${target.id}> has no linked Riot account.`)],
    });
  }

  const history = db.getLinkHistory(target.id);

  // Build history field — Riot ID, PUUID, timestamp per entry
  let historyValue = '*No history recorded*';
  if (history.length) {
    historyValue = history.map((row) => {
      const details = row.details ? JSON.parse(row.details) : {};
      const puuid   = details.puuid ?? '—';
      const label   = row.action === 'ADMIN_LINK_SET' ? ' *(admin set)*' : '';
      return `**${row.target_riot_id}**${label} · <t:${Math.floor(row.timestamp / 1000)}:f>\n\`${puuid}\``;
    }).join('\n');
  }

  const e = new EmbedBuilder()
    .setColor(config.colors.info)
    .setTitle(`Link info — ${link.riot_name}#${link.riot_tag}`)
    .setFooter({ text: 'VALORANT OCE Utilities' })
    .setTimestamp()
    .addFields(
      { name: 'Discord',      value: `<@${link.discord_id}> (${link.discord_id})`, inline: false },
      { name: 'Riot ID',      value: `${link.riot_name}#${link.riot_tag}`,         inline: true  },
      { name: 'Region',       value: link.region.toUpperCase(),                    inline: true  },
      { name: 'PUUID',        value: `\`${link.riot_puuid}\``,                     inline: false },
      { name: 'Linked',       value: `<t:${Math.floor(link.linked_at    / 1000)}:F>`, inline: true },
      { name: 'Last Updated', value: `<t:${Math.floor(link.last_updated / 1000)}:R>`, inline: true },
      { name: 'Link History (last 5)', value: historyValue, inline: false },
    );

  await interaction.editReply({ embeds: [e] });
}

// ─────────────────────────────────────────────
// remove
// ─────────────────────────────────────────────
async function handleRemove(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const silent = interaction.options.getBoolean('silent') ?? false;
  const link   = db.getLinkByDiscord(target.id);

  if (!link) {
    return interaction.editReply({
      embeds: [embed.warning('No Link', `<@${target.id}> has no linked Riot account.`)],
    });
  }

  db.removeLink(target.id);
  db.audit({
    action: 'ADMIN_LINK_REMOVE',
    targetDiscordId: target.id,
    targetRiotId: `${link.riot_name}#${link.riot_tag}`,
    performedBy: interaction.user.id,
    guildId: interaction.guildId,
    details: { reason, silent },
  });

  if (!silent) {
    try {
      const dm = await target.createDM();
      await dm.send({
        embeds: [
          embed.warning(
            'Riot Account Link Removed',
            [
              `Your linked Riot account (**${link.riot_name}#${link.riot_tag}**) has been removed by a moderator.`,
              ``,
              `**Reason:** ${reason}`,
              ``,
              `You can run \`/link\` to link a new account.`,
            ].join('\n'),
          ),
        ],
      });
    } catch { /* DMs closed — silently continue */ }
  }

  await interaction.editReply({
    embeds: [
      embed.success(
        'Link Removed',
        `Removed link for <@${target.id}> (**${link.riot_name}#${link.riot_tag}**).\nReason: ${reason}`,
      ),
    ],
  });
}

// ─────────────────────────────────────────────
// set
// ─────────────────────────────────────────────
async function handleSet(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const target = interaction.options.getUser('user');
  const riotId = interaction.options.getString('riot_id');
  const region = interaction.options.getString('region') || config.riot.defaultRegion;
  const silent = interaction.options.getBoolean('silent') ?? false;

  try {
    const result = await adminForceLink(target.id, riotId, region, interaction.user.id, interaction.guildId);

    if (!silent) {
      try {
        const dm = await target.createDM();
        await dm.send({
          embeds: [
            embed.info(
              'Riot Account Linked by Admin',
              [
                `A moderator has linked your Discord account to **${result.riotName}#${result.riotTag}** (${result.region.toUpperCase()}).`,
                ``,
                `If this is incorrect, please contact a moderator.`,
              ].join('\n'),
            ),
          ],
        });
      } catch { /* DMs closed — silently continue */ }
    }

    await interaction.editReply({
      embeds: [
        embed.success(
          'Link Set',
          `<@${target.id}> is now linked to **${result.riotName}#${result.riotTag}** (${result.region.toUpperCase()}).\n\nThis was set without an ownership challenge.`,
        ),
      ],
    });
  } catch (err) {
    if (err instanceof VerificationError || err instanceof RiotApiError) {
      return interaction.editReply({ embeds: [embed.error('Failed', err.message)] });
    }
    console.error('[admin link set]', err);
    interaction.editReply({ embeds: [embed.error('Unexpected Error', 'Something went wrong.')] });
  }
}

// ─────────────────────────────────────────────
// reset
// ─────────────────────────────────────────────
async function handleReset(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const target = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'Season reset / admin request';
  const silent = interaction.options.getBoolean('silent') ?? false;
  const link   = db.getLinkByDiscord(target.id);

  if (!link) {
    return interaction.editReply({
      embeds: [embed.warning('No Link', `<@${target.id}> has no linked Riot account to reset.`)],
    });
  }

  // Removing the link forces the user to re-run /link and /verify
  db.removeLink(target.id);
  db.audit({
    action: 'ADMIN_LINK_RESET',
    targetDiscordId: target.id,
    targetRiotId: `${link.riot_name}#${link.riot_tag}`,
    performedBy: interaction.user.id,
    guildId: interaction.guildId,
    details: { reason },
  });

  if (!silent) {
    try {
      const dmChannel = await target.createDM();
      await dmChannel.send({
        embeds: [
          embed.warning(
            'Account Re-Verification Required',
            [
              `Your linked Riot account (**${link.riot_name}#${link.riot_tag}**) has been reset by a moderator in a server you share with this bot.`,
              ``,
              `**Reason:** ${reason}`,
              ``,
              `Please run \`/link\` again to re-link and verify your account.`,
            ].join('\n'),
          ),
        ],
      });
    } catch { /* DMs may be closed — silently continue */ }
  }

  await interaction.editReply({
    embeds: [
      embed.success(
        'Link Reset',
        `Reset link for <@${target.id}> (**${link.riot_name}#${link.riot_tag}**).\nThey will need to re-run \`/link\` to reverify.\nReason: ${reason}`,
      ),
    ],
  });
}

// ─────────────────────────────────────────────
// list
// ─────────────────────────────────────────────
async function handleList(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const role = interaction.options.getRole('role');
  const page = (interaction.options.getInteger('page') || 1) - 1; // 0-indexed

  // Fetch all members with their links
  let members;
  try {
    await interaction.guild.members.fetch();
    members = interaction.guild.members.cache;
  } catch {
    return interaction.editReply({ embeds: [embed.error('Failed', 'Could not fetch guild members.')] });
  }

  // Filter by role if provided
  const targetMembers = role
    ? members.filter((m) => m.roles.cache.has(role.id))
    : members;

  const discordIds = targetMembers.map((m) => m.id);
  const links = db.getLinksByDiscordIds(discordIds);

  if (!links.length) {
    return interaction.editReply({
      embeds: [embed.info('No Links', role ? `No linked accounts found for **@${role.name}**.` : 'No linked accounts found in this server.')],
    });
  }

  const totalPages = Math.ceil(links.length / ITEMS_PER_PAGE);
  const pageLinks = links.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  const rows = pageLinks.map((l, i) => {
    const num = page * ITEMS_PER_PAGE + i + 1;
    return `\`${String(num).padStart(3)}\` <@${l.discord_id}> — **${l.riot_name}#${l.riot_tag}** (${l.region.toUpperCase()})`;
  });

  const e = new EmbedBuilder()
    .setColor(config.colors.info)
    .setTitle(`Linked Accounts${role ? ` — @${role.name}` : ''}`)
    .setDescription(rows.join('\n'))
    .setFooter({ text: `Page ${page + 1}/${totalPages} · ${links.length} total linked` })
    .setTimestamp();

  await interaction.editReply({ embeds: [e] });
}

// ─────────────────────────────────────────────
// bulk-reset
// ─────────────────────────────────────────────
async function handleBulkReset(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const role   = interaction.options.getRole('role');
  const reason = interaction.options.getString('reason') || 'Season reset';
  const silent = interaction.options.getBoolean('silent') ?? false;

  await interaction.guild.members.fetch();
  const roleMembers = interaction.guild.members.cache.filter((m) => m.roles.cache.has(role.id));
  const discordIds = roleMembers.map((m) => m.id);
  const links = db.getLinksByDiscordIds(discordIds);

  if (!links.length) {
    return interaction.editReply({
      embeds: [embed.info('Nothing to Reset', `No linked accounts found for **@${role.name}**.`)],
    });
  }

  let removed = 0;
  let dmFailed = 0;

  for (const link of links) {
    db.removeLink(link.discord_id);
    db.audit({
      action: 'ADMIN_BULK_RESET',
      targetDiscordId: link.discord_id,
      targetRiotId: `${link.riot_name}#${link.riot_tag}`,
      performedBy: interaction.user.id,
      guildId: interaction.guildId,
      details: { reason, role: role.id, silent },
    });
    removed++;

    if (!silent) {
      try {
        const member = roleMembers.get(link.discord_id);
        if (member) {
          const dm = await member.createDM();
          await dm.send({
            embeds: [
              embed.warning(
                'Account Re-Verification Required',
                [
                  `Your linked Riot account (**${link.riot_name}#${link.riot_tag}**) has been reset as part of a bulk season reset.`,
                  ``,
                  `**Reason:** ${reason}`,
                  ``,
                  `Please run \`/link\` to re-link and verify your account.`,
                ].join('\n'),
              ),
            ],
          });
        }
      } catch {
        dmFailed++;
      }
    }
  }

  await interaction.editReply({
    embeds: [
      embed.success(
        'Bulk Reset Complete',
        [
          `Reset **${removed}** linked account${removed !== 1 ? 's' : ''} for members with **@${role.name}**.`,
          silent ? `DMs: silent (not sent)` : `DM failures: ${dmFailed} (members with DMs closed)`,
          ``,
          `Reason: ${reason}`,
          ``,
          `Affected members will need to run \`/link\` to re-verify.`,
        ].join('\n'),
      ),
    ],
  });
}

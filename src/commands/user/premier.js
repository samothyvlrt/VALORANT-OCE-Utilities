/**
 * /premier — Premier team registration + team card.
 *
 * `/premier link` (no arguments) auto-discovers the user's team from their
 * most recent Premier match: the v4 match payload carries both premier
 * rosters incl. member PUUIDs, so finding the user's PUUID in a roster is
 * hard proof of membership (Riot no longer exposes rosters on the team
 * endpoints themselves). The optional `team` argument is a fallback for
 * players who haven't played a Premier match yet — that path is only
 * validated against the live team list and stored as UNVERIFIED.
 *
 * The team ID is stored on their linked_accounts row. `/premier team`
 * renders a live card, and `/lfg` Premier mode auto-derives the division
 * from the stored team.
 */
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const embed  = require('../../utils/embed');
const db     = require('../../modules/database');
const config = require('../../../config');
const {
  parseRiotId,
  searchPremierTeams,
  getPremierTeam,
  getPremierHistory,
  discoverPremierTeam,
  premierDivisionName,
  RiotApiError,
} = require('../../modules/riot-api');

/** "AP_OCEANIA_SUPER" → "Oceania (Super)". */
function formatConference(conference) {
  if (!conference) return '—';
  const isSuper = conference.endsWith('_SUPER');
  const core = conference
    .replace(/_SUPER$/, '')
    .replace(/^(AP|NA|EU|KR|BR|LATAM)_/, '')
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
  return isSuper ? `${core} (Super)` : core;
}

/** Premier scoring: a win is worth 100 points, a loss 25. */
function matchResultLine(m) {
  const delta = (m.points_after ?? 0) - (m.points_before ?? 0);
  const icon  = delta >= 100 ? '🟩' : '🟥';
  const when  = m.started_at ? `<t:${Math.floor(new Date(m.started_at).getTime() / 1000)}:d>` : '';
  return `${icon} +${delta} pts ${when}`;
}

/** Build the team card embed from live team details (+ optional history). */
function buildTeamCard(team, history) {
  const placement = team.placement ?? {};
  const stats     = team.stats ?? {};
  const division  = placement.division != null ? premierDivisionName(placement.division) : '—';

  const e = new EmbedBuilder()
    .setTitle(`${team.name}#${team.tag} — Premier`)
    .setFooter({ text: 'Valorant OCE Utilities · Premier' })
    .setTimestamp()
    .addFields(
      { name: 'Division',   value: `**${division}**`,                          inline: true },
      { name: 'Conference', value: formatConference(placement.conference),     inline: true },
      { name: 'Points',     value: `${placement.points ?? 0}`,                 inline: true },
      { name: 'Record',     value: `**${stats.wins ?? 0}W – ${stats.losses ?? 0}L**`, inline: true },
      { name: 'Rounds',     value: `${stats.rounds_won ?? 0} / ${stats.rounds_lost ?? 0}`, inline: true },
      ...(placement.place > 0
        ? [{ name: 'Place', value: `#${placement.place}`, inline: true }]
        : [{ name: '​', value: '​', inline: true }]),
    );

  const recent = (history?.league_matches ?? []).slice(-5).reverse();
  if (recent.length) {
    e.addFields({ name: 'Recent league matches', value: recent.map(matchResultLine).join('\n'), inline: false });
  }
  if (!team.enrolled) {
    e.addFields({ name: '​', value: '*Not enrolled in the current Premier season.*', inline: false });
  }

  const hex = team.customization?.primary;
  e.setColor(hex && /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : config.colors.primary);
  if (team.customization?.image) e.setThumbnail(team.customization.image);

  return e;
}

/**
 * Resolve a "Team#TAG" string to a single AP-affinity Premier team summary.
 * Throws RiotApiError with a user-facing message when not found/ambiguous.
 */
async function resolveTeam(input) {
  const { name, tag } = parseRiotId(input);
  const results = await searchPremierTeams(name, tag);
  if (!results.length) {
    throw new RiotApiError(`No Premier team found matching \`${name}#${tag}\`. Check the exact team name and tag (Premier tab in-game).`, 404);
  }

  // This is an OCE community bot — only AP-affinity teams are eligible.
  const ap = results.filter((t) => (t.affinity ?? t.region) === 'ap');
  if (!ap.length) {
    throw new RiotApiError(`\`${name}#${tag}\` exists but not in the AP/OCE region.`, 404);
  }

  // Prefer an Oceania-conference team if the name collides across AP conferences.
  const oce = ap.filter((t) => (t.conference ?? '').startsWith('AP_OCEANIA'));
  const pool = oce.length ? oce : ap;
  if (pool.length > 1) {
    const list = pool.slice(0, 5).map((t) => `• ${t.name}#${t.tag} — ${formatConference(t.conference)}`).join('\n');
    throw new RiotApiError(`Multiple Premier teams match \`${name}#${tag}\`:\n${list}\nAsk the bot owner to link by team ID.`, 400);
  }
  return pool[0];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('premier')
    .setDescription('Valorant Premier — register your team and view team cards.')
    .addSubcommand((sc) =>
      sc.setName('link')
        .setDescription('Register your Premier team — auto-detected from your match history.')
        .addStringOption((o) =>
          o.setName('team').setDescription('Fallback if you haven\'t played a Premier match yet, e.g. "Team Name#TAG"').setRequired(false).setMaxLength(48),
        ),
    )
    .addSubcommand((sc) =>
      sc.setName('unlink').setDescription('Remove your registered Premier team.'),
    )
    .addSubcommand((sc) =>
      sc.setName('team')
        .setDescription('View a Premier team card (yours by default).')
        .addStringOption((o) =>
          o.setName('team').setDescription('Any Premier team, e.g. "Team Name#TAG" (default: your registered team)').setRequired(false).setMaxLength(48),
        )
        .addBooleanOption((o) =>
          o.setName('public').setDescription('Show the card publicly in this channel (default: only you can see it)').setRequired(false),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ── /premier link ───────────────────────────────────────────────────────
    if (sub === 'link') {
      await interaction.deferReply({ ephemeral: true });

      const link = db.getLinkByDiscord(interaction.user.id);
      if (!link) {
        return interaction.editReply({
          embeds: [embed.warning('No Account Linked', 'Link your Riot account with `/link` before registering a Premier team.')],
        });
      }

      // Primary path: auto-discover the team from their own Premier match
      // history — hard proof of membership, zero input needed.
      let team = null;
      try {
        team = await discoverPremierTeam(link.riot_puuid, link.region);
      } catch (err) {
        const msg = err instanceof RiotApiError ? err.message : 'Premier data is temporarily unavailable — try again shortly.';
        return interaction.editReply({ embeds: [embed.warning('Premier Unavailable', msg)] });
      }

      if (team) {
        db.setPremierTeam(interaction.user.id, team, true);
        return interaction.editReply({
          embeds: [embed.success(
            'Premier Team Verified',
            `Detected **${team.name}#${team.tag}** from your Premier match history — membership verified. ✅\n` +
            '`/lfg` Premier posts will now auto-fill your division, and `/premier team` shows your team card.\n' +
            '*Changed teams? Play a Premier match with the new team, then run `/premier link` again.*',
          )],
        });
      }

      // Fallback: no Premier matches on record. Accept a manually named team,
      // validated against the live team list, but stored as unverified.
      const teamInput = interaction.options.getString('team');
      if (!teamInput) {
        return interaction.editReply({
          embeds: [embed.warning(
            'No Premier Matches Found',
            'Your team is detected automatically from your Premier match history, but no Premier matches were found for your account.\n' +
            'Play a Premier match (league or practice) and run `/premier link` again — or provide the `team` option to register your team name provisionally (unverified).',
          )],
        });
      }

      try {
        team = await resolveTeam(teamInput);
      } catch (err) {
        const msg = err instanceof RiotApiError ? err.message : 'Premier data is temporarily unavailable — try again shortly.';
        return interaction.editReply({ embeds: [embed.warning('Team Not Found', msg)] });
      }

      db.setPremierTeam(interaction.user.id, team, false);

      const division = team.division != null ? premierDivisionName(team.division) : '—';
      return interaction.editReply({
        embeds: [embed.info(
          'Premier Team Registered (unverified)',
          `Registered **${team.name}#${team.tag}** (${division} · ${formatConference(team.conference)}).\n` +
          'Membership could not be verified — no Premier matches on your account yet. ' +
          'Once you play one, run `/premier link` again to verify automatically.',
        )],
      });
    }

    // ── /premier unlink ─────────────────────────────────────────────────────
    if (sub === 'unlink') {
      const removed = db.clearPremierTeam(interaction.user.id);
      return interaction.reply({
        embeds: [removed
          ? embed.success('Premier Team Removed', 'Your registered Premier team has been removed.')
          : embed.info('Nothing To Remove', 'You have no registered Premier team.')],
        ephemeral: true,
      });
    }

    // ── /premier team ───────────────────────────────────────────────────────
    const isPublic  = interaction.options.getBoolean('public') ?? false;
    const teamInput = interaction.options.getString('team');
    await interaction.deferReply({ ephemeral: !isPublic });

    let teamId = null;
    if (teamInput) {
      try {
        teamId = (await resolveTeam(teamInput)).id;
      } catch (err) {
        const msg = err instanceof RiotApiError ? err.message : 'Premier data is temporarily unavailable — try again shortly.';
        return interaction.editReply({ embeds: [embed.warning('Team Not Found', msg)] });
      }
    } else {
      const link = db.getLinkByDiscord(interaction.user.id);
      teamId = link?.premier_team_id ?? null;
      if (!teamId) {
        return interaction.editReply({
          embeds: [embed.info('No Premier Team', 'Register your team with `/premier link Team#TAG`, or view any team with the `team` option.')],
        });
      }
    }

    try {
      const [team, history] = await Promise.all([
        getPremierTeam(teamId),
        getPremierHistory(teamId).catch(() => null), // history is a nice-to-have
      ]);
      if (!team) {
        return interaction.editReply({
          embeds: [embed.warning('Team Unavailable', 'That Premier team no longer exists (it may have been disbanded). Re-register with `/premier link`.')],
        });
      }
      return interaction.editReply({ embeds: [buildTeamCard(team, history)] });
    } catch (err) {
      const msg = err instanceof RiotApiError ? err.message : 'Premier data is temporarily unavailable — try again shortly.';
      return interaction.editReply({ embeds: [embed.warning('Premier Unavailable', msg)] });
    }
  },
};

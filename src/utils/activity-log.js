const { EmbedBuilder } = require('discord.js');
const db     = require('../modules/database');
const config = require('../../config');

/**
 * Post an admin action to the configured staff log channel.
 * Silently does nothing if no log channel is set.
 *
 * @param {import('discord.js').Client} client
 * @param {object} opts
 * @param {string}  opts.action      — Human-readable action name e.g. "Link Set"
 * @param {import('discord.js').User} opts.moderator  — The admin who ran the command
 * @param {string}  [opts.target]    — Target user mention/name if applicable
 * @param {object}  [opts.fields]    — Extra key→value pairs to show in the embed
 * @param {string}  [opts.guildId]   — Guild the action was performed in
 */
async function logAdminAction(client, { action, moderator, target, fields = {}, guildId } = {}) {
  try {
    const channelId = db.getSetting('log_channel_id');
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) return;

    const moderatorValue = moderator
      ? `<@${moderator.id}> (${moderator.tag ?? moderator.username})`
      : 'System (automated)';

    const e = new EmbedBuilder()
      .setColor(config.colors.neutral)
      .setTitle(`🛡️ ${action}`)
      .setFooter({ text: 'Valorant OCE Utilities · Staff Log' })
      .setTimestamp()
      .addFields(
        { name: 'Moderator', value: moderatorValue, inline: true },
        ...(target ? [{ name: 'Target', value: target, inline: true }] : []),
        ...Object.entries(fields).map(([name, value]) => ({ name, value: String(value), inline: true })),
      );

    await channel.send({ embeds: [e] });
  } catch (err) {
    console.error('[activity-log] Failed to post log:', err);
  }
}

module.exports = { logAdminAction };

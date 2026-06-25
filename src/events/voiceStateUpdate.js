const { Events } = require('discord.js');
const vcLock = require('../modules/vc-lock');
const lfgPosts = require('../modules/lfg-posts');
const { renderLfg } = require('../commands/server/lfg');

module.exports = {
  name: Events.VoiceStateUpdate,

  async execute(oldState, newState) {
    const userId      = oldState.member?.id ?? newState.member?.id;
    const leftId      = oldState.channelId;
    const joinedId    = newState.channelId;

    // ── LFG live updates ────────────────────────────────────────────────────
    // Re-render any active LFG posts tied to a VC that just changed membership.
    const guild = newState.guild || oldState.guild;
    const affectedVcs = new Set([leftId, joinedId].filter(Boolean));
    for (const vcId of affectedVcs) {
      for (const [messageId, post] of lfgPosts.forVc(vcId)) {
        try {
          const channel = guild.channels.cache.get(post.channelId)
            || await guild.channels.fetch(post.channelId).catch(() => null);
          const msg = channel ? await channel.messages.fetch(messageId).catch(() => null) : null;
          if (!msg) { lfgPosts.remove(messageId); continue; }
          const rendered = renderLfg(guild, post);
          if (!rendered) { lfgPosts.remove(messageId); continue; }
          await msg.edit(rendered);
        } catch (err) {
          console.warn('[lfg] live update failed:', err.message);
        }
      }
    }

    if (!userId) return;

    // ── Member joined a locked channel ──────────────────────────────────────
    // Cancel their grace timer — they made it back in time.
    if (joinedId && joinedId !== leftId && vcLock.isLocked(joinedId)) {
      vcLock.cancelTimer(joinedId, userId);
    }

    // ── Member left a locked channel ─────────────────────────────────────────
    if (!leftId || leftId === joinedId) return;
    if (!vcLock.isLocked(leftId)) return;
    if (!vcLock.hasOverwrite(leftId, userId)) return; // not a locked-in member

    const channel = oldState.channel;
    if (!channel) return;

    console.log(`[vc-lock] ${userId} left locked channel ${channel.name} — starting 10-min grace timer`);

    vcLock.startTimer(leftId, userId, async () => {
      // Grace period expired — remove their Connect overwrite
      vcLock.removeOverwrite(leftId, userId);
      try {
        await channel.permissionOverwrites.delete(userId, 'Left locked VC — grace period expired');
        console.log(`[vc-lock] Removed overwrite for ${userId} in ${channel.name} (grace expired)`);
      } catch (err) {
        console.error(`[vc-lock] Failed to remove overwrite for ${userId}:`, err.message);
      }
    });
  },
};

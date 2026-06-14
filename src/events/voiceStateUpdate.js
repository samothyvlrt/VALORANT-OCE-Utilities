const { Events } = require('discord.js');
const vcLock = require('../modules/vc-lock');

module.exports = {
  name: Events.VoiceStateUpdate,

  async execute(oldState, newState) {
    const userId      = oldState.member?.id ?? newState.member?.id;
    const leftId      = oldState.channelId;
    const joinedId    = newState.channelId;

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

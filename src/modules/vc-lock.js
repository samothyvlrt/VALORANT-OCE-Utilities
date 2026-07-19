/**
 * In-memory state for locked voice channels.
 *
 * lockedChannels: Map<channelId, Set<userId>>
 *   Tracks which channels are locked and which members have an individual
 *   Allow Connect overwrite so they can reconnect.
 *
 * timers: Map<"channelId:userId", NodeJS.Timeout>
 *   10-minute reconnect grace timers. When a timer fires the member's
 *   individual overwrite is removed and they can no longer rejoin.
 */

const GRACE_MS = 10 * 60 * 1000; // 10 minutes

const lockedChannels = new Map();
const timers         = new Map();

/** Returns true if the channel is currently locked. */
function isLocked(channelId) {
  return lockedChannels.has(channelId);
}

/**
 * Mark a channel as locked with the given set of member IDs
 * who are allowed to reconnect.
 */
function lock(channelId, memberIds) {
  lockedChannels.set(channelId, new Set(memberIds));
}

/**
 * Unlock a channel — clears all state and cancels all pending timers.
 */
function unlock(channelId) {
  lockedChannels.delete(channelId);
  const prefix = `${channelId}:`;
  for (const key of [...timers.keys()]) {
    if (key.startsWith(prefix)) {
      clearTimeout(timers.get(key));
      timers.delete(key);
    }
  }
}

/** Returns true if userId has an Allow Connect overwrite in the locked channel. */
function hasOverwrite(channelId, userId) {
  return lockedChannels.get(channelId)?.has(userId) ?? false;
}

/** Add a member to the locked channel's allowed set (e.g. after they were manually re-admitted). */
function addOverwrite(channelId, userId) {
  lockedChannels.get(channelId)?.add(userId);
}

/** Remove a member from the locked channel's allowed set (called when their grace period expires). */
function removeOverwrite(channelId, userId) {
  lockedChannels.get(channelId)?.delete(userId);
}

/**
 * Start (or restart) the reconnect grace timer for a member.
 * onExpire is called after GRACE_MS if the timer isn't cancelled first.
 */
function startTimer(channelId, userId, onExpire) {
  const key = `${channelId}:${userId}`;
  clearTimeout(timers.get(key)); // cancel any existing timer for this member
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    onExpire();
  }, GRACE_MS));
}

/** Cancel the reconnect grace timer for a member (called when they rejoin). */
function cancelTimer(channelId, userId) {
  const key = `${channelId}:${userId}`;
  clearTimeout(timers.get(key));
  timers.delete(key);
}

/** Number of members still tracked with an Allow Connect overwrite in the channel. */
function overwriteCount(channelId) {
  return lockedChannels.get(channelId)?.size ?? 0;
}

module.exports = {
  GRACE_MS,
  isLocked,
  lock,
  unlock,
  hasOverwrite,
  addOverwrite,
  removeOverwrite,
  startTimer,
  cancelTimer,
  overwriteCount,
};

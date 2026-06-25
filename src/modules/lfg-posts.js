/**
 * In-memory registry of active /lfg posts so they can live-update as members
 * join/leave the voice channel. Ephemeral by design — cleared on bot restart,
 * and individual posts expire after LFG_TTL.
 *
 *   messageId -> { guildId, channelId, vcId, mode, players, rank, code, footerText, createdAt }
 */
const LFG_TTL = 30 * 60 * 1000; // 30 minutes

const posts = new Map();

function register(messageId, post) {
  posts.set(messageId, { ...post, createdAt: Date.now() });
}

function get(messageId) {
  return posts.get(messageId) || null;
}

/** All [messageId, post] pairs tied to a given voice channel. */
function forVc(vcId) {
  const out = [];
  for (const [messageId, post] of posts) {
    if (post.vcId === vcId) out.push([messageId, post]);
  }
  return out;
}

function remove(messageId) {
  posts.delete(messageId);
}

/** Drop posts older than LFG_TTL. */
function sweep() {
  const now = Date.now();
  for (const [messageId, post] of posts) {
    if (now - post.createdAt > LFG_TTL) posts.delete(messageId);
  }
}

// Periodic cleanup; unref so it never keeps the process alive on its own.
const _timer = setInterval(sweep, 5 * 60 * 1000);
if (_timer.unref) _timer.unref();

module.exports = { register, get, forVc, remove, sweep, LFG_TTL };

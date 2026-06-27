/**
 * Booster accumulation. When a member STOPS boosting (premiumSince clears),
 * bank the streak that just ended into their accumulated tenure — captured here
 * because `premiumSince` is gone the moment the boost ends.
 *
 * Best-effort: requires the old member state to be cached (Server Members intent
 * keeps active members cached). Role changes are NOT made here — tenure roles
 * update manually via /booster.
 */
const { Events } = require('discord.js');
const db = require('../modules/database');

module.exports = {
  name: Events.GuildMemberUpdate,

  execute(oldMember, newMember) {
    const oldPremium = oldMember?.premiumSinceTimestamp ?? null;
    const newPremium = newMember?.premiumSinceTimestamp ?? null;

    if (oldPremium && !newPremium) {
      const streakMs = Date.now() - oldPremium;
      if (streakMs > 0) {
        const total = db.addBoosterBanked(newMember.id, streakMs);
        console.log(`[booster] banked ${Math.floor(streakMs / 86_400_000)}d for ${newMember.id} on boost-stop (banked total ${Math.floor(total / 86_400_000)}d)`);
      }
    }
  },
};

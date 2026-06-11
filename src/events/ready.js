const { Events, ActivityType } = require('discord.js');
const db    = require('../modules/database');
const redis = require('../modules/redis');
const embed = require('../utils/embed');
const { finaliseIfReady, VerificationError } = require('../modules/verification');
const { getRank } = require('../modules/riot-api');
const { assignRankRole } = require('../utils/roles');
const config = require('../../config');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`[bot] Logged in as ${client.user.tag}`);
    console.log(`[bot] Serving ${client.guilds.cache.size} guild(s) | ${db.countLinks()} linked accounts`);

    client.user.setPresence({
      status:     'online',
      activities: [{ name: '🔗 oce.gg', type: ActivityType.Watching }],
    });

    // ── Sweep expired pending verifications every 5 minutes ────────────────
    setInterval(() => {
      const removed = db.sweepExpiredPending();
      if (removed > 0) console.log(`[db] Swept ${removed} expired pending verification(s)`);
    }, 5 * 60 * 1000);

    // ── Poll Redis every 15s for completed OAuth verifications ──────────────
    setInterval(async () => {
      const pendings = db.getAllPending();
      if (!pendings.length) return;

      for (const pending of pendings) {
        try {
          const result = await finaliseIfReady(pending.discord_id);
          if (!result) continue; // not ready yet

          // Success — assign rank role, then DM the user
          console.log(`[verify] Finalised link: ${pending.discord_id} → ${result.riotName}#${result.riotTag}`);

          // Assign rank role
          try {
            if (config.discord.guildId) {
              const guild  = await client.guilds.fetch(config.discord.guildId);
              const member = await guild.members.fetch(pending.discord_id);
              const rank   = await getRank(result.riotName, result.riotTag, result.region).catch(() => null);
              if (rank) {
                db.updateRankCache(pending.discord_id, rank);
                await assignRankRole(member, rank.tier);
              }
            }
          } catch (roleErr) {
            console.error(`[verify] Role assignment error for ${pending.discord_id}:`, roleErr);
          }

          try {
            const user = await client.users.fetch(pending.discord_id);
            const dm   = await user.createDM();
            await dm.send({
              embeds: [
                embed.success(
                  '✅ Account Linked!',
                  [
                    `**${result.riotName}#${result.riotTag}** (${result.region.toUpperCase()}) has been linked to your Discord account.`,
                    ``,
                    `Use \`/profile\` to view your link, or \`/unlink\` to remove it.`,
                  ].join('\n'),
                ),
              ],
            });
          } catch {
            // DMs closed — silently continue, the link is still saved
          }

        } catch (err) {
          if (err instanceof VerificationError) {
            // OAuth completed but Riot account wasn't connected — DM the user the error
            console.log(`[verify] OAuth failed for ${pending.discord_id}: ${err.message}`);
            try {
              const user = await client.users.fetch(pending.discord_id);
              const dm   = await user.createDM();
              await dm.send({
                embeds: [embed.error('Verification Failed', err.message)],
              });
            } catch {
              // DMs closed
            }
          } else {
            console.error(`[verify] Unexpected error for ${pending.discord_id}:`, err);
          }
        }
      }
    }, 15 * 1000);
  },
};

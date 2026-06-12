const { Events, ActivityType } = require('discord.js');
const db    = require('../modules/database');
const redis = require('../modules/redis');
const embed = require('../utils/embed');
const { finaliseIfReady, VerificationError } = require('../modules/verification');
const { getRank, getAccount } = require('../modules/riot-api');
const { assignRankRole, removeAllRankRoles } = require('../utils/roles');
const { logAdminAction } = require('../utils/activity-log');
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

    // ── Background account validation every 6 hours ───────────────────────
    async function runAccountValidation() {
      try {
      const links = db.getLinksWithTokens();
      console.log(`[validation] Starting account scan — ${links.length} account(s) to check`);

      let invalidated = 0, renamed = 0, errors = 0;

      for (const link of links) {
        try {
          let accessToken = link.discord_access_token;

          // Refresh token if expired
          if (link.discord_token_expires_at && Date.now() > link.discord_token_expires_at) {
            const refreshRes = await fetch('https://discord.com/api/oauth2/token', {
              method:  'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id:     config.discord.clientId,
                client_secret: config.oauth.clientSecret,
                grant_type:    'refresh_token',
                refresh_token: link.discord_refresh_token,
              }),
            });
            const refreshData = await refreshRes.json();
            if (!refreshData.access_token) {
              // Token revoked — can't check this account, skip
              continue;
            }
            accessToken = refreshData.access_token;
            db.updateTokens(link.discord_id, {
              accessToken:  refreshData.access_token,
              refreshToken: refreshData.refresh_token,
              expiresAt:    Date.now() + ((refreshData.expires_in ?? 604800) * 1000),
            });
          }

          // Fetch Discord connections
          const connRes     = await fetch('https://discord.com/api/users/@me/connections', {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const connections = await connRes.json();
          if (!Array.isArray(connections)) continue;

          const riotConn = connections.find((c) => c.type === 'riotgames');

          // ── No Riot connection or account swapped → invalidate ─────────
          if (!riotConn) {
            await invalidateLink(client, link, 'Riot account disconnected from Discord');
            invalidated++;
            continue;
          }

          const [connName, connTag] = riotConn.name.split('#');
          if (!connName || !connTag) continue;

          // Only call Henrik if the stored name differs
          if (connName.toLowerCase() !== link.riot_name.toLowerCase() || connTag.toLowerCase() !== link.riot_tag.toLowerCase()) {
            const current = await getAccount(connName, connTag, link.region).catch(() => null);
            if (!current) continue;

            if (current.puuid !== link.riot_puuid) {
              // Different account entirely — invalidate
              await invalidateLink(client, link, `Discord connection changed to ${riotConn.name}`);
              invalidated++;
            } else {
              // Same account, just renamed — silently update
              db.updateLinkRiotId(link.discord_id, current.name, current.tag);
              db.audit({
                action:          'NAME_UPDATE',
                targetDiscordId: link.discord_id,
                targetRiotId:    `${current.name}#${current.tag}`,
                performedBy:     'system',
                guildId:         config.discord.guildId,
                details:         { from: `${link.riot_name}#${link.riot_tag}`, to: `${current.name}#${current.tag}` },
              });
              renamed++;
            }
          }

          // Small delay between accounts to avoid hammering Discord's API
          await new Promise((r) => setTimeout(r, 500));

        } catch (err) {
          console.error(`[validation] Error checking ${link.discord_id}:`, err.message);
          errors++;
        }
      }

      console.log(`[validation] Scan complete — ${invalidated} invalidated, ${renamed} renamed, ${errors} errors`);

      const passed = links.length - invalidated - renamed - errors;
      await logAdminAction(client, {
        action:  'Account Scan Complete',
        fields:  {
          '✅ Passed':      `${passed}`,
          '✏️ Renamed':     `${renamed}`,
          '❌ Invalidated': `${invalidated}`,
          '⚠️ Errors':      `${errors}`,
          'Total Scanned':  `${links.length}`,
        },
        guildId: config.discord.guildId,
      });

      } catch (err) {
        console.error('[validation] Fatal error during scan:', err);
      }
    }

    async function invalidateLink(client, link, reason) {
      console.log(`[validation] Invalidating ${link.discord_id} (${link.riot_name}#${link.riot_tag}): ${reason}`);

      // Remove rank roles
      try {
        if (config.discord.guildId) {
          const guild  = await client.guilds.fetch(config.discord.guildId);
          const member = await guild.members.fetch(link.discord_id).catch(() => null);
          if (member) await removeAllRankRoles(member);
        }
      } catch (err) {
        console.error(`[validation] Role removal error for ${link.discord_id}:`, err.message);
      }

      // Remove the link
      db.removeLink(link.discord_id);
      db.audit({
        action:          'LINK_INVALIDATED',
        targetDiscordId: link.discord_id,
        targetRiotId:    `${link.riot_name}#${link.riot_tag}`,
        performedBy:     'system',
        guildId:         config.discord.guildId,
        details:         { reason },
      });

      // Log to staff channel
      logAdminAction(client, {
        action:  'Link Invalidated (Auto)',
        fields:  {
          'Discord':  `<@${link.discord_id}>`,
          'Riot ID':  `${link.riot_name}#${link.riot_tag}`,
          'Reason':   reason,
        },
        guildId: config.discord.guildId,
      });

      // DM the user
      try {
        const user = await client.users.fetch(link.discord_id);
        const dm   = await user.createDM();
        await dm.send({
          embeds: [embed.warning(
            'Verification Removed',
            [
              `Your linked Valorant account **${link.riot_name}#${link.riot_tag}** no longer matches your Discord connections.`,
              ``,
              `Your rank role has been removed.`,
              ``,
              `If this was a mistake, reconnect your Riot account in **Discord Settings → Connections → Riot Games** and use the **Link** button to re-verify.`,
            ].join('\n'),
          )],
        });
      } catch {
        // DMs closed
      }
    }

    // Run once on startup (after a short delay), then every 6 hours
    setTimeout(() => runAccountValidation(), 60 * 1000);
    setInterval(() => runAccountValidation(), 6 * 60 * 60 * 1000);

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

          // Save OAuth tokens for future connection checks
          if (result.accessToken) {
            db.updateTokens(pending.discord_id, {
              accessToken:  result.accessToken,
              refreshToken: result.refreshToken,
              expiresAt:    result.tokenExpiresAt,
            });
          }

          // Log to staff channel
          const linkedUser = await client.users.fetch(pending.discord_id).catch(() => null);
          if (linkedUser) {
            logAdminAction(client, {
              action:    'Account Linked',
              moderator: linkedUser,
              fields:    { 'Riot ID': `${result.riotName}#${result.riotTag}`, Region: result.region.toUpperCase(), Method: 'OAuth' },
              guildId:   config.discord.guildId,
            });
          }

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

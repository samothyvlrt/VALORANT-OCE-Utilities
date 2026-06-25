/**
 * deploy-commands.js
 *
 * Registers slash commands with Discord.
 *
 * Command groups (by source directory):
 *   user   — src/commands/user   (link, unlink, leaderboard, profile, privacy, match, verify)
 *   server — src/commands/server  (lock, unlock, lfg)
 *   admin  — src/commands/admin   (the 9 staff commands)
 *
 * Global / dev:
 *   node deploy-commands.js                        — register ALL commands globally (up to 1 hr)
 *   node deploy-commands.js --guild                — register ALL commands to DEV_GUILD_ID (instant)
 *
 * Main guild (instant). IMPORTANT: each deploy REPLACES the entire main command
 * set (Discord PUT semantics). The group flags below COMBINE, so pass every group
 * you want live in ONE command:
 *   node deploy-commands.js --main-server          — lock, unlock, lfg
 *   node deploy-commands.js --main-user            — user-facing commands (link, unlink, leaderboard, profile, privacy, match, verify)
 *   node deploy-commands.js --main-admin           — the 9 staff/admin commands
 *   node deploy-commands.js --main-admin --main-server          — admin + server
 *   node deploy-commands.js --main-full            — everything (all groups)
 *
 * Clearing (any --main-* flag + --clear clears the WHOLE main guild set):
 *   node deploy-commands.js --clear                — clear global commands
 *   node deploy-commands.js --guild --clear        — clear dev guild commands
 *   node deploy-commands.js --main-full --clear    — clear ALL main guild commands
 */

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const args = process.argv.slice(2);
const useGuild      = args.includes('--guild');
const useMainFull   = args.includes('--main-full');
const useMainAdmin  = args.includes('--main-admin');
const useMainUser   = args.includes('--main-user');
const useMainServer = args.includes('--main-server');
const clear         = args.includes('--clear');
const anyMain       = useMainFull || useMainAdmin || useMainUser || useMainServer;

const commands = [];
// Command names by group (populated from each source directory).
const groups = { user: new Set(), server: new Set(), admin: new Set() };

if (!clear) {
  const commandDirs = [
    { dir: path.join(__dirname, 'src/commands/user'),   group: 'user'   },
    { dir: path.join(__dirname, 'src/commands/server'), group: 'server' },
    { dir: path.join(__dirname, 'src/commands/admin'),  group: 'admin'  },
  ];
  for (const { dir, group } of commandDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const cmd = require(path.join(dir, file));
      if ('data' in cmd) {
        const json = cmd.data.toJSON();
        commands.push(json);
        groups[group].add(json.name);
      }
    }
  }
}

// Union of the command names selected by the group flags.
function mainGuildSelection() {
  if (useMainFull) return new Set(commands.map((c) => c.name));
  const want = new Set();
  if (useMainAdmin)  for (const n of groups.admin)  want.add(n);
  if (useMainUser)   for (const n of groups.user)   want.add(n);
  if (useMainServer) for (const n of groups.server) want.add(n);
  return want;
}

const rest = new REST().setToken(config.discord.token);

(async () => {
  try {
    if (anyMain) {
      if (!config.discord.mainGuildId) {
        console.error('MAIN_GUILD_ID is not set in .env');
        process.exit(1);
      }
      const route = Routes.applicationGuildCommands(config.discord.clientId, config.discord.mainGuildId);
      if (clear) {
        await rest.put(route, { body: [] });
        console.log(`✅ Cleared all commands from main guild ${config.discord.mainGuildId}`);
      } else {
        const want = mainGuildSelection();
        const filtered = commands.filter((c) => want.has(c.name));
        await rest.put(route, { body: filtered });
        console.log(`✅ Deployed ${filtered.length} command(s) to main guild ${config.discord.mainGuildId}: ${filtered.map((c) => '/' + c.name).join(', ')}`);
      }
    } else if (useGuild) {
      if (!config.discord.devGuildId) {
        console.error('DEV_GUILD_ID is not set in .env');
        process.exit(1);
      }
      const route = Routes.applicationGuildCommands(config.discord.clientId, config.discord.devGuildId);
      await rest.put(route, { body: clear ? [] : commands });
      console.log(clear ? '✅ Cleared dev guild commands.' : `✅ Deployed ${commands.length} command(s) to dev guild ${config.discord.devGuildId}`);
    } else {
      const route = Routes.applicationCommands(config.discord.clientId);
      await rest.put(route, { body: clear ? [] : commands });
      console.log(clear ? '✅ Cleared global commands.' : `✅ Deployed ${commands.length} command(s) globally (may take up to 1 hour to propagate).`);
    }
  } catch (err) {
    console.error('Failed to deploy commands:', err);
    process.exit(1);
  }
})();

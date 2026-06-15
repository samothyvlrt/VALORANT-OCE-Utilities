/**
 * deploy-commands.js
 *
 * Registers slash commands with Discord.
 *
 * Usage:
 *   node deploy-commands.js                      — register globally (up to 1 hr to propagate)
 *   node deploy-commands.js --guild              — register ALL commands to DEV_GUILD_ID (instant)
 *   node deploy-commands.js --main-guild         — register ONLY /lock + /unlock to MAIN_GUILD_ID (instant)
 *   node deploy-commands.js --clear              — clear all global commands
 *   node deploy-commands.js --guild --clear      — clear all dev guild commands
 *   node deploy-commands.js --main-guild --clear — clear all main guild commands
 */

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const args = process.argv.slice(2);
const useGuild     = args.includes('--guild');
const useMainGuild = args.includes('--main-guild');
const clear        = args.includes('--clear');

// Commands that are allowed on the main server
const MAIN_GUILD_COMMANDS = new Set(['lock', 'unlock']);

const commands = [];

if (!clear) {
  const commandDirs = [
    path.join(__dirname, 'src/commands/user'),
    path.join(__dirname, 'src/commands/admin'),
  ];
  for (const dir of commandDirs) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const cmd = require(path.join(dir, file));
      if ('data' in cmd) commands.push(cmd.data.toJSON());
    }
  }
}

const rest = new REST().setToken(config.discord.token);

(async () => {
  try {
    if (useMainGuild) {
      if (!config.discord.mainGuildId) {
        console.error('MAIN_GUILD_ID is not set in .env');
        process.exit(1);
      }
      const route = Routes.applicationGuildCommands(config.discord.clientId, config.discord.mainGuildId);
      if (clear) {
        await rest.put(route, { body: [] });
        console.log(`✅ Cleared all commands from main guild ${config.discord.mainGuildId}`);
      } else {
        const filtered = commands.filter((c) => MAIN_GUILD_COMMANDS.has(c.name));
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

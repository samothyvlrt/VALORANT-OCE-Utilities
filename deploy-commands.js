/**
 * deploy-commands.js
 *
 * Registers slash commands with Discord.
 *
 * Usage:
 *   node deploy-commands.js          — register globally (up to 1 hr to propagate)
 *   node deploy-commands.js --guild  — register to DEV_GUILD_ID only (instant, for testing)
 *   node deploy-commands.js --clear  — clear all commands (globally or guild)
 */

const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const args = process.argv.slice(2);
const useGuild = args.includes('--guild');
const clear = args.includes('--clear');

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
  console.log(`Deploying ${commands.length} command(s)...`);
}

const rest = new REST().setToken(config.discord.token);

(async () => {
  try {
    if (useGuild) {
      if (!config.discord.devGuildId) {
        console.error('DEV_GUILD_ID is not set in .env');
        process.exit(1);
      }
      const route = clear
        ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.devGuildId)
        : Routes.applicationGuildCommands(config.discord.clientId, config.discord.devGuildId);
      await rest.put(route, { body: clear ? [] : commands });
      console.log(clear ? '✅ Cleared guild commands.' : `✅ Deployed to guild ${config.discord.devGuildId}`);
    } else {
      const route = Routes.applicationCommands(config.discord.clientId);
      await rest.put(route, { body: clear ? [] : commands });
      console.log(clear ? '✅ Cleared global commands.' : '✅ Deployed globally (may take up to 1 hour to propagate).');
    }
  } catch (err) {
    console.error('Failed to deploy commands:', err);
    process.exit(1);
  }
})();

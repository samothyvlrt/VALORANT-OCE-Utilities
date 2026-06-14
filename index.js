const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// ─────────────────────────────────────────────
// Client setup
// ─────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,    // needed for guild.members.fetch() in admin commands
    GatewayIntentBits.GuildVoiceStates, // needed for voiceStateUpdate (vc lock/unlock)
  ],
  partials: [Partials.GuildMember],
});

client.commands = new Collection();

// ─────────────────────────────────────────────
// Load commands
// ─────────────────────────────────────────────
const commandDirs = [
  path.join(__dirname, 'src/commands/user'),
  path.join(__dirname, 'src/commands/admin'),
];

for (const dir of commandDirs) {
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const command = require(path.join(dir, file));
    if ('data' in command && 'execute' in command) {
      client.commands.set(command.data.name, command);
      console.log(`[commands] Loaded /${command.data.name}`);
    }
  }
}

// ─────────────────────────────────────────────
// Load events
// ─────────────────────────────────────────────
const eventsDir = path.join(__dirname, 'src/events');
for (const file of fs.readdirSync(eventsDir).filter((f) => f.endsWith('.js'))) {
  const event = require(path.join(eventsDir, file));
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
  console.log(`[events] Registered: ${event.name}`);
}

// ─────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────
client.login(config.discord.token).catch((err) => {
  console.error('[bot] Failed to log in:', err.message);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[bot] Shutting down...');
  client.destroy();
  process.exit(0);
});

require('dotenv').config();

const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    devGuildId: process.env.DEV_GUILD_ID || null,
    guildId: process.env.GUILD_ID || null,
    allowedGuildIds: [
      process.env.GUILD_ID,
      process.env.DEV_GUILD_ID,
    ].filter(Boolean),
    adminRoleIds: process.env.ADMIN_ROLE_IDS
      ? process.env.ADMIN_ROLE_IDS.split(',').map((id) => id.trim()).filter(Boolean)
      : [],
  },

  riot: {
    henrikkApiKey: process.env.HENRIK_API_KEY || null,
    riotApiKey: process.env.RIOT_API_KEY || null,
    defaultRegion: (process.env.DEFAULT_REGION || 'ap').toLowerCase(),
  },

  verification: {
    timeoutMinutes: parseInt(process.env.VERIFICATION_TIMEOUT_MINUTES || '30', 10),
  },

  oauth: {
    redirectUri:    process.env.OAUTH_REDIRECT_URI || '',
    clientSecret:   process.env.DISCORD_CLIENT_SECRET || '',
  },

  // Supported Valorant regions mapped to Riot API routing values
  regions: {
    na: { henrikkName: 'na', riotCluster: 'americas' },
    eu: { henrikkName: 'eu', riotCluster: 'europe' },
    ap: { henrikkName: 'ap', riotCluster: 'asia' },
    latam: { henrikkName: 'latam', riotCluster: 'americas' },
    br: { henrikkName: 'br', riotCluster: 'americas' },
    kr: { henrikkName: 'kr', riotCluster: 'asia' },
  },

  colors: {
    primary: 0xFF4655,   // Valorant red
    success: 0x2ECC71,
    warning: 0xF1C40F,
    error: 0xE74C3C,
    info: 0x3498DB,
    neutral: 0x2B2D31,
  },

  rankRoles: {
    unranked:  process.env.ROLE_UNRANKED   || null,
    iron:      process.env.ROLE_IRON       || null,
    bronze:    process.env.ROLE_BRONZE     || null,
    silver:    process.env.ROLE_SILVER     || null,
    gold:      process.env.ROLE_GOLD       || null,
    platinum:  process.env.ROLE_PLATINUM   || null,
    diamond:   process.env.ROLE_DIAMOND    || null,
    ascendant: process.env.ROLE_ASCENDANT  || null,
    immortal:  process.env.ROLE_IMMORTAL   || null,
    radiant:   process.env.ROLE_RADIANT    || null,
  },

  ranks: {
    // Display-friendly rank tier names
    tierNames: [
      'Unranked', 'Iron 1', 'Iron 2', 'Iron 3',
      'Bronze 1', 'Bronze 2', 'Bronze 3',
      'Silver 1', 'Silver 2', 'Silver 3',
      'Gold 1', 'Gold 2', 'Gold 3',
      'Platinum 1', 'Platinum 2', 'Platinum 3',
      'Diamond 1', 'Diamond 2', 'Diamond 3',
      'Ascendant 1', 'Ascendant 2', 'Ascendant 3',
      'Immortal 1', 'Immortal 2', 'Immortal 3',
      'Radiant',
    ],
  },
};

// Validate required fields on startup
const required = ['discord.token', 'discord.clientId'];
for (const key of required) {
  const parts = key.split('.');
  let val = config;
  for (const p of parts) val = val?.[p];
  if (!val) {
    console.error(`[config] Missing required env var for: ${key}`);
    process.exit(1);
  }
}

module.exports = config;

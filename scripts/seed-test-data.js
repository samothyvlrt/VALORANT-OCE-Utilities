/**
 * seed-test-data.js
 * Inserts dummy linked accounts with a realistic rank distribution for load testing.
 * Run with: node scripts/seed-test-data.js
 * Remove with: node scripts/seed-test-data.js --clean
 */

const Database = require('better-sqlite3');
const path     = require('path');

const DB_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'bot.db')
  : path.join(__dirname, '../data/bot.db');

const db = new Database(DB_PATH);

const CLEAN = process.argv.includes('--clean');

if (CLEAN) {
  const { changes } = db.prepare("DELETE FROM linked_accounts WHERE discord_id LIKE 'dummy_%'").run();
  db.prepare("DELETE FROM rank_history WHERE discord_id LIKE 'dummy_%'").run();
  console.log(`Removed ${changes} dummy account(s).`);
  process.exit(0);
}

// Realistic OCE rank bell curve — peaks at Gold/Plat, thins at both ends
const tiers = [
  { tier: 3,  name: 'Iron 1',      rr_max: 99, count: 8  },
  { tier: 4,  name: 'Iron 2',      rr_max: 99, count: 12 },
  { tier: 5,  name: 'Iron 3',      rr_max: 99, count: 10 },
  { tier: 6,  name: 'Bronze 1',    rr_max: 99, count: 15 },
  { tier: 7,  name: 'Bronze 2',    rr_max: 99, count: 18 },
  { tier: 8,  name: 'Bronze 3',    rr_max: 99, count: 14 },
  { tier: 9,  name: 'Silver 1',    rr_max: 99, count: 22 },
  { tier: 10, name: 'Silver 2',    rr_max: 99, count: 25 },
  { tier: 11, name: 'Silver 3',    rr_max: 99, count: 20 },
  { tier: 12, name: 'Gold 1',      rr_max: 99, count: 28 },
  { tier: 13, name: 'Gold 2',      rr_max: 99, count: 30 },
  { tier: 14, name: 'Gold 3',      rr_max: 99, count: 26 },
  { tier: 15, name: 'Platinum 1',  rr_max: 99, count: 22 },
  { tier: 16, name: 'Platinum 2',  rr_max: 99, count: 20 },
  { tier: 17, name: 'Platinum 3',  rr_max: 99, count: 18 },
  { tier: 18, name: 'Diamond 1',   rr_max: 99, count: 14 },
  { tier: 19, name: 'Diamond 2',   rr_max: 99, count: 10 },
  { tier: 20, name: 'Diamond 3',   rr_max: 99, count: 7  },
  { tier: 21, name: 'Ascendant 1', rr_max: 99, count: 5  },
  { tier: 22, name: 'Ascendant 2', rr_max: 99, count: 4  },
  { tier: 23, name: 'Ascendant 3', rr_max: 99, count: 3  },
  { tier: 24, name: 'Immortal 1',  rr_max: 99, count: 3  },
  { tier: 25, name: 'Immortal 2',  rr_max: 99, count: 2  },
  { tier: 26, name: 'Immortal 3',  rr_max: 99, count: 1  },
  { tier: 27, name: 'Radiant',     rr_max: 1200, count: 1  },
];

const insertAccount = db.prepare(`
  INSERT OR IGNORE INTO linked_accounts
    (discord_id, riot_puuid, riot_name, riot_tag, region, linked_at, last_updated, cached_rank, rank_cached_at)
  VALUES (?, ?, ?, 'TEST', 'ap', ?, ?, ?, ?)
`);

const insertHistory = db.prepare(`
  INSERT INTO rank_history (discord_id, tier, tier_name, rr, recorded_at)
  VALUES (?, ?, ?, ?, ?)
`);

const seed = db.transaction(() => {
  let idx = 1;
  for (const { tier, name, rr_max, count } of tiers) {
    for (let i = 0; i < count; i++) {
      const rr  = rr_max > 0 ? Math.floor(Math.random() * rr_max) : 0;
      const lbr = tier >= 24 ? Math.floor(Math.random() * 500) + 1 : null;
      const now = Date.now() - Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000); // linked in last 7 days
      const rank = JSON.stringify({ tier, tierName: name, rr, leaderboardRank: lbr });
      const id   = `dummy_${idx}`;

      insertAccount.run(id, `dummy_puuid_${String(idx).padStart(8, '0')}`, `Player${idx}`, now, now, rank, now);

      // Seed a short rank history so sparklines render
      const earlier = now - 3 * 24 * 60 * 60 * 1000;
      const startRr = Math.max(0, rr - Math.floor(Math.random() * 40));
      insertHistory.run(id, tier, name, startRr, earlier);
      insertHistory.run(id, tier, name, rr, now);

      idx++;
    }
  }
  return idx - 1;
});

const total = seed();
const linked = db.prepare('SELECT COUNT(*) AS c FROM linked_accounts').get().c;

console.log(`✅ Inserted ${total} dummy accounts.`);
console.log(`   Total linked accounts in DB: ${linked}`);
console.log('');
console.log('To remove dummy data: node scripts/seed-test-data.js --clean');

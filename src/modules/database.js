const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/bot.db');

// Ensure data directory exists
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS linked_accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id      TEXT    NOT NULL UNIQUE,
    riot_puuid      TEXT    NOT NULL UNIQUE,
    riot_name       TEXT    NOT NULL,
    riot_tag        TEXT    NOT NULL,
    region          TEXT    NOT NULL DEFAULT 'ap',
    linked_at       INTEGER NOT NULL,
    last_updated    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pending_verifications (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id          TEXT    NOT NULL,
    riot_puuid          TEXT    NOT NULL,
    riot_name           TEXT    NOT NULL,
    riot_tag            TEXT    NOT NULL,
    region              TEXT    NOT NULL,
    initial_card_id     TEXT,
    initial_title_id    TEXT,
    state               TEXT,
    created_at          INTEGER NOT NULL,
    expires_at          INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    action            TEXT    NOT NULL,
    target_discord_id TEXT,
    target_riot_id    TEXT,
    performed_by      TEXT,
    guild_id          TEXT,
    details           TEXT,
    timestamp         INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_linked_discord  ON linked_accounts (discord_id);
  CREATE INDEX IF NOT EXISTS idx_linked_puuid    ON linked_accounts (riot_puuid);
  CREATE INDEX IF NOT EXISTS idx_pending_discord ON pending_verifications (discord_id);
  CREATE INDEX IF NOT EXISTS idx_audit_guild     ON audit_log (guild_id);
  CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log (timestamp);
`);

// Migrate existing databases — add columns if they don't exist yet
db.exec(`
  CREATE TABLE IF NOT EXISTS bot_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

try { db.exec(`ALTER TABLE pending_verifications ADD COLUMN state TEXT`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE linked_accounts ADD COLUMN cached_rank TEXT`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE linked_accounts ADD COLUMN rank_cached_at INTEGER`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE linked_accounts ADD COLUMN cached_stats TEXT`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE linked_accounts ADD COLUMN stats_cached_at INTEGER`); } catch { /* already exists */ }

// ─────────────────────────────────────────────
// Linked accounts
// ─────────────────────────────────────────────

/**
 * Get a linked account by Discord ID.
 * @param {string} discordId
 */
function getLinkByDiscord(discordId) {
  return db.prepare('SELECT * FROM linked_accounts WHERE discord_id = ?').get(discordId);
}

/**
 * Get a linked account by Riot PUUID.
 * @param {string} puuid
 */
function getLinkByPuuid(puuid) {
  return db.prepare('SELECT * FROM linked_accounts WHERE riot_puuid = ?').get(puuid);
}

/**
 * Upsert (create or update) a verified link.
 */
function upsertLink({ discordId, puuid, riotName, riotTag, region }) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO linked_accounts (discord_id, riot_puuid, riot_name, riot_tag, region, linked_at, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      riot_puuid   = excluded.riot_puuid,
      riot_name    = excluded.riot_name,
      riot_tag     = excluded.riot_tag,
      region       = excluded.region,
      last_updated = excluded.last_updated
  `).run(discordId, puuid, riotName, riotTag, region, now, now);
}

/**
 * Remove a link by Discord ID. Returns true if a row was deleted.
 * @param {string} discordId
 */
function removeLink(discordId) {
  const result = db.prepare('DELETE FROM linked_accounts WHERE discord_id = ?').run(discordId);
  return result.changes > 0;
}

/**
 * Update riot_name + riot_tag for an existing link (e.g. after a rename).
 */
function updateLinkRiotId(discordId, riotName, riotTag) {
  const now = Date.now();
  db.prepare(`
    UPDATE linked_accounts
    SET riot_name = ?, riot_tag = ?, last_updated = ?
    WHERE discord_id = ?
  `).run(riotName, riotTag, now, discordId);
}

/**
 * Store a fresh rank object in the cache for a linked account.
 * @param {string} discordId
 * @param {object} rank  — the object returned by getRank()
 */
function updateRankCache(discordId, rank) {
  db.prepare(`
    UPDATE linked_accounts SET cached_rank = ?, rank_cached_at = ? WHERE discord_id = ?
  `).run(JSON.stringify(rank), Date.now(), discordId);
}

/**
 * Store a fresh stats object in the cache for a linked account.
 * @param {string} discordId
 * @param {object} stats  — the object returned by getPlayerStats()
 */
function updateStatsCache(discordId, stats) {
  db.prepare(`
    UPDATE linked_accounts SET cached_stats = ?, stats_cached_at = ? WHERE discord_id = ?
  `).run(JSON.stringify(stats), Date.now(), discordId);
}

/**
 * Get all linked accounts (for global admin use).
 * @returns {Array}
 */
function getAllLinks() {
  return db.prepare('SELECT * FROM linked_accounts ORDER BY linked_at DESC').all();
}

/**
 * Get linked accounts whose discord_id is in the provided list.
 * Useful for server-scoped exports (caller provides member list).
 * @param {string[]} discordIds
 */
function getLinksByDiscordIds(discordIds) {
  if (!discordIds.length) return [];
  const placeholders = discordIds.map(() => '?').join(',');
  return db
    .prepare(`SELECT * FROM linked_accounts WHERE discord_id IN (${placeholders})`)
    .all(...discordIds);
}

// ─────────────────────────────────────────────
// Pending verifications
// ─────────────────────────────────────────────

/**
 * Create a pending verification challenge.
 */
function createPending({ discordId, puuid, riotName, riotTag, region, initialCardId, initialTitleId, timeoutMinutes, state }) {
  const now = Date.now();
  const expires = now + timeoutMinutes * 60 * 1000;

  // Remove any existing pending for this user first
  db.prepare('DELETE FROM pending_verifications WHERE discord_id = ?').run(discordId);

  db.prepare(`
    INSERT INTO pending_verifications
      (discord_id, riot_puuid, riot_name, riot_tag, region, initial_card_id, initial_title_id, state, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(discordId, puuid, riotName, riotTag, region, initialCardId || null, initialTitleId || null, state || null, now, expires);
}

/**
 * Get a pending verification by Discord ID (null if expired or not found).
 * @param {string} discordId
 */
function getPending(discordId) {
  const row = db.prepare('SELECT * FROM pending_verifications WHERE discord_id = ?').get(discordId);
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    db.prepare('DELETE FROM pending_verifications WHERE discord_id = ?').run(discordId);
    return null;
  }
  return row;
}

/**
 * Remove a pending verification (called after success or explicit cancel).
 * @param {string} discordId
 */
function removePending(discordId) {
  db.prepare('DELETE FROM pending_verifications WHERE discord_id = ?').run(discordId);
}

/**
 * Get all non-expired pending verifications (used by the Redis polling loop).
 * @returns {Array}
 */
function getAllPending() {
  return db.prepare('SELECT * FROM pending_verifications WHERE expires_at > ?').all(Date.now());
}

/**
 * Sweep expired pending verifications (run periodically).
 */
function sweepExpiredPending() {
  const result = db.prepare('DELETE FROM pending_verifications WHERE expires_at < ?').run(Date.now());
  return result.changes;
}

// ─────────────────────────────────────────────
// Audit log
// ─────────────────────────────────────────────

/**
 * Write an audit entry.
 * @param {object} entry
 */
function audit({ action, targetDiscordId, targetRiotId, performedBy, guildId, details }) {
  db.prepare(`
    INSERT INTO audit_log (action, target_discord_id, target_riot_id, performed_by, guild_id, details, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    action,
    targetDiscordId || null,
    targetRiotId || null,
    performedBy || null,
    guildId || null,
    details ? JSON.stringify(details) : null,
    Date.now(),
  );
}

/**
 * Get recent audit entries for a guild, newest first.
 * @param {string} guildId
 * @param {number} limit
 */
function getAuditLog(guildId, limit = 25) {
  return db
    .prepare('SELECT * FROM audit_log WHERE guild_id = ? ORDER BY timestamp DESC LIMIT ?')
    .all(guildId, limit);
}

/**
 * Get link history for a Discord user — LINK_CREATE and ADMIN_LINK_SET events, newest first.
 * @param {string} discordId
 * @param {number} limit
 */
function getLinkHistory(discordId, limit = 5) {
  return db
    .prepare(`
      SELECT * FROM audit_log
      WHERE target_discord_id = ?
        AND action IN ('LINK_CREATE', 'ADMIN_LINK_SET')
      ORDER BY timestamp DESC
      LIMIT ?
    `)
    .all(discordId, limit);
}

// ─────────────────────────────────────────────
// Stats helpers
// ─────────────────────────────────────────────

/**
 * Count total linked accounts.
 */
function countLinks() {
  return db.prepare('SELECT COUNT(*) AS cnt FROM linked_accounts').get().cnt;
}

// ─────────────────────────────────────────────
// Bot settings (persistent key/value store)
// ─────────────────────────────────────────────

function getSetting(key) {
  return db.prepare('SELECT value FROM bot_settings WHERE key = ?').get(key)?.value ?? null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO bot_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

module.exports = {
  // Linked accounts
  getLinkByDiscord,
  updateStatsCache,
  getLinkByPuuid,
  upsertLink,
  removeLink,
  updateLinkRiotId,
  updateRankCache,
  getAllLinks,
  getLinksByDiscordIds,
  // Pending verifications
  createPending,
  getPending,
  getAllPending,
  removePending,
  sweepExpiredPending,
  // Audit
  audit,
  getAuditLog,
  getLinkHistory,
  // Stats
  countLinks,
  // Settings
  getSetting,
  setSetting,
  // Raw db handle (for advanced queries in admin commands)
  db,
};

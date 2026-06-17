# Valorant OCE Utilities — Claude Context

## Project Overview

Discord bot for the Valorant OCE community. Lets members link their Riot account, receive automatic rank roles, and view a server leaderboard. Built with Discord.js, SQLite (better-sqlite3), Upstash Redis, Vercel (web/OAuth), and JRMA (bot hosting via Docker).

Owner/dev: Sam (sgtarling@icloud.com)
GitHub: https://github.com/samothyvlrt/VALORANT-OCE-Utilities
Vercel: https://valorant-oce-utilities.vercel.app

---

## Infrastructure

| Service | Role |
|---------|------|
| **JRMA** (justrunmy.app) | Hosts the Discord bot in a Docker container |
| **Vercel** | Hosts the OAuth callback (`/api/callback`), public web pages, and changelog |
| **Upstash Redis** | Bridge between bot (JRMA) and Vercel for OAuth state and verification results |
| **SQLite** (`data/bot.db`) | Persistent storage — linked accounts, rank cache, audit log, rank history |
| **HenrikDev API** | Third-party Valorant API wrapper (`api.henrikdev.xyz`) |

### JRMA Docker details
- JRMA dashboard: `justrunmy.app/panel/application/35401`
- Git push URL: `https://<jrma-user>:<jrma-token>@justrunmy.app/git/r_Kp9b8`
- Push target branch: `deploy`
- **JRMA registry is permanently broken** — git-triggered auto-build produces 0-byte images ("No matching nodes"). Do NOT push to `jdr-o75fr96p.justrunmy.app`.
- **Current image**: `5amothy/valorant-bot:latest` on Docker Hub (public repo)

### Docker Hub deployment (current method)
```bash
docker login -u 5amothy
docker build --no-cache --platform linux/amd64 -t 5amothy/valorant-bot:latest .
docker push 5amothy/valorant-bot:latest
```
Then restart container in JRMA dashboard → General → Restart.

**CRITICAL**: Always use `--platform linux/amd64`. Dev machine is ARM64 (macOS); JRMA runs AMD64 Linux. Without this flag the container starts with no logs and immediately fails.

### Dockerfile notes
- Base image: `node:18`
- `RUN npm rebuild better-sqlite3` is required — macOS binaries are incompatible with Linux
- `/app/data` is a Docker volume — the SQLite DB persists across container restarts
- `@napi-rs/canvas` is an optional dependency that sometimes fails to install correctly on macOS ARM64. Fix: `rm -rf node_modules package-lock.json && npm install`
- **DB note**: Switching Docker images resets the volume if the new container doesn't mount the same named volume. Existing linked users will need to re-link after a fresh container.

---

## Deployment Commands

### Full ship (GitHub + JRMA git push + Vercel)
```bash
npm run ship
# = bash scripts/deploy.sh
```

### Re-register Discord slash commands (REQUIRED after any command option change)
```bash
node deploy-commands.js --guild    # instant, hits DEV_GUILD_ID
node deploy-commands.js            # global (up to 1hr propagation)
```

> `npm run ship` does NOT re-register slash commands. Any change to command options, names, or new commands requires running `deploy-commands.js` separately.

### Deploy to main guild (when ready to go live)
```bash
# Run in JRMA shell, or swap DEV_GUILD_ID in .env to main server ID
node deploy-commands.js --guild --guildId 537887361292304385
```

### JRMA git push only
```bash
git push https://<jrma-user>:<jrma-token>@justrunmy.app/git/r_Kp9b8 HEAD:deploy
```

### Remove index.lock if git is stuck
```bash
rm /Users/samueltarling/Desktop/valorant-bot/.git/index.lock
```

---

## Valorant Tier System (CRITICAL — gets lost on context reset)

HenrikDev API returns tier numbers as integers. The mapping is:

| Tier # | Rank |
|--------|------|
| 0 | Unranked |
| 1–2 | (unused) |
| 3–5 | Iron 1–3 |
| 6–8 | Bronze 1–3 |
| 9–11 | Silver 1–3 |
| 12–14 | Gold 1–3 |
| 15–17 | Platinum 1–3 |
| 18–20 | Diamond 1–3 |
| 21–23 | Ascendant 1–3 |
| 24–26 | Immortal 1–3 |
| 27 | Radiant |

### Immortal/Radiant RR — cumulative display
- Immortal RR is **cumulative from Immortal 1 = 0 RR**
- `ranking_in_tier` from HenrikDev is **within-tier** (0–99 per sub-tier)
- Display offsets: I2 shows `100 + rr`, I3 shows `200 + rr`, I1 and Radiant show `rr` as-is
- **Confirmed via live test**: For Radiant, `ranking_in_tier` returns the **total cumulative RR above I1 0 RR** (verified with a real 895 RR Radiant player — not relative to the dynamic Radiant floor)
- Radiant floor is dynamic in OCE (~300 RR but fluctuates daily when 500 players hit it) — do NOT hardcode a floor constant
- `displayRR(tier, rr)` in `leaderboard.js` handles the offset logic

### Leaderboard sort logic
- Immortal+ (tier 24–27): sort by `displayRR` descending (cumulative RR across sub-tiers)
- Tie-break for Immortal+: `leaderboardRank` ascending (lower = better), then `tier` descending
- All other tiers: `tier` descending, then `rr` descending
- `leaderboardRank` is a display stat from the Riot API leaderboard, NOT used as primary sort for Immortal+

---

## HenrikDev API

Base URL: `https://api.henrikdev.xyz`

Key endpoints used:
- `GET /valorant/v3/profile/{region}/{name}/{tag}` — account lookup (primary)
- `GET /valorant/v1/account/{name}/{tag}` — account lookup fallback
- `GET /valorant/v2/mmr/{region}/{name}/{tag}` — rank (`current_data.ranking_in_tier`, `current_data.currenttier`)
- `GET /valorant/v3/by-puuid/matches/{region}/{puuid}?size=20` — match history / stats

Important field names from `/v2/mmr`:
- `current_data.currenttier` → tier number
- `current_data.currenttierpatched` → tier name string
- `current_data.ranking_in_tier` → stored as `rr` in DB (within-tier value)
- `current_data.leaderboard_rank` → Radiant/Immortal leaderboard position
- `current_data.elo` → internal Riot MMR (NOT the same as cumulative Immortal RR — do not use for display)
- `highest_rank` → peak tier data

---

## OAuth / Verification Flow

1. User runs `/link` or clicks panel button → `startChallenge()` validates Riot account, stores state in SQLite + Redis, returns OAuth URL
2. Bot DMs user the OAuth URL → user clicks → Discord OAuth → Vercel `/api/callback`
3. Vercel callback checks Discord connections for the Riot account, writes result to Redis (`verified:{discordId}`)
4. Bot's `ready.js` polling loop runs every 15s → `finaliseIfReady()` pops result from Redis → writes link to SQLite → DMs user success

Redis key spaces:
- `oauth:{state}` — pending OAuth data (TTL: 30 min, written by bot, read by Vercel)
- `verified:{discordId}` — completed OAuth result (TTL: 5 min, written by Vercel, read+deleted by bot)
- `stats:rank-distribution` — rank distribution payload for web chart (written by bot every 6h)

---

## Database (SQLite via better-sqlite3)

File: `data/bot.db` (persisted as Docker volume at `/app/data`)

### Key tables

**`linked_accounts`** — one row per linked Discord user
- `discord_id`, `riot_puuid`, `riot_name`, `riot_tag`, `region`, `linked_at`, `last_updated`
- `cached_rank` (JSON) — `{ tier, tierName, rr, leaderboardRank, ... }`
- `rank_cached_at` — timestamp of last rank fetch
- `hidden` (0/1) — user opted out of public leaderboard
- OAuth token columns: `discord_access_token`, `discord_refresh_token`, `discord_token_expires_at`

**`rank_history`** — one row per rank change snapshot
- Used for sparkline in `/profile` and trend tracking

**`audit_log`** — admin action log
- `action` values: `LINK_CREATE`, `ADMIN_LINK_SET`, `LINK_REMOVE_SELF`, `ADMIN_LINK_RESET`, `LINK_INVALIDATED`, `NAME_UPDATE`

**`bot_settings`** — key/value store (e.g. `log_channel_id`)

**`pending_verifications`** — in-flight OAuth challenges (swept every 5 min)

### Migration pattern
New columns are added via `try { db.exec('ALTER TABLE ... ADD COLUMN ...') } catch {}` at startup — safe to run repeatedly.

---

## Key Design Decisions

### Region
**AP/OCE only** — region option removed from `/link` and `/admin link set`. All accounts hardcoded to `config.riot.defaultRegion` (ap). Do not add region selectors back.

### Privacy toggle (`/privacy`)
- Users can hide themselves from the public `/leaderboard` ranked list
- Hidden accounts are **still counted in the rank distribution chart** (anonymous aggregate)
- Hidden accounts are visible to admins via `/admin link list` (marked 🙈) and `/admin stats`
- `db.getPublicLinks()` — public list (hidden=0), used by leaderboard ranked entries
- `db.getAllLinks()` — all accounts including hidden, used by chart, admin commands, stats generation

### `/profile`
- Self-only — no `user` option. Admins use `/admin link get` to look up others.
- `public: true` option to post visibly in channel (default: ephemeral)

### Rank chart (`src/utils/rank-chart.js`)
- Rendered at **2× resolution** (1040×160px) using `@napi-rs/canvas`
- `S = 2` scale factor — all layout values multiplied by S
- Uses `db.getAllLinks()` (not public-only) for accurate server distribution
- Viewer's tier highlighted with white ring; "better than X%" label in tier colour
- Groups: Iron, Bronze, Silver, Gold, Plat, Dia, Asc, Imm, Rad (25 bars total, tiers 3–27)

### Background jobs (ready.js)
- **Account validation**: runs 60s after startup, then every 6h — checks Discord connections, invalidates swapped accounts, silently renames if same PUUID
- **Stats generation**: runs on startup + every 6h — pushes rank distribution to Redis for web chart
- **Verification poll**: every 15s — checks Redis for completed OAuth results

### VC lock (`/lock`, `/unlock`)
- In-memory state only (`src/modules/vc-lock.js`) — resets on bot restart
- 10-minute reconnect grace period for members who were in the channel when it was locked
- Uses Discord permission overwrites (Allow Connect) per member

---

## Known Issues / Gotchas

### Concurrent bot instances
Running two instances with the same token causes `DiscordAPIError[40060] Interaction already acknowledged`. Stop JRMA before running local `npm run dev`.

### `@napi-rs/canvas` missing on macOS ARM64
```bash
rm -rf node_modules package-lock.json && npm install
```

### JRMA 0-byte Docker images
Auto-build from git push produces empty images. Use direct Docker push as workaround (see Infrastructure section above).

### `tierToRoleKey` — historical bug (fixed)
Old version had tier ranges off by 2 (e.g. `tier === 25` for Radiant instead of `tier === 27`). Fixed in `src/utils/roles.js`. If any users have wrong rank roles, re-run `/admin link set` to trigger reassignment.

---

## Commands Reference

### User commands
| Command | Notes |
|---------|-------|
| `/link` | Starts OAuth verification flow. AP only, no region option. |
| `/verify` | Manual fallback verification (if OAuth doesn't trigger) |
| `/profile` | Self-only. `public: true` to show in channel. |
| `/leaderboard` | Public ranked list + rank distribution chart. Hidden users excluded from list but counted in chart. |
| `/privacy` | Toggle leaderboard visibility (ephemeral toggle). |
| `/unlink` | Remove own linked account. |
| `/lock` / `/unlock` | VC lock — separate bot running on main server. |

### Admin commands (`/admin`)
| Subcommand | Notes |
|------------|-------|
| `link get <user>` | Show link info + history for a user |
| `link set <user> <riot_id>` | Force-link (no ownership challenge). Auto-fetches rank and assigns role. AP only. |
| `link reset <user>` | Remove link, force re-verification |
| `link list` | All linked members (includes hidden, marked 🙈) |
| `link bulk-reset <role>` | Force re-verify entire role |
| `link panel` | Post the hardcoded user guide panel in current channel |
| `log setup <channel>` | Set staff activity log channel |
| `stats` | Member count, link rate, rank distribution (includes hidden accounts) |
| `export` | CSV export of linked accounts |

---

## Environment Variables (.env)

```
DISCORD_TOKEN=
CLIENT_ID=
GUILD_ID=                    # dev/OCE server
DEV_GUILD_ID=                # same as GUILD_ID for now
MAIN_GUILD_ID=537887361292304385   # main server (lock/unlock only)
ADMIN_ROLE_IDS=              # comma-separated
RESTRICTED_ROLE_ID=          # users who cannot link

HENRIK_API_KEY=
RIOT_API_KEY=                # optional, unused currently
DEFAULT_REGION=ap

UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

OAUTH_REDIRECT_URI=          # https://valorant-oce-utilities.vercel.app/api/callback
DISCORD_CLIENT_SECRET=

VERIFICATION_TIMEOUT_MINUTES=30

ROLE_IRON=
ROLE_BRONZE=
ROLE_SILVER=
ROLE_GOLD=
ROLE_PLATINUM=
ROLE_DIAMOND=
ROLE_ASCENDANT=
ROLE_IMMORTAL=
ROLE_RADIANT=
ROLE_UNRANKED=
```

---

## Seed / Test Data

```bash
node scripts/seed-test-data.js          # insert dummy accounts (dummy_ prefix discord IDs)
node scripts/seed-test-data.js --clean  # remove all dummy accounts, leave real ones intact
```

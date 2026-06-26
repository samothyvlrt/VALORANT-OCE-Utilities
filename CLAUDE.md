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
- Base image: `node:20`
- `RUN npm rebuild better-sqlite3` is required — macOS binaries are incompatible with Linux
- `/app/data` is a Docker volume — the SQLite DB persists across container restarts
- `@napi-rs/canvas` is an optional dependency that sometimes fails to install correctly on macOS ARM64. Fix: `rm -rf node_modules package-lock.json && npm install`
- **DB note**: Switching Docker images resets the volume if the new container doesn't mount the same named volume. Existing linked users will need to re-link after a fresh container.

---

## Deployment Commands

### Full ship (GitHub + Docker Hub + Vercel)
```bash
npm run ship
# = bash scripts/deploy.sh
# Builds and pushes Docker image, pushes to GitHub, deploys to Vercel
# Then restart the container in JRMA dashboard to pull the new image
```

### Re-register Discord slash commands (REQUIRED after any command option change)
```bash
node deploy-commands.js --guild        # instant, ALL commands → DEV_GUILD_ID
node deploy-commands.js                 # global (up to 1hr propagation)

# Main guild — group flags COMBINE; each deploy REPLACES the whole main set,
# so pass every group you want live in ONE command:
node deploy-commands.js --main-server  # server commands: /lock, /unlock, /lfg
node deploy-commands.js --main-user    # user commands (link, unlink, leaderboard, profile, privacy, match, verify)
node deploy-commands.js --main-admin   # the 9 staff/admin commands
node deploy-commands.js --main-admin --main-server   # admin + server (current main set incl /lfg)
node deploy-commands.js --main-full    # everything (all groups)
```

> `npm run ship` does NOT re-register slash commands. Any change to command options, names, or new commands requires running `deploy-commands.js` separately.

### Deploy to main guild (when ready to go live)
```bash
node deploy-commands.js --main-full    # full command set, instant (registers all user + staff commands)
```

> The hidden staff commands (`/lookup`, `/setlink`, etc.) will only appear for staff
> after granting their roles access in **Server Settings → Integrations → (bot) →
> Command Permissions**. Until the bot is actually in the main guild with the
> `applications.commands` scope, deploys to it return `50001 Missing Access`.

### Clear all command scopes
```bash
node deploy-commands.js --clear                # global (up to ~1hr to disappear)
node deploy-commands.js --guild --clear        # dev guild (instant)
node deploy-commands.js --main-full --clear    # main guild (instant)
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
- `current_data.games_needed_for_rating` → placement games still required this act (see Placement handling below)
- `highest_rank` → peak tier data

### Placement handling (Act/Episode rollover)
At an Act rollover, Riot keeps returning a player's **previous** `currenttier` until
they finish their placement game(s) — so the API still shows e.g. Diamond 3 on day one
of a new act. `getRank()` treats `current_data.games_needed_for_rating > 0` as
**Unranked** (tier 0) for the new act, overriding the stale tier. The field defaults to
0 when absent, so this never regresses normally-ranked players. `getRank()` also returns
`inPlacements` (bool) and `gamesNeeded` (number) for any future "in placements" display.

> Caveat: this only flips a player to Unranked if HenrikDev actually populates
> `games_needed_for_rating > 0` for them. If they still show their old rank after a
> rollover, HenrikDev isn't exposing that field for the account yet — not a bug.

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

## Database (SQLite via better-sqlite3-multiple-ciphers)

File: `data/bot.db` (persisted as Docker volume at `/app/data`)

### Encryption at rest
Uses `better-sqlite3-multiple-ciphers` (drop-in replacement for `better-sqlite3`).
When `DB_ENCRYPTION_KEY` is set, `database.js` runs `PRAGMA key=...` immediately
after opening, so the `.db` file is AES-encrypted at rest (required by Discord's
developer policy for stored API data, and declared in the privileged-intent review).
`scripts/seed-test-data.js` applies the same key.

- The key PRAGMA must be the **first** statement after opening — before WAL/schema.
- If `DB_ENCRYPTION_KEY` is unset, the bot logs a warning and runs **unencrypted**
  (fine for local dev; must be set in JRMA for production).
- **An existing UNENCRYPTED `bot.db` cannot be opened once a key is set** (throws
  "file is not a database" → container crash loop). When enabling encryption, start
  from a fresh DB (wipe the volume). Pre-launch test data is disposable.
- Losing/changing the key makes the DB permanently unreadable — back it up.
- `npm rebuild better-sqlite3-multiple-ciphers` in the Dockerfile replaces the old
  `better-sqlite3` rebuild step.

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
**AP/OCE only** — region option removed from `/link` and `/setlink`. All accounts hardcoded to `config.riot.defaultRegion` (ap). Do not add region selectors back.

### Privacy toggle (`/privacy`)
- Users can hide themselves from the public `/leaderboard` ranked list
- Hidden accounts are **still counted in the rank distribution chart** (anonymous aggregate)
- Hidden accounts are visible to staff via `/links` (marked 🙈) and `/serverstats`
- `db.getPublicLinks()` — public list (hidden=0), used by leaderboard ranked entries
- `db.getAllLinks()` — all accounts including hidden, used by chart, admin commands, stats generation

### `/profile`
- Self-only — no `user` option. Staff use `/lookup` to look up others.
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

### Shared channel constants (`src/modules/channels.js`)
- `COMP_SQUAD_VCS` — the Comp 1–15 + Squad 0–10 voice channel IDs. Single source of
  truth used by `/lock`, `/unlock`, and `/lfg` (previously duplicated in lock/unlock).
- `LFG_CHANNELS` — the two looking-for-games text channels where `/lfg` may be run.
- Dev guild (`DEV_GUILD_ID`) bypasses both gates so it can be tested anywhere.

### Command groups (deploy + source dirs)
- `src/commands/user` — linking/rank commands (link, unlink, leaderboard, profile, privacy, match, verify)
- `src/commands/server` — server utilities (lock, unlock, lfg) — **not** linking-related
- `src/commands/admin` — the 9 staff commands
- `index.js` and `deploy-commands.js` load all three dirs. Main-guild deploy flags map
  to these groups: `--main-user` / `--main-server` / `--main-admin` (combine; `--main-full` = all).

### `/lfg` (in `src/commands/server`)
- Gated to `LFG_CHANNELS`; poster must be in a `COMP_SQUAD_VCS` voice channel.
- **Mode-conditional rank field** (no linked-account requirement):
  - Competitive → `rank` (manual text range, e.g. "Silver - Gold")
  - Premier → `division` (choice: Open/Intermediate/Advanced/Elite/Contender/Invite)
  - Casual → no rank/division field shown
  - Discord can't show options conditionally, so `rank` + `division` are both optional
    options; the embed uses whichever matches the mode.
  - *Future:* require a verified (RSO) linked account and auto-derive the Competitive range.
- **Not in a Comp/Squad VC →** posts a *minimal* LFG (LF count + rank/division + lobby
  code only; no Voice channel/Members fields, no Join button, not registered/tracked).
- **In a Comp/Squad VC →** full post. **Join** button is a real VC invite
  (`vc.createInvite`, 30-min) so it *connects* on click — needs Create Instant Invite
  (the bot runs with Administrator). The invite URL is stored in the registry and reused
  on re-render (not recreated each update). (Refresh button was removed — members update
  live; a "Refresh rank" button can return once rank is auto-derived from PUUIDs.)
- **Live updates + auto-expire:** an in-memory registry (`src/modules/lfg-posts.js`, keyed
  by message ID, 30-min TTL) lets `voiceStateUpdate` re-render any LFG post tied to a VC
  whose membership changed. When that VC hits **0 members**, the post is edited to an
  **Expired** state (no buttons) and removed from the registry. Best-effort; registry
  clears on restart. Future: `/premier`, premier-on-profile, leaderboard rework, `/lft`, `/scrim`.

### Booster tenure (`/booster`, in `src/commands/server`)
- **Continuous tenure only** — Discord exposes no cumulative-boost API, just
  `member.premiumSince` (current streak start on this guild). Tenure = months since then.
- Roles configured via `BOOSTER_TENURE_ROLES` (`months:roleId` pairs) → `config.discord.boosterRoles`.
  Logic in `src/utils/booster.js` (`computePlan` is pure + unit-tested).
- **Broken-streak role** (`BOOSTER_BROKEN_ROLE`): ex-boosters who reached
  `BOOSTER_BROKEN_THRESHOLD` (default 6) months then stopped. Detected with **no history
  storage** — at the moment they stop they still hold their tier role, so a non-booster
  holding a ≥6mo tier (or already holding the broken role) gets the broken-streak role
  instead of being stripped. It then persists.
- Reconcile (`reconcileMember`): boosting → exactly the qualifying tier (drop others +
  broken); not boosting → broken-streak if earned, else strip (unless
  `BOOSTER_STRIP_NONBOOSTERS=false`).
- **Manual only** — `/booster` reconciles the runner on demand. (An auto daily sweep
  existed briefly but was removed; could return as a staff `/boostersync` command.)
- **Role hierarchy is required:** the bot's role must sit **above** all booster tenure
  roles + the broken-streak role, or every add/remove fails with `Missing Permissions`.
  Administrator does NOT bypass role hierarchy for managing roles — only the server owner does.

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
Old version had tier ranges off by 2 (e.g. `tier === 25` for Radiant instead of `tier === 27`). Fixed in `src/utils/roles.js`. If any users have wrong rank roles, re-run `/setlink` to trigger reassignment.

### "The application did not respond" on a guild
`interactionCreate.js` drops any interaction whose `guildId` is not in
`config.discord.allowedGuildIds`, which is built from `GUILD_ID`, `DEV_GUILD_ID`, and
`MAIN_GUILD_ID`. If the bot is in a server but none of those env vars contain that
server's ID, every command silently returns → Discord shows "The application did not
respond" with nothing logged. Fix: ensure the guild's ID is set in one of those vars
(e.g. `GUILD_ID=537887361292304385` for main) and restart the container. Note
`MAIN_GUILD_ID` was added to the runtime allow-list specifically to prevent this.

> Distinguish from a missing-handler case: if logs show `Unknown command: <name>`, the
> running image is stale (old code) — rebuild/push and restart. Nothing logged at all =
> the guild allow-list gate above.

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
| `/lock` / `/unlock` | VC lock — Comp/Squad VCs only. |
| `/lfg` | Looking-for-group post (server group). Run in an LFG channel while in a Comp/Squad VC. `mode` (Competitive/Casual/Premier), `players` (1–4), `rank` (Competitive only), `division` (Premier only), `code` (optional). Members-in-voice updates live; Join button = VC deep-link. |

### Staff commands (standalone — `/admin` no longer exists)

As of the permission-hierarchy refactor, the single `/admin` command was split into
nine standalone top-level commands. Each is hidden from regular members via
`setDefaultMemberPermissions('0')` and gated in code by tier (see Permission Hierarchy
below). Visibility for staff is granted once per server via **Server Settings →
Integrations → (bot) → Command Permissions**.

| Command (old name) | Min tier | Notes |
|--------------------|----------|-------|
| `/lookup` (`admin link get`)        | Moderator (1)     | Show link info + history. Has `user` and `riot_id` options. |
| `/links` (`admin link list`)        | Moderator (1)     | All linked members (includes hidden, marked 🙈). `role`, `page` options. |
| `/resetlink` (`admin link reset`)   | Snr Moderator (2) | Remove link, force re-verification. `reason`, `silent` options. |
| `/serverstats` (`admin stats`)      | Admin (3)         | Member count, link rate, rank distribution (includes hidden). |
| `/exportlinks` (`admin export`)     | Admin (3)         | CSV export of linked accounts. `role` option. |
| `/setlink` (`admin link set`)       | Snr Admin (4)     | Force-link (no ownership challenge). Auto-fetches rank + role. `silent` option. |
| `/bulkreset` (`admin link bulk-reset`) | Snr Admin (4)  | Force re-verify entire role. `reason`, `silent` options. |
| `/linkpanel` (`admin link panel`)   | Snr Admin (4)     | Post the rank-role panel (Add / Update / Remove buttons → `link_btn`/`update_rank_btn`/`unlink_btn`) in current channel. |
| `/logsetup` (`admin log setup`)     | Snr Admin (4)     | Set staff activity log channel. |

> Splitting was a deliberate choice: separate top-level commands let Discord hide a
> command from roles that can't use it. Tier enforcement is still done in code
> (`src/utils/permissions.js`), which is the source of truth — the Integrations grant
> only controls visibility.

---

## Permission Hierarchy (main server)

Cumulative — each tier inherits every command of the tiers below it. A member's
effective level is the **highest** tier role they hold. Defined in
`config.discord.staffTiers` (env-driven) and enforced by `requireTier()` /
`memberLevel()` in `src/utils/permissions.js`.

| Level | Tier | Role ID | Adds access to |
|-------|------|---------|----------------|
| 1 | Moderator         | `537917072458383362` | `/lookup`, `/links` |
| 2 | Senior Moderator  | `952850368432320512` | `/resetlink` |
| 3 | Admin             | `537911688490385419` | `/serverstats`, `/exportlinks` |
| 4 | Senior Admin      | `883659514233114705` | `/setlink`, `/bulkreset`, `/linkpanel`, `/logsetup` |
| 5 | Head Admin        | `681608242379489280` | (everything prior) |
| 6 | Senior Management | `681467969280147474` | (everything prior) |

- **Bypass user** `974820968545542194` (`BYPASS_USER_IDS`) → runs every command, any role, level `Infinity`.
- **Discord Administrator** permission → also treated as level `Infinity` (covers server owner / dev guild).
- **Restricted role** `798956686580383794` → may run **only** `/lock` and `/unlock`. Enforced by a global gate in `interactionCreate.js` (`ALWAYS_ALLOWED` set). Bypass users are exempt.

### Command access tiers
- **Everyone, incl. Restricted:** `/lock`, `/unlock`
- **Everyone except Restricted:** `/link`, `/unlink`, `/leaderboard`, `/profile`, `/privacy`, `/match`, `/verify`
- **Staff (tier-gated):** the nine commands in the table above

### Adding/adjusting a command's required tier
Each command file calls `await requireTier(interaction, LEVELS.X)` at the top of
`execute`. Change the `LEVELS.X` constant to re-tier it. No central matrix — the gate
is co-located with each command.

---

## Environment Variables (.env)

```
DISCORD_TOKEN=
CLIENT_ID=
GUILD_ID=                    # a guild the bot serves (main: 537887361292304385)
DEV_GUILD_ID=                # test/dev guild
MAIN_GUILD_ID=537887361292304385   # main server (used by --main-* deploys AND the runtime allow-list)
# Runtime allow-list = [GUILD_ID, DEV_GUILD_ID, MAIN_GUILD_ID]. The bot ignores
# interactions from any guild not in this list (see "did not respond" gotcha).
ADMIN_ROLE_IDS=              # legacy single-tier admin roles, superseded by STAFF_ROLE_* below
RESTRICTED_ROLE_ID=798956686580383794   # may ONLY run /lock and /unlock

# Staff permission hierarchy (cumulative). See "Permission Hierarchy" section.
STAFF_ROLE_MOD=              # Moderator        (level 1)
STAFF_ROLE_SNR_MOD=          # Senior Moderator (level 2)
STAFF_ROLE_ADMIN=            # Admin            (level 3)
STAFF_ROLE_SNR_ADMIN=        # Senior Admin     (level 4)
STAFF_ROLE_HEAD_ADMIN=       # Head Admin       (level 5)
STAFF_ROLE_SNR_MGMT=         # Senior Management(level 6)
BYPASS_USER_IDS=             # comma-separated; run every command irrespective of roles

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

## JRMA Environment Variables (container config)

**`.env` is in `.dockerignore`** — it is NOT baked into the image. The running
container reads config only from the env vars set in the **JRMA dashboard → app →
Environment**. The local `.env` is for `npm run dev` only. After changing any var,
**restart the container** (env changes don't apply to a running container).

All role/ID values must belong to the server the bot actually runs against (main):

| ENV NAME | ID |
|----------|-----|
| `ROLE_UNRANKED` | `1067376098515619850` |
| `ROLE_IRON` | `729684895332302859` |
| `ROLE_BRONZE` | `729684963154329671` |
| `ROLE_SILVER` | `729683497249144874` |
| `ROLE_GOLD` | `729683894776889485` |
| `ROLE_PLATINUM` | `729685025074839562` |
| `ROLE_DIAMOND` | `729685114166050845` |
| `ROLE_ASCENDANT` | `987665252546125845` |
| `ROLE_IMMORTAL` | `729685190645121045` |
| `ROLE_RADIANT` | `729688533920645161` |
| `STAFF_ROLE_MOD` | `537917072458383362` |
| `STAFF_ROLE_SNR_MOD` | `952850368432320512` |
| `STAFF_ROLE_ADMIN` | `537911688490385419` |
| `STAFF_ROLE_SNR_ADMIN` | `883659514233114705` |
| `STAFF_ROLE_HEAD_ADMIN` | `681608242379489280` |
| `STAFF_ROLE_SNR_MGMT` | `681467969280147474` |
| `RESTRICTED_ROLE_ID` | `798956686580383794` |
| `BYPASS_USER_IDS` | `974820968545542194` |
| `BOOSTER_BROKEN_ROLE` | `1292857036509548667` |

`BOOSTER_TENURE_ROLES` (single var, `months:roleId` pairs):
```
1:689286086689685652,2:1056595830838145065,3:1056595827033903164,6:1056595820482396250,9:1056596188046041128,12:1056596225702510692,18:1056596209000775700,24:1056596218773520414,30:1056596221642428437,36:1147812501069770834,42:1147813204567785564,48:1410793949953790012
```

Plus the non-ID secrets/config: `DISCORD_TOKEN`, `CLIENT_ID`, `DISCORD_CLIENT_SECRET`,
`GUILD_ID`, `MAIN_GUILD_ID`, `HENRIK_API_KEY`, `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`, `OAUTH_REDIRECT_URI`, `DEFAULT_REGION`,
`DB_ENCRYPTION_KEY` (encryption-at-rest key — see Database section; required in prod),
`BOOSTER_BROKEN_THRESHOLD` (default 6), `BOOSTER_STRIP_NONBOOSTERS` (default true).

- Missing `STAFF_ROLE_*` → that tier matches no one (commands unreachable except bypass/Administrator).
- Missing `RESTRICTED_ROLE_ID` → the restricted gate silently does nothing.
- Missing `ROLE_*` → that rank can't be assigned.

---

## Seed / Test Data

```bash
node scripts/seed-test-data.js          # insert dummy accounts (dummy_ prefix discord IDs)
node scripts/seed-test-data.js --clean  # remove all dummy accounts, leave real ones intact
```

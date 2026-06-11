/**
 * Quick diagnostic — run this from the valorant-bot folder:
 *
 *   node test-api.js
 *
 * It will show exactly what HenrikDev returns for your account
 * so we can confirm the timestamp field name and format.
 */

require('dotenv').config();
const axios = require('axios');

const HENRIK_API_KEY = process.env.HENRIK_API_KEY;
const henrik = axios.create({
  baseURL: 'https://api.henrikdev.xyz',
  timeout: 15_000,
  headers: HENRIK_API_KEY ? { Authorization: HENRIK_API_KEY } : {},
});

// ── Change these if you want to test a different account ──
const NAME   = 'WALLHACK SP005';
const TAG    = 'WOK22';
const REGION = 'ap';
// ─────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== HenrikDev API diagnostic ===`);
  console.log(`API key present: ${!!HENRIK_API_KEY}`);

  // Step 1: get PUUID
  console.log(`\n[1] Looking up account ${NAME}#${TAG}...`);
  let puuid;
  try {
    const r = await henrik.get(
      `/valorant/v1/account/${encodeURIComponent(NAME)}/${encodeURIComponent(TAG)}`,
    );
    puuid = r.data?.data?.puuid;
    console.log(`    PUUID: ${puuid}`);
  } catch (err) {
    console.error(`    Account lookup failed: ${err.response?.status} ${err.message}`);
    process.exit(1);
  }

  // Step 2: name+tag matches endpoint
  console.log(`\n[2] Fetching matches via name+tag...`);
  try {
    const r = await henrik.get(
      `/valorant/v3/matches/${REGION}/${encodeURIComponent(NAME)}/${encodeURIComponent(TAG)}?size=1`,
    );
    const matches = r.data?.data ?? [];
    console.log(`    HTTP ${r.status} | matches returned: ${matches.length}`);
    if (matches[0]?.metadata) {
      const meta = matches[0].metadata;
      console.log(`    metadata keys: ${Object.keys(meta).join(', ')}`);
      console.log(`    started_at   : ${meta.started_at} (type: ${typeof meta.started_at})`);
      console.log(`    game_start   : ${meta.game_start}`);
    }
  } catch (err) {
    console.error(`    Failed: ${err.response?.status} ${err.message}`);
  }

  // Step 3: PUUID matches endpoint
  console.log(`\n[3] Fetching matches via PUUID...`);
  try {
    const r = await henrik.get(
      `/valorant/v3/by-puuid/matches/${REGION}/${puuid}?size=1`,
    );
    const matches = r.data?.data ?? [];
    console.log(`    HTTP ${r.status} | matches returned: ${matches.length}`);
    if (matches[0]?.metadata) {
      const meta = matches[0].metadata;
      console.log(`    metadata keys: ${Object.keys(meta).join(', ')}`);
      console.log(`    started_at   : ${meta.started_at} (type: ${typeof meta.started_at})`);
      const ts = typeof meta.started_at === 'string'
        ? new Date(meta.started_at).getTime()
        : meta.started_at > 1e12 ? meta.started_at : meta.started_at * 1000;
      const now = Date.now();
      console.log(`    parsed to ms : ${ts}`);
      console.log(`    match date   : ${new Date(ts).toUTCString()}`);
      console.log(`    now          : ${new Date(now).toUTCString()}`);
      console.log(`    match is ${((now - ts) / 60000).toFixed(1)} minutes ago`);
    }
  } catch (err) {
    console.error(`    Failed: ${err.response?.status} ${err.message}`);
  }

  console.log('\n=== done ===\n');
}

main().catch(console.error);

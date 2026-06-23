/**
 * One-time script to set the bot's avatar, banner, and bio.
 * Run once from the valorant-bot folder:
 *
 *   node set-bot-profile.js
 */

require('dotenv').config();

const AVATAR_URL = 'https://cdn.discordapp.com/avatars/1367857894397186058/343315bcc2033fd24ba904285c3505af.webp?size=160';
const BANNER_URL = 'https://cdn.discordapp.com/banners/1367857894397186058/d07aeec9fc6dcc23bef57498bd9cb79c.png?size=600';
const BIO        = 'Supporting discord.gg/valorantoce riot account verification.\n\nDeveloped by @5amothy\nhttps://valorant-oce-utilities.vercel.app';

async function fetchBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch image (${res.status}): ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mime   = res.headers.get('content-type') || 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function main() {
  if (!process.env.DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN not found in .env');
    process.exit(1);
  }

  console.log('Fetching avatar...');
  const avatar = await fetchBase64(AVATAR_URL);

  console.log('Fetching banner...');
  const banner = await fetchBase64(BANNER_URL);

  console.log('Patching bot profile...');
  const res = await fetch('https://discord.com/api/v10/users/@me', {
    method:  'PATCH',
    headers: {
      Authorization:  `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ avatar, banner, bio: BIO }),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('Discord API error:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('✅ Done!');
  if (data.avatar) console.log('  Avatar set');
  if (data.banner) console.log('  Banner set');
  console.log('  Bio:', BIO);

  // Note: if Discord rejects bio/banner for bot accounts, set them manually:
  // Developer Portal → your app → Bot tab → About Me / scroll down for banner
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

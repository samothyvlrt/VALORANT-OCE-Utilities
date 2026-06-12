/**
 * Vercel serverless function — Discord OAuth2 callback.
 *
 * URL: https://your-app.vercel.app/api/callback
 *
 * Flow:
 *   1. Discord redirects here with ?code=...&state=...
 *   2. We exchange the code for an access token
 *   3. We fetch the user's Discord connections
 *   4. We check if the expected Riot account is connected
 *   5. We write the result to Upstash Redis
 *   6. Bot picks it up within 15 seconds and DMs the user
 */

const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const { code, state, error } = req.query;

  // User clicked "Cancel" on the Discord auth screen
  if (error === 'access_denied') {
    return res.status(200).send(page('cancelled', 'Cancelled', 'You cancelled the authorization. Run <code>/link</code> again whenever you\'re ready.'));
  }

  if (!code || !state) {
    return res.status(400).send(page('error', 'Invalid request', 'Missing parameters. Run <code>/link</code> again to get a fresh link.'));
  }

  // ── Look up the pending OAuth state ──────────────────────────────────────
  let pending;
  try {
    pending = await redis.get(`oauth:${state}`);
  } catch (err) {
    console.error('[callback] Redis error:', err.message);
    return res.status(500).send(page('error', 'Server error', 'Could not connect to the verification service. Please try again in a moment.'));
  }

  if (!pending) {
    return res.status(400).send(page('error', 'Link expired', 'This verification link has expired or already been used. Run <code>/link</code> again.'));
  }

  // ── Exchange authorization code for access token ──────────────────────────
  let accessToken, refreshToken, tokenExpiresAt;
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  process.env.OAUTH_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('[callback] Token exchange failed:', tokenData);
      return res.status(400).send(page('error', 'Authorization failed', 'Discord authorization could not be completed. Please try again.'));
    }
    accessToken = tokenData.access_token;
    refreshToken = tokenData.refresh_token;
    tokenExpiresAt = Date.now() + ((tokenData.expires_in ?? 604800) * 1000);
  } catch (err) {
    console.error('[callback] Token exchange error:', err.message);
    return res.status(500).send(page('error', 'Server error', 'Failed to complete authorization. Please try again.'));
  }

  // ── Verify the authorizing user is the right Discord account ─────────────
  let discordUser;
  try {
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    discordUser = await userRes.json();
  } catch (err) {
    return res.status(500).send(page('error', 'Server error', 'Could not fetch your Discord profile. Please try again.'));
  }

  if (discordUser.id !== pending.discordId) {
    return res.status(403).send(page('error', 'Wrong Discord account',
      'You authorized with a different Discord account than the one that ran <code>/link</code>. ' +
      'Make sure you\'re logged into the correct Discord account and try again.',
    ));
  }

  // ── Fetch Discord connections ─────────────────────────────────────────────
  let connections;
  try {
    const connRes = await fetch('https://discord.com/api/users/@me/connections', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    connections = await connRes.json();
    if (!Array.isArray(connections)) throw new Error('Unexpected connections response');
  } catch (err) {
    console.error('[callback] Connections fetch error:', err.message);
    return res.status(500).send(page('error', 'Server error', 'Could not fetch your Discord connections. Please try again.'));
  }

  // ── Check for the expected Riot account ──────────────────────────────────
  const expectedName = `${pending.riotName}#${pending.riotTag}`.toLowerCase();
  const riotConn = connections.find(
    (c) => c.type === 'riotgames' && c.name?.toLowerCase() === expectedName,
  );

  // Clean up the state regardless of outcome
  await redis.del(`oauth:${state}`).catch(() => {});

  if (!riotConn) {
    // Write failure result — bot will DM the user with instructions
    await redis.set(`verified:${pending.discordId}`, {
      success:  false,
      reason:   'not_connected',
      riotName: pending.riotName,
      riotTag:  pending.riotTag,
    }, { ex: 300 }).catch(() => {});

    return res.send(page('fail',
      `${pending.riotName}#${pending.riotTag} not found`,
      `Your Discord connections don't include <strong>${pending.riotName}#${pending.riotTag}</strong>.<br><br>` +
      `Go to <strong>Discord Settings → Connections → Riot Games</strong>, connect that account, ` +
      `then run <code>/link</code> again.`,
    ));
  }

  // ── Success ───────────────────────────────────────────────────────────────
  await redis.set(`verified:${pending.discordId}`, {
    success:        true,
    discordId:      pending.discordId,
    puuid:          pending.puuid,
    riotName:       pending.riotName,
    riotTag:        pending.riotTag,
    region:         pending.region,
    accessToken:    accessToken    ?? null,
    refreshToken:   refreshToken   ?? null,
    tokenExpiresAt: tokenExpiresAt ?? null,
  }, { ex: 300 }).catch(() => {});

  return res.send(page('success',
    'Account verified!',
    `<strong>${pending.riotName}#${pending.riotTag}</strong> has been linked to your Discord.<br><br>` +
    `Return to Discord — the bot will confirm within a few seconds.`,
  ));
};

// ── HTML page renderer ────────────────────────────────────────────────────────

function page(type, title, message) {
  const palette = {
    success:   { accent: '#57F287', bg: '#0f2b1a', icon: '✅' },
    fail:      { accent: '#FEE75C', bg: '#2b2700', icon: '⚠️' },
    error:     { accent: '#ED4245', bg: '#2b0f10', icon: '❌' },
    cancelled: { accent: '#B9BBBE', bg: '#1a1a1a', icon: '↩️' },
  };
  const { accent, bg, icon } = palette[type] || palette.error;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Valorant OCE Utilities</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d0d0d;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      background: ${bg};
      border: 1px solid ${accent}44;
      border-radius: 20px;
      padding: 52px 44px;
      max-width: 500px;
      width: 100%;
      text-align: center;
      box-shadow: 0 0 60px ${accent}18;
    }
    .icon   { font-size: 60px; margin-bottom: 24px; line-height: 1; }
    h1      { font-size: 26px; font-weight: 700; color: ${accent}; margin-bottom: 14px; }
    p       { font-size: 15px; line-height: 1.7; color: #b0b8c1; }
    strong  { color: #e8eaed; font-weight: 600; }
    code    {
      background: #ffffff18;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      color: ${accent};
    }
    .footer { margin-top: 32px; font-size: 12px; color: #55606a; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <p class="footer">Valorant OCE Utilities</p>
  </div>
</body>
</html>`;
}

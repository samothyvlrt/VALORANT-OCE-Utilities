#!/bin/bash
set -e

echo "🚀 Deploying Valorant OCE Utilities..."
echo ""

# ── 1. GitHub ──────────────────────────────────────────────────────────────
echo "📦 Pushing to GitHub..."
git push origin main
echo "✅ GitHub done"
echo ""

# ── 2. JRMA ───────────────────────────────────────────────────────────────
echo "🤖 Pushing to JRMA (bot server)..."
git push https://e3F4Ta:f3HFy4a6@justrunmy.app/git/r_Kp9b8 HEAD:deploy
echo "✅ JRMA done"
echo ""

# ── 3. Vercel ─────────────────────────────────────────────────────────────
echo "🌐 Deploying to Vercel..."
vercel --prod
echo "✅ Vercel done"
echo ""

echo "🎉 All done! Remember to restart the bot on JRMA."

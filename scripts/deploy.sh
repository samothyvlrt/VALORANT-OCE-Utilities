#!/bin/bash
set -e

echo "🚀 Deploying Valorant OCE Utilities..."
echo ""

# ── 1. GitHub ──────────────────────────────────────────────────────────────
echo "📦 Pushing to GitHub..."
git push origin main
echo "✅ GitHub done"
echo ""

# ── 2. Docker Hub ─────────────────────────────────────────────────────────
echo "🐳 Building and pushing Docker image..."
docker build --no-cache --platform linux/amd64 -t 5amothy/valorant-bot:latest .
docker push 5amothy/valorant-bot:latest
echo "✅ Docker done"
echo ""

# ── 3. Vercel ─────────────────────────────────────────────────────────────
echo "🌐 Deploying to Vercel..."
vercel --prod
echo "✅ Vercel done"
echo ""

echo "🎉 All done! Restart the bot in the JRMA dashboard to pull the new image."

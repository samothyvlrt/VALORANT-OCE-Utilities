/**
 * rank-chart.js
 * Generates a rank distribution bar chart PNG for the /leaderboard embed.
 */

const { createCanvas } = require('@napi-rs/canvas');

// Colour per tier index (0-2 unused, 3=Iron1 … 27=Radiant)
const TIER_COLORS = [
  null, null, null,
  '#594134', '#594134', '#594134',  // Iron 1-3
  '#9E6230', '#9E6230', '#9E6230',  // Bronze 1-3
  '#8BA7B7', '#8BA7B7', '#8BA7B7',  // Silver 1-3
  '#D4AF51', '#D4AF51', '#D4AF51',  // Gold 1-3
  '#3AB8B3', '#3AB8B3', '#3AB8B3',  // Platinum 1-3
  '#6B56C4', '#6B56C4', '#6B56C4',  // Diamond 1-3
  '#19A97B', '#19A97B', '#19A97B',  // Ascendant 1-3
  '#BF3136', '#BF3136', '#BF3136',  // Immortal 1-3
  '#FFD63A',                         // Radiant
];

// [startTier, endTier, label]
const GROUPS = [
  [3,  5,  'Iron'],
  [6,  8,  'Bronze'],
  [9,  11, 'Silver'],
  [12, 14, 'Gold'],
  [15, 17, 'Plat'],
  [18, 20, 'Dia'],
  [21, 23, 'Asc'],
  [24, 26, 'Imm'],
  [27, 27, 'Rad'],
];

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Generate a rank distribution chart PNG buffer.
 *
 * @param {Array}       entries     - leaderboard entries with {tier}
 * @param {number|null} viewerTier  - viewer's current tier (for "you are here" mode)
 * @returns {{ buffer: Buffer, betterThanPct: number|null }}
 */
function generateRankChart(entries, viewerTier = null) {
  // 2× resolution for crisp rendering in Discord
  const S = 2;
  const W = 520 * S, H = 80 * S;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, W, H);

  // Count members per tier
  const counts = new Array(28).fill(0);
  for (const e of entries) {
    if (e.tier >= 3 && e.tier <= 27) counts[e.tier]++;
  }
  const maxCount = Math.max(...counts.slice(3));

  // "Better than" percentage
  let betterThanPct = null;
  if (viewerTier != null && viewerTier >= 3) {
    const below = entries.filter(e => e.tier < viewerTier).length;
    betterThanPct = Math.round((below / entries.length) * 100);
  }

  if (maxCount === 0) return { buffer: canvas.toBuffer('image/png'), betterThanPct };

  // Layout — all values scaled by S
  const PAD_L  = 8  * S, PAD_R = 8 * S;
  const PAD_T  = (betterThanPct != null ? 18 : 6) * S;
  const PAD_B  = 18 * S;
  const CHART_W = W - PAD_L - PAD_R;
  const CHART_H = H - PAD_T - PAD_B;
  const GROUP_GAP = 3 * S;
  const N_GAPS    = GROUPS.length - 1; // 8
  const N_BARS    = 25;                // tiers 3-27
  const barW      = (CHART_W - GROUP_GAP * N_GAPS) / N_BARS;

  const viewerGroupIdx = viewerTier != null
    ? GROUPS.findIndex(([s, e]) => viewerTier >= s && viewerTier <= e)
    : -1;

  let x = PAD_L;

  for (let gi = 0; gi < GROUPS.length; gi++) {
    const [startTier, endTier, label] = GROUPS[gi];
    const groupStartX  = x;
    const barsInGroup  = endTier - startTier + 1;
    const isViewerGroup = gi === viewerGroupIdx;

    for (let tier = startTier; tier <= endTier; tier++) {
      const count  = counts[tier];
      const barH   = Math.max(3 * S, (count / maxCount) * CHART_H);
      const barY   = PAD_T + CHART_H - barH;
      const color  = TIER_COLORS[tier];
      const isThis = tier === viewerTier;

      // Dimming
      let alpha = 1.0;
      if (viewerTier != null) {
        if (isThis)             alpha = 1.0;
        else if (isViewerGroup) alpha = 0.55;
        else                    alpha = 0.2;
      }

      ctx.fillStyle = alpha < 1 ? hexToRgba(color, alpha) : color;

      // Bar with rounded top corners
      const r = 2 * S;
      ctx.beginPath();
      ctx.moveTo(x + r, barY);
      ctx.lineTo(x + barW - 1 - r, barY);
      ctx.arcTo(x + barW - 1, barY, x + barW - 1, barY + r, r);
      ctx.lineTo(x + barW - 1, barY + barH);
      ctx.lineTo(x, barY + barH);
      ctx.lineTo(x, barY + r);
      ctx.arcTo(x, barY, x + r, barY, r);
      ctx.closePath();
      ctx.fill();

      // White highlight ring on viewer's exact tier
      if (isThis) {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth   = 1.5 * S;
        ctx.beginPath();
        ctx.moveTo(x + r - S, barY - 1.5 * S);
        ctx.lineTo(x + barW - r, barY - 1.5 * S);
        ctx.arcTo(x + barW + 0.5 * S, barY - 1.5 * S, x + barW + 0.5 * S, barY + r, r);
        ctx.lineTo(x + barW + 0.5 * S, barY + barH + S);
        ctx.lineTo(x - 0.5 * S, barY + barH + S);
        ctx.lineTo(x - 0.5 * S, barY + r);
        ctx.arcTo(x - 0.5 * S, barY - 1.5 * S, x + r - S, barY - 1.5 * S, r);
        ctx.closePath();
        ctx.stroke();
      }

      x += barW;
    }

    // Group label
    const labelX = groupStartX + (barsInGroup * barW) / 2;
    ctx.font      = `${isViewerGroup ? 'bold ' : ''}${9 * S}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = isViewerGroup
      ? '#e8eaed'
      : viewerTier != null ? '#363b44' : '#5a6070';
    ctx.fillText(label, labelX, H - 4 * S);

    if (gi < GROUPS.length - 1) x += GROUP_GAP;
  }

  // "Better than X%" label — top right
  if (betterThanPct != null) {
    const color   = TIER_COLORS[viewerTier] ?? '#e8eaed';
    ctx.font      = `bold ${10 * S}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillStyle = color;
    ctx.fillText(`better than ${betterThanPct}% of the server`, W - PAD_R, 13 * S);
  }

  return { buffer: canvas.toBuffer('image/png'), betterThanPct };
}

module.exports = { generateRankChart };

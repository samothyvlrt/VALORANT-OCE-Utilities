/**
 * rr-graph.js
 * Generates an RR-over-time line graph PNG for the /profile embed,
 * rendered from rank_history snapshots (tracker.gg style).
 */

const { createCanvas } = require('@napi-rs/canvas');

// Colour per rank group (same palette as rank-chart.js)
const GROUP_COLORS = {
  Iron: '#594134', Bronze: '#9E6230', Silver: '#8BA7B7', Gold: '#D4AF51',
  Platinum: '#3AB8B3', Diamond: '#6B56C4', Ascendant: '#19A97B',
  Immortal: '#BF3136', Radiant: '#FFD63A',
};

// Short label + colour for a tier number (3=Iron1 … 27=Radiant)
const SUBTIER_LABELS = [
  null, null, null,
  'Iron 1', 'Iron 2', 'Iron 3',
  'Brz 1', 'Brz 2', 'Brz 3',
  'Sil 1', 'Sil 2', 'Sil 3',
  'Gold 1', 'Gold 2', 'Gold 3',
  'Plat 1', 'Plat 2', 'Plat 3',
  'Dia 1', 'Dia 2', 'Dia 3',
  'Asc 1', 'Asc 2', 'Asc 3',
  'Imm 1', 'Imm 2', 'Imm 3',
  'Rad',
];

function tierColor(tier) {
  if (tier >= 27) return GROUP_COLORS.Radiant;
  if (tier >= 24) return GROUP_COLORS.Immortal;
  if (tier >= 21) return GROUP_COLORS.Ascendant;
  if (tier >= 18) return GROUP_COLORS.Diamond;
  if (tier >= 15) return GROUP_COLORS.Platinum;
  if (tier >= 12) return GROUP_COLORS.Gold;
  if (tier >= 9)  return GROUP_COLORS.Silver;
  if (tier >= 6)  return GROUP_COLORS.Bronze;
  return GROUP_COLORS.Iron;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Map a history point to a single monotonic value.
 * Sub-Immortal: tier*100 + within-tier RR (each sub-tier spans 100).
 * Immortal+: 2400 + cumulative RR above Immortal 1 0 RR — Imm 2/3 offset by
 * 100/200; Radiant's ranking_in_tier is already cumulative (see CLAUDE.md).
 */
function pointValue(tier, rr) {
  if (tier >= 24) {
    let cumulative = rr;
    if (tier === 25) cumulative = 100 + rr;
    if (tier === 26) cumulative = 200 + rr;
    return 2400 + cumulative;
  }
  return tier * 100 + rr;
}

/** Label for a horizontal gridline value (a multiple of 100). */
function gridLabel(value) {
  const idx = Math.floor(value / 100);
  if (idx >= 27) return `Rad ${value - 2700 > 0 ? '+' + (value - 2700) : ''}`.trim();
  return SUBTIER_LABELS[idx] ?? '';
}

function formatDate(ms) {
  const d = new Date(ms);
  return `${d.getDate()} ${d.toLocaleString('en-AU', { month: 'short' })}`;
}

/**
 * Generate an RR-over-time graph PNG buffer.
 *
 * @param {Array} history — rank_history rows { tier, tier_name, rr, recorded_at }, oldest first
 * @returns {Buffer|null}  — PNG buffer, or null if fewer than 2 points
 */
function generateRrGraph(history) {
  if (!history || history.length < 2) return null;

  // 2× resolution for crisp rendering in Discord
  const S = 2;
  const W = 520 * S, H = 170 * S;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(0, 0, W, H);

  const points = history.map((h) => ({
    t:     h.recorded_at,
    v:     pointValue(h.tier, h.rr),
    tier:  h.tier,
    rr:    h.rr,
  }));

  const vMin = Math.min(...points.map((p) => p.v));
  const vMax = Math.max(...points.map((p) => p.v));
  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;

  // Pad the value range so the line doesn't hug the edges; ensure a minimum
  // span so a flat-ish history still renders with visible room.
  let lo = vMin - 25, hi = vMax + 25;
  if (hi - lo < 120) {
    const mid = (hi + lo) / 2;
    lo = mid - 60;
    hi = mid + 60;
  }

  const PAD_L = 46 * S, PAD_R = 14 * S, PAD_T = 14 * S, PAD_B = 22 * S;
  const CHART_W = W - PAD_L - PAD_R;
  const CHART_H = H - PAD_T - PAD_B;

  const xFor = (t) => tMax === tMin
    ? PAD_L + CHART_W / 2
    : PAD_L + ((t - tMin) / (tMax - tMin)) * CHART_W;
  const yFor = (v) => PAD_T + CHART_H - ((v - lo) / (hi - lo)) * CHART_H;

  // ── Horizontal gridlines at sub-tier boundaries ─────────────────────────
  const firstLine = Math.ceil(lo / 100) * 100;
  const lines = [];
  for (let v = firstLine; v <= hi; v += 100) lines.push(v);
  // Thin out if too many boundaries fit in the range
  const step = Math.max(1, Math.ceil(lines.length / 5));
  for (let i = 0; i < lines.length; i++) {
    if (i % step !== 0) continue;
    const v = lines[i];
    const y = yFor(v);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth   = 1 * S;
    ctx.beginPath();
    ctx.moveTo(PAD_L, y);
    ctx.lineTo(W - PAD_R, y);
    ctx.stroke();

    ctx.font      = `${8.5 * S}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillStyle = hexToRgba(tierColor(Math.floor(v / 100)), 0.9);
    ctx.fillText(gridLabel(v), PAD_L - 5 * S, y + 3 * S);
  }

  // ── Date labels (first / mid / last) ────────────────────────────────────
  ctx.font      = `${8.5 * S}px sans-serif`;
  ctx.fillStyle = '#5a6070';
  ctx.textAlign = 'left';
  ctx.fillText(formatDate(tMin), PAD_L, H - 8 * S);
  ctx.textAlign = 'right';
  ctx.fillText(formatDate(tMax), W - PAD_R, H - 8 * S);
  if (tMax - tMin > 3 * 86400 * 1000) {
    ctx.textAlign = 'center';
    ctx.fillText(formatDate((tMin + tMax) / 2), PAD_L + CHART_W / 2, H - 8 * S);
  }

  // ── Area fill under the line (current tier colour, faint gradient) ──────
  const lastColor = tierColor(points[points.length - 1].tier);
  const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + CHART_H);
  grad.addColorStop(0, hexToRgba(lastColor, 0.22));
  grad.addColorStop(1, hexToRgba(lastColor, 0.02));
  ctx.beginPath();
  ctx.moveTo(xFor(points[0].t), PAD_T + CHART_H);
  for (const p of points) ctx.lineTo(xFor(p.t), yFor(p.v));
  ctx.lineTo(xFor(points[points.length - 1].t), PAD_T + CHART_H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // ── Line segments, coloured by the tier being moved into ────────────────
  ctx.lineWidth = 2 * S;
  ctx.lineJoin  = 'round';
  for (let i = 1; i < points.length; i++) {
    ctx.strokeStyle = tierColor(points[i].tier);
    ctx.beginPath();
    ctx.moveTo(xFor(points[i - 1].t), yFor(points[i - 1].v));
    ctx.lineTo(xFor(points[i].t), yFor(points[i].v));
    ctx.stroke();
  }

  // ── Point dots (skip when dense) ────────────────────────────────────────
  if (points.length <= 30) {
    for (const p of points) {
      ctx.fillStyle = tierColor(p.tier);
      ctx.beginPath();
      ctx.arc(xFor(p.t), yFor(p.v), 2.5 * S, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Highlight the latest point ──────────────────────────────────────────
  const last = points[points.length - 1];
  ctx.fillStyle = lastColor;
  ctx.beginPath();
  ctx.arc(xFor(last.t), yFor(last.v), 4 * S, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth   = 1.5 * S;
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

module.exports = { generateRrGraph };

import * as THREE from 'three';

// Procedural per-material detail textures for tiles — no asset files (pure
// browser canvas). Each is a mostly-light grayscale grain so it MULTIPLIES with
// the tile's own colour (wood grain in the tile's brown, brushed lines in its
// grey, etc.). Generated once and cached, then shared across every tile of that
// material (one GPU texture; per-tile materials only differ by colour).

const _cache = new Map();
const SIZE = 256;

function _canvas() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return c;
}

function _drawWood(ctx) {
  ctx.fillStyle = '#cfcfcf'; ctx.fillRect(0, 0, SIZE, SIZE);
  // Vertical grain — wavy darker streaks down the plank.
  for (let i = 0; i < 46; i++) {
    const x = Math.random() * SIZE;
    const w = 1 + Math.random() * 3;
    const dark = 150 + Math.random() * 70;
    ctx.strokeStyle = `rgba(${dark},${dark - 20},${dark - 40},${0.18 + Math.random() * 0.22})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= SIZE; y += 16) ctx.lineTo(x + Math.sin(y * 0.05 + i) * 4, y);
    ctx.stroke();
  }
  // A couple of knots.
  for (let k = 0; k < 2; k++) {
    const kx = 40 + Math.random() * (SIZE - 80), ky = 40 + Math.random() * (SIZE - 80);
    for (let r = 14; r > 0; r -= 2) {
      ctx.strokeStyle = `rgba(110,85,60,${0.18})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(kx, ky, r, r * 0.7, 0.3, 0, Math.PI * 2); ctx.stroke();
    }
  }
}

function _drawMetal(ctx) {
  ctx.fillStyle = '#d6d6d6'; ctx.fillRect(0, 0, SIZE, SIZE);
  // Horizontal brushed streaks.
  for (let i = 0; i < 220; i++) {
    const y = Math.random() * SIZE;
    const g = 150 + Math.random() * 90;
    ctx.strokeStyle = `rgba(${g},${g},${g},${0.06 + Math.random() * 0.1})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(SIZE, y + (Math.random() - 0.5) * 4); ctx.stroke();
  }
  // Corner rivets.
  for (const [bx, by] of [[24, 24], [SIZE - 24, 24], [24, SIZE - 24], [SIZE - 24, SIZE - 24]]) {
    const grad = ctx.createRadialGradient(bx - 2, by - 2, 1, bx, by, 9);
    grad.addColorStop(0, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(90,90,90,0.5)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(bx, by, 8, 0, Math.PI * 2); ctx.fill();
  }
}

function _drawStone(ctx) {
  ctx.fillStyle = '#c4c4c4'; ctx.fillRect(0, 0, SIZE, SIZE);
  // Speckle.
  for (let i = 0; i < 2600; i++) {
    const v = 120 + Math.random() * 110;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.25})`;
    ctx.fillRect(Math.random() * SIZE, Math.random() * SIZE, 2, 2);
  }
  // A few cracks.
  for (let i = 0; i < 5; i++) {
    ctx.strokeStyle = 'rgba(80,80,80,0.35)'; ctx.lineWidth = 1 + Math.random();
    let x = Math.random() * SIZE, y = Math.random() * SIZE;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}

function _drawIce(ctx) {
  ctx.fillStyle = '#eef6ff'; ctx.fillRect(0, 0, SIZE, SIZE);
  // Branching crackle.
  ctx.strokeStyle = 'rgba(150,190,230,0.5)';
  for (let i = 0; i < 10; i++) {
    let x = Math.random() * SIZE, y = Math.random() * SIZE;
    ctx.lineWidth = 0.8 + Math.random();
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += (Math.random() - 0.5) * 50; y += (Math.random() - 0.5) * 50; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  // Glints.
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(Math.random() * SIZE, Math.random() * SIZE, 2, 2);
  }
}

const _DRAW = { wood: _drawWood, metal: _drawMetal, stone: _drawStone, ice: _drawIce };

export function getTileTexture(material) {
  const key = _DRAW[material] ? material : 'stone';
  if (_cache.has(key)) return _cache.get(key);
  const c = _canvas();
  _DRAW[key](c.getContext('2d'));
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  _cache.set(key, tex);
  return tex;
}

// PBR feel per material (used on the full-quality path only).
export const TILE_PBR = {
  wood:  { metalness: 0.0,  roughness: 0.85 },
  stone: { metalness: 0.0,  roughness: 0.95 },
  metal: { metalness: 0.85, roughness: 0.4 },
  ice:   { metalness: 0.1,  roughness: 0.12 },
};

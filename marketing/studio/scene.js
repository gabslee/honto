/* HONTO?! — 15s vertical motion graphics spot. Deterministic canvas renderer. */
const W = 1080, H = 1920, FPS = 60, DUR = 20, TOTAL = Math.round(FPS * DUR), SUB = 3;
const C = {
  ink: '#17243d', ink2: '#203venue', paper: '#fff7e8', cream: '#ffe8ba', red: '#f04444',
  pink: '#ff8eab', yellow: '#ffd644', mint: '#a8e6cf', blue: '#b6dcff', white: '#fffdf8',
};
C.ink2 = '#203254';
const JP = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Hiragino Sans GB","PingFang SC",sans-serif';
const TAU = Math.PI * 2, RAD = Math.PI / 180;

/* ---------- math ---------- */
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const st = (t, a, b) => clamp((t - a) / (b - a));
const oc = t => 1 - Math.pow(1 - t, 3);
const oq = t => 1 - Math.pow(1 - t, 5);
const oe = t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const ic = t => t * t * t;
const iq = t => t * t;
const io = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const ob = (t, s = 1.8) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
const wob = (t, f = 2, d = 6) => (t >= 1 ? 0 : Math.exp(-d * t) * Math.sin(f * Math.PI * t));
const spring = (t, f = 3, d = 7) => (t >= 1 ? 1 : 1 - Math.exp(-d * t) * Math.cos(f * Math.PI * t));
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

/* ---------- drawing primitives ---------- */
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function font(g, size, weight = 1000, ls = -0.055, fam = 'Geist') {
  g.font = `${weight} ${size}px ${fam}`; g.letterSpacing = (size * ls).toFixed(2) + 'px';
}
function tw(g, s) { const ls = parseFloat(g.letterSpacing) || 0; return g.measureText(s).width - ls; }

function text(g, s, x, y, o = {}) {
  const { size = 60, weight = 1000, ls = -0.055, fill = C.ink, align = 'center', rot = 0,
    alpha = 1, sh = 0, shadow = C.ink, fam = 'Geist', skew = 0, maxW = 0, scale = 1,
    baseline = 'middle', stroke = null, sw = 0 } = o;
  g.save(); font(g, size, weight, ls, fam);
  const lsp = parseFloat(g.letterSpacing) || 0;
  let wid = tw(g, s), sc = scale;
  if (maxW && wid > maxW) sc *= maxW / wid;
  g.globalAlpha *= alpha; g.translate(x, y); g.rotate(rot);
  if (skew) g.transform(1, 0, skew, 1, 0, 0);
  g.scale(sc, sc);
  if (align === 'center') g.translate(-lsp / 2, 0);
  g.textAlign = align; g.textBaseline = baseline;
  if (sh) { g.fillStyle = shadow; g.fillText(s, sh, sh); }
  if (stroke) { g.strokeStyle = stroke; g.lineWidth = sw; g.lineJoin = 'round'; g.strokeText(s, 0, 0); }
  g.fillStyle = fill; g.fillText(s, 0, 0);
  g.restore();
  return wid * sc;
}

function letters(g, s, cx, cy, o = {}, per = () => ({})) {
  const { size = 60, weight = 1000, ls = -0.055, fill = C.ink, fam = 'Geist', maxW = 0, alpha = 1 } = o;
  g.save(); font(g, size, weight, ls, fam);
  const lsp = parseFloat(g.letterSpacing) || 0;
  const chars = [...s], ws = chars.map(c => g.measureText(c).width + lsp);
  const total = ws.reduce((a, b) => a + b, 0) - lsp;
  let sc = 1; if (maxW && total > maxW) sc = maxW / total;
  let x = cx - (total * sc) / 2;
  g.globalAlpha *= alpha;
  chars.forEach((c, i) => {
    const p = per(i, chars.length) || {}, cw = ws[i] * sc;
    g.save();
    g.globalAlpha *= (p.alpha === undefined ? 1 : p.alpha);
    g.translate(x + cw / 2 + (p.dx || 0), cy + (p.dy || 0));
    g.rotate(p.rot || 0);
    const ps = (p.scale === undefined ? 1 : p.scale) * sc;
    g.scale(ps, ps * (p.sy === undefined ? 1 : p.sy));
    if (p.skew) g.transform(1, 0, p.skew, 1, 0, 0);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (p.sh) { g.fillStyle = p.shadow || C.ink; g.fillText(c, p.sh, p.sh); }
    g.fillStyle = p.fill || fill; g.fillText(c, 0, 0);
    g.restore();
    x += cw;
  });
  g.restore();
  return total * sc;
}

function sticker(g, cx, cy, w, h, r, o = {}, body) {
  const { fill = C.paper, stroke = C.ink, sw = 8, sh = 14, shadow = C.ink, rot = 0,
    alpha = 1, scale = 1, sx = null, sy = null } = o;
  g.save(); g.globalAlpha *= alpha;
  g.translate(cx, cy); g.rotate(rot); g.scale(scale, scale);
  const ox = sx === null ? sh : sx, oy = sy === null ? sh : sy;
  if (sh || sx !== null) { g.fillStyle = shadow; rr(g, -w / 2 + ox, -h / 2 + oy, w, h, r); g.fill(); }
  g.fillStyle = fill; rr(g, -w / 2, -h / 2, w, h, r); g.fill();
  if (sw) { g.strokeStyle = stroke; g.lineWidth = sw; g.stroke(); }
  if (body) { g.save(); body(g, w, h); g.restore(); }
  g.restore();
}

function circ(g, cx, cy, r, o = {}, body) {
  const { fill = C.paper, stroke = C.ink, sw = 8, sh = 12, shadow = C.ink, alpha = 1,
    scale = 1, rot = 0, ring = null, ringGap = 10, ringW = 4, ringA = 0.7 } = o;
  g.save(); g.globalAlpha *= alpha; g.translate(cx, cy); g.rotate(rot); g.scale(scale, scale);
  if (sh) { g.fillStyle = shadow; g.beginPath(); g.arc(sh, sh, r, 0, TAU); g.fill(); }
  g.fillStyle = fill; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill();
  if (sw) { g.strokeStyle = stroke; g.lineWidth = sw; g.stroke(); }
  if (ring) { g.strokeStyle = ring; g.lineWidth = ringW; g.globalAlpha *= ringA; g.beginPath(); g.arc(0, 0, r + ringGap, 0, TAU); g.stroke(); g.globalAlpha /= ringA; }
  if (body) { g.save(); body(g, r); g.restore(); }
  g.restore();
}

function ringBurst(g, cx, cy, t, o = {}) {
  const { count = 3, color = C.ink, from = 40, to = 620, dur = 0.45, lw = 10, stagger = 0.06, alpha = 1 } = o;
  for (let i = 0; i < count; i++) {
    const p = st(t, i * stagger, i * stagger + dur); if (p <= 0 || p >= 1) continue;
    g.save(); g.globalAlpha = (1 - p) * 0.85 * alpha; g.strokeStyle = color; g.lineWidth = lw * (1 - p * 0.7);
    g.beginPath(); g.arc(cx, cy, lerp(from, to, oe(p)), 0, TAU); g.stroke(); g.restore();
  }
}

function rays(g, cx, cy, t, o = {}) {
  const { n = 14, color = C.cream, len = 1500, spin = 0.06, alpha = 0.5, w = 0.028 } = o;
  g.save(); g.globalAlpha *= alpha; g.fillStyle = color; g.translate(cx, cy); g.rotate(t * spin);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    g.beginPath(); g.moveTo(0, 0);
    g.arc(0, 0, len, a - w * TAU, a + w * TAU); g.closePath(); g.fill();
  }
  g.restore();
}

function halftone(g, x, y, w, h, o = {}) {
  const { gap = 26, r = 5, color = C.ink, alpha = 0.16, fade = true } = o;
  g.save(); g.globalAlpha *= alpha; g.fillStyle = color;
  for (let yy = y; yy < y + h; yy += gap) {
    const f = fade ? 1 - (yy - y) / h : 1;
    for (let xx = x; xx < x + w; xx += gap) {
      g.beginPath(); g.arc(xx, yy, r * f, 0, TAU); g.fill();
    }
  }
  g.restore();
}

function confetti(g, cx, cy, t, seed, o = {}) {
  const { n = 22, dur = 1.4, spread = 760, colors = [C.yellow, C.pink, C.mint, C.red, C.ink] } = o;
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const a = r() * TAU, d = spread * (0.35 + r() * 0.65), sz = 14 + r() * 22, rot0 = r() * TAU, spin = (r() - 0.5) * 16;
    const p = st(t, r() * 0.06, dur); if (p <= 0) continue;
    const e = oe(p);
    const x = cx + Math.cos(a) * d * e, y = cy + Math.sin(a) * d * e + 520 * iq(p);
    g.save(); g.globalAlpha = 1 - iq(p); g.translate(x, y); g.rotate(rot0 + spin * p);
    g.fillStyle = colors[i % colors.length];
    g.fillRect(-sz / 2, -sz / 3, sz, sz * 0.66);
    g.strokeStyle = C.ink; g.lineWidth = 2.5; g.strokeRect(-sz / 2, -sz / 3, sz, sz * 0.66);
    g.restore();
  }
}

/* ---------- mini-game icons (from the product UI) ---------- */
const ICON_FILL = { honto: '#ffd644', both: '#ffd644', question: '#a8e6cf', preference: '#a9d5ff', rps: '#a9d5ff', wouldrather: '#ff8eab', estimate: '#ff8eab' };
const ICON_BG = { honto: 'yellow', question: 'mint', wouldrather: 'yellow', preference: 'blue', estimate: 'pink', rps: 'blue', both: 'yellow' };
const LABELS = { honto: 'TWO LIES, ONE TRUTH', question: 'QUESTION OR SIPS', wouldrather: 'WOULD YOU RATHER?', preference: 'READ MY MIND', estimate: 'NUMBER ESTIMATE', rps: 'JOKEN-PÔ', both: 'BOTH DRINK' };
const TYPES = ['honto', 'question', 'wouldrather', 'preference', 'estimate', 'rps', 'both'];
const K = '#17243d';
function iconArt(type) {
  const f = ICON_FILL[type];
  const face = `<circle cx="37" cy="45" r="3.5" fill="${K}"/><circle cx="59" cy="45" r="3.5" fill="${K}"/><path d="M38 61c6 5 14 5 20 0" fill="none" stroke="${K}" stroke-width="4" stroke-linecap="round"/>`;
  if (type === 'honto') return `<rect x="23" y="28" width="34" height="47" rx="6" fill="#ff8eab" stroke="${K}" stroke-width="4" transform="rotate(-10 23 28)"/><rect x="39" y="20" width="34" height="47" rx="6" fill="${f}" stroke="${K}" stroke-width="4" transform="rotate(8 39 20)"/><path d="M49 37h14M49 47h9" stroke="${K}" stroke-width="4" stroke-linecap="round"/><path d="M76 64l5 8 8-4-5-8z" fill="#f04444" stroke="${K}" stroke-width="3"/>`;
  if (type === 'question') return `<path d="M18 25c0-7 6-12 13-12h34c7 0 13 5 13 12v25c0 7-6 12-13 12H42L28 77V62h-2c-5-2-8-6-8-12z" fill="${f}" stroke="${K}" stroke-width="4" stroke-linejoin="round"/><path d="M42 32c2-5 12-5 14 1 2 7-7 8-7 14M49 56h.1" fill="none" stroke="${K}" stroke-width="5" stroke-linecap="round"/>`;
  if (type === 'wouldrather') return `<rect x="9" y="23" width="34" height="50" rx="8" fill="#ffd644" stroke="${K}" stroke-width="4"/><rect x="53" y="23" width="34" height="50" rx="8" fill="#ff8eab" stroke="${K}" stroke-width="4"/><path d="M20 48h12M64 48h12M47 38l4 10-4 10" fill="none" stroke="${K}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (type === 'preference') return `<circle cx="29" cy="47" r="17" fill="#ff8eab" stroke="${K}" stroke-width="4"/><circle cx="67" cy="31" r="17" fill="${f}" stroke="${K}" stroke-width="4"/><circle cx="67" cy="67" r="17" fill="#a8e6cf" stroke="${K}" stroke-width="4"/><path d="M43 42l9-6M43 53l9 8" fill="none" stroke="${K}" stroke-width="4" stroke-linecap="round"/>${face}`;
  if (type === 'estimate') return `<circle cx="48" cy="48" r="34" fill="${f}" stroke="${K}" stroke-width="4"/><circle cx="48" cy="48" r="20" fill="none" stroke="${K}" stroke-width="5"/><circle cx="48" cy="48" r="7" fill="#f04444" stroke="${K}" stroke-width="3"/><path d="M48 10v13M48 73v13M10 48h13M73 48h13" stroke="${K}" stroke-width="4" stroke-linecap="round"/><path d="M61 23l12 2-7 9" fill="none" stroke="${K}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (type === 'rps') return `<circle cx="48" cy="48" r="39" fill="${f}" stroke="${K}" stroke-width="4"/><path d="M24 60V43c0-3 4-4 6-1l2 6V27c0-4 6-4 6 0v16-20c0-4 6-4 6 0v20-16c0-4 6-4 6 0v18-12c0-4 6-4 6 0v18c0 10-6 16-16 16H35c-6 0-11-4-11-7z" fill="#ff8eab" stroke="${K}" stroke-width="4" stroke-linejoin="round"/>`;
  if (type === 'both') return `<path d="M18 34h35v28c0 7-5 12-12 12H30c-7 0-12-5-12-12z" fill="${f}" stroke="${K}" stroke-width="4"/><path d="M53 43h7c8 0 11 11 4 15h-9" fill="none" stroke="${K}" stroke-width="4"/><path d="M25 27h21M26 19h18" stroke="${K}" stroke-width="4" stroke-linecap="round"/><path d="M47 43h31v20c0 6-4 10-10 10H57" fill="#ff8eab" stroke="${K}" stroke-width="4"/><path d="M78 48h4c7 0 9 9 3 13h-7" fill="none" stroke="${K}" stroke-width="4"/>`;
  return `<circle cx="48" cy="48" r="40" fill="${f}" stroke="${K}" stroke-width="4"/>${face}`;
}
const ICONS = {};
function loadIcons() {
  return Promise.all(TYPES.map(t => new Promise((res, rej) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="384" height="384" viewBox="0 0 96 96">${iconArt(t)}</svg>`;
    const im = new Image();
    im.onload = () => { ICONS[t] = im; res(); };
    im.onerror = rej;
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  })));
}
function icon(g, type, cx, cy, size, rot = 0, alpha = 1) {
  const im = ICONS[type]; if (!im) return;
  g.save(); g.globalAlpha *= alpha; g.translate(cx, cy); g.rotate(rot);
  g.drawImage(im, -size / 2, -size / 2, size, size); g.restore();
}

/* ---------- word layout ---------- */
function words(g, arr, cx, y, o = {}, per = () => ({})) {
  const { size = 100, weight = 1000, ls = -0.06, fill = C.ink, gap = null, maxW = 0, fam = 'Geist' } = o;
  g.save(); font(g, size, weight, ls, fam);
  const lsp = parseFloat(g.letterSpacing) || 0;
  const spw = gap === null ? g.measureText(' ').width + lsp : gap;
  const ws = arr.map(s => tw(g, s));
  const total = ws.reduce((a, b) => a + b, 0) + spw * (arr.length - 1);
  let sc = 1; if (maxW && total > maxW) sc = maxW / total;
  let x = cx - (total * sc) / 2;
  arr.forEach((s, i) => {
    const p = per(i) || {}, ww = ws[i] * sc;
    g.save();
    g.globalAlpha *= (p.alpha === undefined ? 1 : p.alpha);
    if (p.clip !== undefined) {
      const bh = size * sc * 1.9, by = y + size * sc * 0.9, k = clamp(p.clip);
      g.beginPath(); g.rect(x - 16, by - bh * k, ww + 32, bh * k); g.clip();
    }
    g.translate(x + ww / 2 + (p.dx || 0), y + (p.dy || 0));
    g.rotate(p.rot || 0);
    const s2 = (p.scale === undefined ? 1 : p.scale) * sc; g.scale(s2, s2);
    if (p.skew) g.transform(1, 0, p.skew, 1, 0, 0);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    font(g, size, weight, ls, fam);
    if (p.sh) { g.fillStyle = p.shadow || C.ink; g.fillText(s, p.sh, p.sh); }
    g.fillStyle = p.fill || fill; g.fillText(s, 0, 0);
    g.restore();
    x += ww + spw * sc;
  });
  g.restore();
  return total * sc;
}

/* ---------- cards ---------- */
function cardFront(g, cx, cy, w, h, o = {}) {
  const { type = 'honto', rot = 0, scale = 1, scaleX = 1, alpha = 1 } = o;
  g.save(); g.globalAlpha *= alpha; g.translate(cx, cy); g.rotate(rot); g.scale(scale * scaleX, scale);
  g.fillStyle = 'rgba(23,36,61,0.9)'; rr(g, -w / 2 + 16, -h / 2 + 18, w, h, 34); g.fill();
  g.fillStyle = C[ICON_BG[type]]; rr(g, -w / 2, -h / 2, w, h, 34); g.fill();
  g.strokeStyle = C.ink; g.lineWidth = 9; g.stroke();
  g.strokeStyle = C.ink; g.lineWidth = 4; rr(g, -w / 2 + 24, -h / 2 + 24, w - 48, h - 48, 20); g.stroke();
  g.globalAlpha *= 0.28; text(g, '本当?!', 0, -h / 2 + 62, { size: 40, ls: 0, fill: C.ink, fam: JP }); g.globalAlpha /= 0.28;
  icon(g, type, 0, -h * 0.06, w * 0.5);
  text(g, LABELS[type], 0, h / 2 - 66, { size: 36, ls: 0.03, maxW: w - 80 });
  g.restore();
}
function cardBack(g, cx, cy, w, h, o = {}) {
  const { rot = 0, scale = 1, scaleX = 1, alpha = 1 } = o;
  g.save(); g.globalAlpha *= alpha; g.translate(cx, cy); g.rotate(rot); g.scale(scale * scaleX, scale);
  g.fillStyle = 'rgba(23,36,61,0.28)'; rr(g, -w / 2 + 16, -h / 2 + 18, w, h, 34); g.fill();
  g.fillStyle = C.ink; rr(g, -w / 2, -h / 2, w, h, 34); g.fill();
  g.strokeStyle = C.ink; g.lineWidth = 9; g.stroke();
  g.strokeStyle = C.yellow; g.lineWidth = 4; rr(g, -w / 2 + 24, -h / 2 + 24, w - 48, h - 48, 20); g.stroke();
  text(g, '本当?!', 0, -6, { size: 96, weight: 900, ls: 0, fill: C.paper, fam: JP, maxW: w - 90 });
  text(g, 'HONTO', 0, h / 2 - 62, { size: 30, ls: 0.3, fill: C.yellow, alpha: 0.75 });
  g.restore();
}

/* ================= SCENE 1 — IGNITION ================= */
function sIgnite(g, t) {
  const cut = 0.62;
  if (t < cut) {
    g.fillStyle = C.ink; g.fillRect(0, 0, W, H);
    rays(g, 540, 1000, t, { n: 18, color: C.ink2, len: 1500, spin: 0.5, alpha: 1, w: 0.019 });
    const p = oe(st(t, 0, 0.42));
    text(g, '本当?!', 540, 1000, { size: 300, weight: 900, ls: -0.01, fill: C.paper, fam: JP, maxW: 920, scale: lerp(1.16, 1, p), rot: lerp(-0.10, 0, p) });
    ringBurst(g, 540, 1000, t, { count: 3, color: C.red, from: 140, to: 980, dur: 0.52, lw: 14, stagger: 0.07 });
    const k = oc(st(t, 0.15, 0.36));
    if (k > 0) {
      g.save(); g.beginPath(); g.rect(540 - 540 * k, 1210, 1080 * k, 160); g.clip();
      text(g, 'IS IT TRUE?', 540, 1292, { size: 66, weight: 800, ls: 0.24, fill: C.yellow });
      g.restore();
    }
    return;
  }
  g.fillStyle = C.paper; g.fillRect(0, 0, W, H);
  const bp = oe(st(t, cut, cut + 0.30));
  g.save(); g.translate(540 + lerp(-1700, 0, bp), 1010); g.rotate(-7 * RAD);
  g.fillStyle = C.cream; g.fillRect(-1200, -230, 2400, 460);
  g.fillStyle = C.yellow; g.fillRect(-1200, -170, 2400, 340);
  g.restore();
  halftone(g, 0, 1250, W, 260, { gap: 30, r: 6, alpha: 0.12 });

  /* floating stickers */
  const fp = oe(st(t, cut + 0.10, cut + 0.5));
  cardFront(g, lerp(-260, 168, fp), 455 + Math.sin(t * 2.1) * 9, 210, 290, { type: 'estimate', rot: lerp(-0.9, -0.24, fp), scale: 1 });
  const fp2 = oe(st(t, cut + 0.22, cut + 0.62));
  circ(g, lerp(1320, 928, fp2), 1450 + Math.cos(t * 1.7) * 11, 88, { fill: C.mint, sw: 7, sh: 11, ring: C.red, ringGap: 9, rot: lerp(0.8, 0.12, fp2) }, gg => {
    text(gg, '?', 0, 4, { size: 96, fill: C.ink });
  });

  /* kanji stamp settling into the lockup */
  const mp = oe(st(t, cut, cut + 0.44));
  const ky = lerp(1000, 690, mp), ks = lerp(2.9, 1, mp);
  sticker(g, 540, ky, 430, 132, 66, { fill: C.paper, sw: 7, sh: 10, rot: lerp(0, -3 * RAD, mp), scale: ks, alpha: st(t, cut + 0.12, cut + 0.3) });
  text(g, '本当?!', 540, ky, { size: 96, weight: 900, ls: 0, fill: C.ink, fam: JP, scale: ks, rot: lerp(0, -3 * RAD, mp) });

  /* wordmark */
  const base = cut + 0.12, flo = t > 1.37 ? Math.sin((t - 1.37) * 2.6) * 4 : 0;
  letters(g, 'HONTO?!', 540, 1035 + flo, { size: 250, weight: 1000, ls: -0.075, maxW: 920 }, i => {
    if (i === 6) {
      const p = st(t, 1.21, 1.52);
      return { fill: C.red, dy: lerp(-30, 0, ob(p, 3)), rot: lerp(1.1, 0.14, oe(p)), scale: p <= 0 ? 0 : lerp(2.8, 1, ob(p, 2.1)), sh: 10, shadow: C.ink };
    }
    const s0 = base + i * 0.045, p = st(t, s0, s0 + 0.42);
    return { dy: lerp(-300, 0, ob(p, 2.4)), rot: lerp((i % 2 ? 1 : -1) * 0.26, 0, oc(p)), alpha: st(t, s0, s0 + 0.07), scale: lerp(1.2, 1, oc(p)), sh: 7, shadow: C.red };
  });
  ringBurst(g, 940, 1035, t - 1.21, { count: 2, color: C.ink, from: 60, to: 520, dur: 0.38, lw: 9, stagger: 0.07 });
  if (t > 1.21 && t < 1.50) {
    const p = st(t, 1.21, 1.48); g.save(); g.globalAlpha = 1 - p; g.strokeStyle = C.ink; g.lineWidth = 9; g.lineCap = 'round';
    for (let i = 0; i < 7; i++) { const a = -0.9 + i * 0.32, r0 = lerp(70, 210, oe(p)); g.beginPath(); g.moveTo(940 + Math.cos(a) * r0, 1035 + Math.sin(a) * r0); g.lineTo(940 + Math.cos(a) * (r0 + 56), 1035 + Math.sin(a) * (r0 + 56)); g.stroke(); }
    g.restore();
  }

  /* eyebrow */
  const ep = st(t, 1.36, 1.64);
  if (ep > 0) {
    sticker(g, 540, 1345, lerp(200, 830, oe(ep)), 104, 52, { fill: C.mint, sw: 7, sh: 10, rot: -1 * RAD });
    g.save(); g.beginPath(); g.rect(540 - 420 * oc(ep), 1280, 840 * oc(ep), 140); g.clip();
    text(g, 'ONLINE PARTY GAME · 2 PLAYERS', 540, 1346, { size: 46, weight: 900, ls: 0.13, maxW: 740 });
    g.restore();
  }
}

/* ================= SCENE 2 — THE HOOK ================= */
function sHook(g, t) {
  g.fillStyle = C.paper; g.fillRect(0, 0, W, H);
  g.save(); g.fillStyle = C.cream; g.beginPath(); g.moveTo(0, 1210); g.lineTo(W, 1060); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill(); g.restore();
  halftone(g, 0, 1230, W, 330, { gap: 32, r: 7, alpha: 0.11 });

  const bp = oe(st(t, 0, 0.30));
  g.save(); g.translate(540 + lerp(-1700, 0, bp), 700); g.rotate(-6 * RAD);
  g.fillStyle = C.yellow; g.fillRect(-1200, -128, 2400, 256); g.restore();
  const bp2 = oe(st(t, 0.06, 0.38));
  g.save(); g.translate(540 + lerp(1700, 0, bp2), 905); g.rotate(-6 * RAD);
  g.fillStyle = C.pink; g.fillRect(-1200, -20, 2400, 40); g.restore();

  /* decorative cards drifting */
  const dp = oe(st(t, 0.15, 0.7));
  cardBack(g, lerp(-240, 150, dp), 380 + Math.sin(t * 2) * 10, 200, 278, { rot: lerp(-1.0, -0.22, dp) });
  const dp2 = oe(st(t, 0.3, 0.85));
  cardFront(g, lerp(1330, 940, dp2), 1560 + Math.cos(t * 1.8) * 12, 190, 262, { type: 'question', rot: lerp(1.1, 0.2, dp2) });

  words(g, ['DRAW', 'A', 'CARD.'], 540, 690, { size: 138, ls: -0.07, maxW: 900 }, i => {
    const s0 = 0.10 + i * 0.085, p = st(t, s0, s0 + 0.42);
    return { clip: oc(st(t, s0, s0 + 0.24)), dy: lerp(150, 0, ob(p, 1.9)), scale: lerp(1.06, 1, oc(p)) };
  });
  words(g, ['READ', 'EACH', 'OTHER.'], 540, 880, { size: 122, ls: -0.06, maxW: 930, fill: C.red }, i => {
    const s0 = 0.70 + i * 0.075, p = st(t, s0, s0 + 0.42);
    return { clip: oc(st(t, s0, s0 + 0.24)), dy: lerp(140, 0, ob(p, 1.9)), skew: -0.13, sh: 6, shadow: 'rgba(23,36,61,0.22)' };
  });

  const sp = st(t, 1.25, 1.65), ss = sp <= 0 ? 0 : lerp(1.9, 1, ob(sp, 2.6));
  if (sp > 0) {
    sticker(g, 540, 1300, 900, 230, 40, { fill: C.mint, sw: 9, sh: 18, rot: -3 * RAD + wob(st(t, 1.25, 2.1), 3, 5) * 0.05, scale: ss }, (gg, w2, h2) => {
      text(gg, 'WHO TAKES', 0, -46, { size: 92, maxW: w2 - 90 });
      text(gg, 'THE SIP?', 0, 56, { size: 92, maxW: w2 - 90, fill: C.red });
    });
    ringBurst(g, 540, 1300, t - 1.25, { count: 2, color: C.ink, from: 260, to: 760, dur: 0.4, lw: 8 });
  }
}

/* ================= SCENE 3 — THE DECK ================= */
const BARS = [['01', 'I once slept in an airport'], ['02', 'I cannot ride a bike'], ['03', 'I met a celebrity at 3 a.m.']];
function sDeck(g, t) {
  g.fillStyle = C.cream; g.fillRect(0, 0, W, H);
  g.fillStyle = C.paper; g.fillRect(0, 0, W, 470);
  g.save(); g.strokeStyle = C.ink; g.globalAlpha = 0.14; g.lineWidth = 5; g.beginPath(); g.moveTo(0, 470); g.lineTo(W, 470); g.stroke(); g.restore();
  halftone(g, 0, 500, W, 220, { gap: 34, r: 7, alpha: 0.10 });

  words(g, ['ONE', 'SHARED', 'DECK.'], 540, 330, { size: 78, ls: -0.04, maxW: 880 }, i => {
    const s0 = 0.04 + i * 0.07;
    return { clip: oc(st(t, s0, s0 + 0.2)), dy: lerp(90, 0, ob(st(t, s0, s0 + 0.4), 1.8)) };
  });

  const enter = oe(st(t, 0.0, 0.34)), fan = oc(st(t, 0.16, 0.58));
  const cw = 430, ch = 590;
  const order = ['question', 'estimate', 'preference', 'honto', 'rps', 'both', 'wouldrather'];
  for (let i = 0; i < 7; i++) {
    if (i === 3) continue;
    const d = i - 3, p = st(t, 0.58 + Math.abs(d) * 0.018, 0.94);
    if (p >= 1) continue;
    const ang = d * 15 * RAD * fan, dir = Math.sign(d) || 1;
    let x = 540 + d * 92 * fan + dir * 1500 * iq(p);
    let y = 930 + Math.abs(d) * 30 * fan + lerp(1250, 0, enter) - 260 * iq(p);
    cardBack(g, x, y, cw, ch, { rot: ang + lerp(0.55, 0, enter) + p * 2.1 * dir, scale: lerp(0.94, 1, fan), alpha: 1 - iq(p) });
  }
  /* hero card: rise, flip, dock */
  const hp = oe(st(t, 0.58, 0.86));
  const dock = oe(st(t, 1.35, 1.70));
  const hy = lerp(lerp(930 + lerp(1250, 0, enter), 880, hp), 655, dock);
  const hs = lerp(lerp(0.94, 1.14, hp), 0.63, dock) * (1 + wob(st(t, 1.33, 1.77), 2, 7) * 0.05);
  const flip = st(t, 0.86, 1.08), fx = Math.cos(Math.PI * flip);
  const hrot = lerp(lerp(0.55, 0, enter), -0.04, dock);
  if (fx > 0) cardBack(g, 540, hy, cw, ch, { rot: hrot, scale: hs, scaleX: Math.max(0.02, fx) });
  else cardFront(g, 540, hy, cw, ch, { type: 'honto', rot: hrot, scale: hs, scaleX: Math.max(0.02, -fx) });
  if (flip > 0 && flip < 1) {
    g.save(); g.globalAlpha = 0.34 * Math.sin(Math.PI * flip);
    g.translate(540, hy); g.rotate(hrot);
    const lg = g.createLinearGradient(-cw * hs / 2, -ch * hs / 2, cw * hs / 2, ch * hs / 2);
    lg.addColorStop(0, 'rgba(255,253,248,0)'); lg.addColorStop(0.45, 'rgba(255,253,248,1)'); lg.addColorStop(1, 'rgba(255,253,248,0)');
    g.fillStyle = lg; rr(g, -cw * hs / 2, -ch * hs / 2, cw * hs, ch * hs, 34 * hs); g.fill(); g.restore();
  }
  ringBurst(g, 540, 880, t - 1.33, { count: 2, color: C.ink, from: 220, to: 560, dur: 0.4, lw: 12 });

  /* the bluff demo */
  for (let i = 0; i < 3; i++) {
    const s0 = 1.60 + i * 0.075, p = oe(st(t, s0, s0 + 0.42));
    if (p <= 0) continue;
    const y = 1055 + i * 200, killed = i !== 1;
    const stamp = st(t, i === 0 ? 2.75 : i === 2 ? 2.92 : 3.15, (i === 0 ? 2.75 : i === 2 ? 2.92 : 3.15) + 0.3);
    const tilt = (i % 2 ? 1.2 : -1.2) * RAD + wob(clamp(stamp * 1.4), 3, 6) * 0.035;
    const x = lerp(1560, 540, p);
    sticker(g, x, y, 950, 172, 30, { fill: killed && stamp > 0.4 ? '#f4ecda' : C.paper, sw: 7, sh: 13, rot: tilt, alpha: killed && stamp > 0.5 ? 0.82 : 1 }, (gg, w2, h2) => {
      circ(gg, -w2 / 2 + 80, 0, 48, { fill: killed && stamp > 0.4 ? C.paper : C.yellow, sw: 5, sh: 6 }, () => { });
      text(gg, BARS[i][0], -w2 / 2 + 80, 2, { size: 40, ls: 0.02 });
      text(gg, BARS[i][1], -w2 / 2 + 144, 2, { size: 50, weight: 800, ls: -0.015, align: 'left', maxW: w2 - 215 });
      if (killed && stamp > 0) {
        gg.save(); gg.strokeStyle = C.red; gg.lineWidth = 8; gg.lineCap = 'round';
        gg.beginPath(); gg.moveTo(-w2 / 2 + 138, 4); gg.lineTo(lerp(-w2 / 2 + 138, w2 / 2 - 160, oe(stamp)), 4); gg.stroke(); gg.restore();
      }
    });
    if (killed && stamp > 0) {
      const ss = lerp(2.6, 1, ob(clamp(stamp * 2.2), 2.4));
      g.save(); g.globalAlpha = clamp(stamp * 6); g.translate(x + 388, y - 6); g.rotate(-14 * RAD); g.scale(ss, ss);
      g.strokeStyle = C.red; g.lineWidth = 17; g.lineCap = 'round';
      g.beginPath(); g.moveTo(-34, -34); g.lineTo(34, 34); g.moveTo(34, -34); g.lineTo(-34, 34); g.stroke(); g.restore();
    }
    if (!killed && stamp > 0) {
      const ss = lerp(2.4, 1, ob(clamp(stamp * 2.2), 2.6));
      sticker(g, x + 336, y - 4, 280, 112, 56, { fill: C.mint, sw: 7, sh: 11, rot: -9 * RAD + wob(clamp(stamp * 1.6), 3, 6) * 0.08, scale: ss, alpha: clamp(stamp * 6) }, gg => {
        text(gg, 'TRUTH', 0, 2, { size: 52, ls: 0.04 });
      });
      ringBurst(g, x + 336, y - 4, t - 3.15, { count: 2, color: C.ink, from: 120, to: 420, dur: 0.34, lw: 7 });
      confetti(g, x + 336, y - 4, t - 3.15, 77, { n: 14, dur: 0.9, spread: 420 });
    }
  }
}

/* ================= SCENE 4 — SEVEN MINI GAMES ================= */
function sSeven(g, t) {
  g.fillStyle = C.paper; g.fillRect(0, 0, W, H);
  const gp = ob(clamp(st(t, 0, 0.8)), 1.2);
  text(g, '7', 540, 1060, { size: 1500, weight: 1000, ls: 0, fill: C.ink, alpha: 0.07, scale: lerp(0.7, 1, gp), rot: lerp(-0.2, -0.06, oc(st(t, 0, 0.9))) });
  g.save(); g.translate(540, 430); g.rotate(-5 * RAD); g.fillStyle = C.pink;
  const bw = lerp(0, 2400, oe(st(t, 0, 0.26))); g.fillRect(-bw / 2, -86, bw, 172); g.restore();

  words(g, ['SEVEN', 'MINI', 'GAMES'], 540, 420, { size: 104, ls: -0.06, maxW: 900 }, i => {
    const s0 = 0.08 + i * 0.07;
    return { clip: oc(st(t, s0, s0 + 0.22)), dy: lerp(120, 0, ob(st(t, s0, s0 + 0.4), 2)), rot: -5 * RAD };
  });
  text(g, 'BLUFF · ASK · READ · GUESS · BATTLE', 540, 560, { size: 40, weight: 900, ls: 0.11, maxW: 860, alpha: st(t, 0.34, 0.52) });

  const active = clamp(Math.floor(st(t, 0.62, 0.62 + 7 * 0.24) * 7), 0, 6);
  const tickLocal = (t - 0.62) - active * 0.24;
  for (let i = 0; i < 7; i++) {
    const row = i < 4 ? 0 : 1;
    const cxp = row === 0 ? 540 + (i - 1.5) * 256 : 540 + (i - 4 - 1) * 256;
    const cyp = row === 0 ? 840 : 1130;
    const s0 = 0.14 + i * 0.05, p = st(t, s0, s0 + 0.5);
    if (p <= 0) continue;
    const isOn = i === active && t > 0.62;
    const pop = isOn ? 1 + 0.16 * Math.exp(-9 * Math.max(0, tickLocal)) : 1;
    const sc = lerp(0, 1, ob(p, 2.5)) * pop;
    circ(g, cxp, cyp, 106, {
      fill: C[ICON_BG[TYPES[i]]], sw: 7, sh: 11, scale: sc,
      rot: lerp(-0.4, 0, oc(p)) + (isOn ? wob(clamp(Math.max(0, tickLocal) * 5), 2, 6) * 0.07 : 0),
      ring: C.red, ringGap: isOn ? 16 : 10, ringW: isOn ? 9 : 3.5, ringA: isOn ? 0.95 : 0.3,
    }, () => { });
    icon(g, TYPES[i], cxp, cyp, 128 * sc, lerp(-0.4, 0, oc(p)));
  }
  if (t > 0.62) {
    const lp = clamp(Math.max(0, tickLocal) * 7);
    sticker(g, 540, 1400, 860, 136, 30, { fill: C.yellow, sw: 8, sh: 14, rot: 1.5 * RAD, scale: lerp(1.06, 1, oc(lp)) }, (gg, w2) => {
      text(gg, LABELS[TYPES[active]], 0, 2, { size: 56, ls: 0.02, maxW: w2 - 80, scale: lerp(1.08, 1, ob(lp, 2)) });
    });
  }
  const ap = st(t, 2.10, 2.40);
  if (ap > 0) sticker(g, 540, 1560, 520, 104, 52, { fill: C.pink, sw: 7, sh: 11, rot: -4 * RAD, scale: lerp(1.6, 1, ob(ap, 2.4)), alpha: clamp(ap * 4) }, (gg, w2) => {
    text(gg, 'AI QUESTION HELPER', 0, 2, { size: 40, ls: 0.06, maxW: w2 - 60 });
  });
}

/* ================= SCENE 5 — THE WHEEL ================= */
const SEGS = [[C.paper, '1'], [C.pink, '2'], [C.mint, '3'], [C.cream, '1'], [C.blue, '2'], [C.white, '3']];
function sWheel(g, t) {
  g.fillStyle = C.yellow; g.fillRect(0, 0, W, H);
  rays(g, 540, 1080, t, { n: 18, color: '#ffc926', len: 1700, spin: 0.16, alpha: 1, w: 0.022 });
  words(g, ['SPIN.', 'SIP.', 'REPEAT.'], 540, 420, { size: 112, ls: -0.06, maxW: 930 }, i => {
    const s0 = 0.04 + i * 0.08, p = st(t, s0, s0 + 0.4);
    return { clip: oc(st(t, s0, s0 + 0.2)), dy: lerp(130, 0, ob(p, 2)), sh: 7, shadow: 'rgba(23,36,61,0.18)' };
  });

  const cx = 540, cy = 1085, r = 322;
  const segCenter = 4.5 * (Math.PI / 3), finalRot = -Math.PI / 2 - segCenter + 6 * TAU;
  const spin = st(t, 0.08, 1.45);
  const rot = lerp(0.35, finalRot, oq(spin)) + wob(st(t, 1.45, 2.4), 3, 7) * 0.035;
  const wp = ob(clamp(st(t, 0, 0.24)), 2.2);

  g.save(); g.translate(cx, cy); g.scale(wp, wp);
  g.fillStyle = C.ink; g.beginPath(); g.arc(14, 16, r + 10, 0, TAU); g.fill();
  g.save(); g.rotate(rot);
  for (let i = 0; i < 6; i++) {
    const a0 = i * Math.PI / 3, a1 = a0 + Math.PI / 3;
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r, a0, a1); g.closePath();
    g.fillStyle = SEGS[i][0]; g.fill(); g.strokeStyle = C.ink; g.lineWidth = 6; g.stroke();
    const am = a0 + Math.PI / 6;
    g.save(); g.translate(Math.cos(am) * r * 0.73, Math.sin(am) * r * 0.73); g.rotate(am + Math.PI / 2);
    text(g, SEGS[i][1], 0, 0, { size: 92, ls: -0.04 }); g.restore();
  }
  g.restore();
  g.strokeStyle = C.ink; g.lineWidth = 12; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke();
  g.fillStyle = C.yellow; g.beginPath(); g.arc(0, 0, 62, 0, TAU); g.fill(); g.lineWidth = 9; g.stroke();
  g.fillStyle = C.ink; g.beginPath(); g.arc(0, 0, 17, 0, TAU); g.fill();
  /* pointer */
  g.save(); g.translate(0, -r - 6); g.rotate(Math.sin(rot * 3) * 0.11 * (1 - oq(spin) * 0.9));
  g.fillStyle = C.red; g.beginPath(); g.moveTo(0, 42); g.lineTo(-44, -44); g.lineTo(44, -44); g.closePath(); g.fill();
  g.strokeStyle = C.ink; g.lineWidth = 8; g.lineJoin = 'round'; g.stroke(); g.restore();
  g.restore();

  const rp = st(t, 1.50, 1.86);
  if (rp > 0) {
    const ss = lerp(2.5, 1, ob(clamp(rp * 1.6), 2.5)) * (1 + wob(st(t, 1.50, 2.4), 3, 6) * 0.03);
    sticker(g, cx, cy, 560, 216, 34, { fill: C.ink, sw: 0, sh: 0, rot: -4 * RAD, scale: ss }, (gg, w2) => {
      gg.strokeStyle = C.paper; gg.lineWidth = 6; rr(gg, -w2 / 2 + 16, -108 + 16, w2 - 32, 216 - 32, 22); gg.stroke();
      text(gg, '2 SIPS', 0, 4, { size: 126, ls: -0.05, fill: C.paper, maxW: w2 - 90 });
    });
    ringBurst(g, cx, cy, t - 1.50, { count: 3, color: C.ink, from: 220, to: 900, dur: 0.5, lw: 12 });
    confetti(g, cx, cy, t - 1.50, 1337, { n: 26, dur: 1.2, spread: 820, colors: [C.paper, C.pink, C.mint, C.red, C.ink] });
  }
  text(g, 'ALCOHOL OPTIONAL · WATER COUNTS TOO', 540, 1530, { size: 36, weight: 900, ls: 0.1, alpha: st(t, 1.95, 2.20) * 0.8 });
}

/* ================= SCENE 6 — THE TABLE ================= */
const SEAT_A = [-90, 90, -150, -30, 30, 150], SEAT_N = ['A', 'M', 'K', 'R', 'S', 'Y'];
const SEAT_C = [C.yellow, C.mint, C.pink, C.paper, C.cream, C.white];
function sTable(g, t) {
  g.fillStyle = C.blue; g.fillRect(0, 0, W, H);
  g.save(); g.globalAlpha = 0.10; g.strokeStyle = C.ink; g.lineWidth = 3;
  for (let x = 0; x <= W; x += 90) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y <= H; y += 90) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.restore();

  words(g, ['FREE', 'FOR', 'TWO.'], 540, 420, { size: 126, ls: -0.07, maxW: 900 }, i => {
    const s0 = 0.04 + i * 0.075, p = st(t, s0, s0 + 0.4);
    return { clip: oc(st(t, s0, s0 + 0.2)), dy: lerp(140, 0, ob(p, 2)), sh: 8, shadow: C.white };
  });
  words(g, ['UP', 'TO', '6', 'WITH', 'PREMIUM.'], 540, 552, { size: 58, ls: -0.02, maxW: 880, fill: C.ink }, i => {
    const s0 = 0.5 + i * 0.045;
    return { clip: oc(st(t, s0, s0 + 0.18)), alpha: st(t, s0, s0 + 0.12) * 0.82, dy: lerp(50, 0, oc(st(t, s0, s0 + 0.3))) };
  });

  const tp = ob(clamp(st(t, 0.08, 0.5)), 2);
  g.save(); g.translate(540, 1075); g.scale(tp, tp);
  g.fillStyle = C.ink; g.beginPath(); g.ellipse(14, 18, 336, 232, 0, 0, TAU); g.fill();
  g.fillStyle = C.paper; g.beginPath(); g.ellipse(0, 0, 336, 232, 0, 0, TAU); g.fill();
  g.strokeStyle = C.ink; g.lineWidth = 9; g.stroke();
  g.globalAlpha = 0.5; g.lineWidth = 4; g.beginPath(); g.ellipse(0, 0, 296, 196, 0, 0, TAU); g.stroke(); g.globalAlpha = 1;
  cardBack(g, -178, 44, 132, 182, { rot: -0.34, scale: 1 });
  cardFront(g, 182, 52, 132, 182, { type: 'rps', rot: 0.3 });
  g.restore();

  const cp = st(t, 0.42, 0.74);
  if (cp > 0) sticker(g, 540, 1040, 440, 172, 30, { fill: C.ink, sw: 0, sh: 0, rot: -3 * RAD, scale: lerp(1.9, 1, ob(clamp(cp * 1.4), 2.4)) }, (gg, w2) => {
    text(gg, 'ROOM CODE', 0, -44, { size: 28, ls: 0.22, fill: C.yellow });
    text(gg, 'MOON-42', 0, 30, { size: 84, ls: -0.03, fill: C.paper, maxW: w2 - 60 });
  });

  for (let i = 0; i < 6; i++) {
    const premium = i > 1;
    const s0 = premium ? 0.95 + (i - 2) * 0.07 : 0.2 + i * 0.09;
    const p = st(t, s0, s0 + 0.44); if (p <= 0) continue;
    const a = SEAT_A[i] * RAD, x = 540 + Math.cos(a) * 348, y = 1075 + Math.sin(a) * 288;
    const sc = lerp(0, 1, ob(p, 2.6)), bob = Math.sin(t * 3 + i) * 5;
    circ(g, x, y + bob, 76, { fill: SEAT_C[i], sw: 7, sh: 10, scale: sc, rot: lerp(-0.5, 0, oc(p)), ring: premium ? C.yellow : C.red, ringGap: 12 }, gg => {
      text(gg, SEAT_N[i], 0, 4, { size: 62, ls: -0.02 });
    });
    if (premium) {
      const bp = clamp(p * 1.6), bs = lerp(2, 1, ob(bp, 2.4)) * sc;
      circ(g, x + 58 * sc, y + bob - 58 * sc, 28, { fill: C.yellow, sw: 5, sh: 6, scale: bs }, gg => {
        text(gg, '★', 0, 3, { size: 32, fill: C.ink, fam: JP });
      });
    }
  }
  const np = st(t, 1.70, 2.00);
  if (np > 0) sticker(g, 540, 1505, 900, 116, 26, { fill: C.yellow, sw: 8, sh: 14, rot: 1.6 * RAD, scale: lerp(1.5, 1, ob(clamp(np * 1.5), 2.6)) }, (gg, w2) => {
    text(gg, 'NO APP · NO ACCOUNT · JUST A LINK', 0, 2, { size: 46, ls: 0.05, maxW: w2 - 60 });
  });
}

/* ================= SCENE 7 — CTA ================= */
const SPARK = (() => { const r = rng(9001), a = []; for (let i = 0; i < 26; i++) a.push({ x: r() * W, y: r() * H, s: 8 + r() * 16, v: 26 + r() * 70, p: r() * TAU, c: r() > 0.5 ? C.yellow : C.paper, o: 0.25 + r() * 0.45 }); return a; })();
function arrow(g, x, y, s, color) {
  g.save(); g.translate(x, y); g.strokeStyle = color; g.lineWidth = s * 0.17; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(-s * 0.5, 0); g.lineTo(s * 0.42, 0); g.stroke();
  g.beginPath(); g.moveTo(s * 0.12, -s * 0.34); g.lineTo(s * 0.48, 0); g.lineTo(s * 0.12, s * 0.34); g.stroke();
  g.restore();
}
function sCTA(g, t) {
  g.fillStyle = C.ink; g.fillRect(0, 0, W, H);
  rays(g, 540, 1130, t, { n: 22, color: C.ink2, len: 1800, spin: 0.10, alpha: 1, w: 0.015 });
  const gr = g.createRadialGradient(540, 1060, 0, 540, 1060, 980);
  gr.addColorStop(0, 'rgba(255,214,68,0.16)'); gr.addColorStop(1, 'rgba(255,214,68,0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (const s of SPARK) {
    const y = ((s.y - s.v * t) % (H + 80) + H + 80) % (H + 80) - 40;
    g.save(); g.globalAlpha = s.o * (0.5 + 0.5 * Math.sin(t * 2.4 + s.p)); g.translate(s.x + Math.sin(t * 0.9 + s.p) * 14, y);
    g.rotate(s.p + t * 0.6); g.fillStyle = s.c; g.fillRect(-s.s / 2, -s.s / 2, s.s, s.s); g.restore();
  }

  const kp = st(t, 0.04, 0.34);
  if (kp > 0) text(g, '本当?!', 540, 520, { size: 104, weight: 900, ls: 0, fill: C.yellow, fam: JP, scale: lerp(2.2, 1, ob(clamp(kp * 1.5), 2.4)), rot: lerp(0.3, -0.04, oc(kp)), alpha: clamp(kp * 5) });

  letters(g, 'HONTO?!', 540, 720 + Math.sin(t * 2.2) * 4, { size: 226, weight: 1000, ls: -0.075, maxW: 900, fill: C.paper }, i => {
    if (i === 6) {
      const p = st(t, 0.5, 0.82);
      return { fill: C.red, dy: lerp(-24, 0, ob(p, 3)), rot: lerp(1.0, 0.14, oe(p)), scale: p <= 0 ? 0 : lerp(2.6, 1, ob(p, 2.1)), sh: 9, shadow: C.paper };
    }
    const s0 = 0.14 + i * 0.038, p = st(t, s0, s0 + 0.4);
    return { dy: lerp(-260, 0, ob(p, 2.3)), rot: lerp((i % 2 ? 1 : -1) * 0.22, 0, oc(p)), alpha: st(t, s0, s0 + 0.06), scale: lerp(1.18, 1, oc(p)) };
  });
  ringBurst(g, 930, 720, t - 0.5, { count: 2, color: C.yellow, from: 60, to: 520, dur: 0.4, lw: 8 });

  words(g, ['TRY', 'IT', 'FREE'], 540, 900, { size: 100, ls: -0.05, maxW: 760, fill: C.mint }, i => {
    const s0 = 0.66 + i * 0.07, p = st(t, s0, s0 + 0.36);
    return { clip: oc(st(t, s0, s0 + 0.2)), dy: lerp(90, 0, ob(p, 2)), scale: lerp(1.05, 1, oc(p)) };
  });

  /* the button */
  const bp = st(t, 0.92, 1.34);
  if (bp > 0) {
    const puls = (t > 1.34 ? 1 + 0.014 * Math.sin((t - 1.34) * 4.6) : 1) * (1 + 0.055 * wob(clamp((t - 3.0) / 0.7), 2.2, 6));
    const sc = lerp(1.7, 1, ob(clamp(bp * 1.35), 2.3)) * puls;
    const bw2 = 920, bh2 = 218, by = 1140;
    g.save(); g.translate(540, by); g.rotate(lerp(-0.07, 0, oe(bp))); g.scale(sc, sc);
    g.fillStyle = C.red; rr(g, -bw2 / 2 + 18, -bh2 / 2 + 20, bw2, bh2, 109); g.fill();
    g.fillStyle = C.yellow; rr(g, -bw2 / 2, -bh2 / 2, bw2, bh2, 109); g.fill();
    g.strokeStyle = C.ink; g.lineWidth = 9; g.stroke();
    g.save(); rr(g, -bw2 / 2, -bh2 / 2, bw2, bh2, 109); g.clip();
    const sw2 = ((t - 1.2) % 1.5) / 1.5;
    if (t > 1.3 && sw2 >= 0) {
      const sx = lerp(-bw2 / 2 - 400, bw2 / 2 + 400, sw2);
      const lg = g.createLinearGradient(sx - 200, 0, sx + 200, 0);
      lg.addColorStop(0, 'rgba(255,253,248,0)'); lg.addColorStop(0.5, 'rgba(255,253,248,0.65)'); lg.addColorStop(1, 'rgba(255,253,248,0)');
      g.fillStyle = lg; g.save(); g.transform(1, 0, -0.35, 1, 0, 0); g.fillRect(-bw2, -bh2, bw2 * 2, bh2 * 2); g.restore();
    }
    g.restore();
    text(g, 'hontogame.com', -34, 6, { size: 104, ls: -0.045, maxW: 700 });
    arrow(g, 370, 6, 96, C.ink);
    g.restore();
    ringBurst(g, 540, by, t - 1.02, { count: 3, color: C.yellow, from: 260, to: 940, dur: 0.5, lw: 11 });
    ringBurst(g, 540, by, t - 3.0, { count: 2, color: C.yellow, from: 300, to: 760, dur: 0.44, lw: 8, alpha: 0.7 });
    confetti(g, 540, by, t - 1.02, 4242, { n: 24, dur: 1.3, spread: 860, colors: [C.yellow, C.pink, C.mint, C.paper] });
  }

  text(g, 'NO ACCOUNT · PLAYS IN YOUR BROWSER', 540, 1352, { size: 42, weight: 900, ls: 0.12, fill: C.paper, maxW: 900, alpha: st(t, 1.42, 1.7) * 0.8 });

  for (let i = 0; i < 7; i++) {
    const s0 = 1.58 + i * 0.045, p = st(t, s0, s0 + 0.44); if (p <= 0) continue;
    const x = 540 + (i - 3) * 132, sc = lerp(0, 1, ob(p, 2.4));
    circ(g, x, 1502, 58, { fill: C[ICON_BG[TYPES[i]]], sw: 5, sh: 8, shadow: 'rgba(0,0,0,0.45)', scale: sc, rot: lerp(-0.5, 0, oc(p)) }, () => { });
    icon(g, TYPES[i], x, 1502, 70 * sc);
  }
}

/* ================= TIMELINE ================= */
const SCENES = [
  { id: 'ignite', start: 0.00, end: 2.00, draw: sIgnite },
  { id: 'hook', start: 2.00, end: 4.25, draw: sHook, tr: { type: 'wipe', d: 0.30, flash: C.white } },
  { id: 'deck', start: 4.25, end: 8.25, draw: sDeck, tr: { type: 'card', d: 0.40 } },
  { id: 'seven', start: 8.25, end: 11.00, draw: sSeven, tr: { type: 'push', d: 0.32 } },
  { id: 'wheel', start: 11.00, end: 13.50, draw: sWheel, tr: { type: 'blinds', d: 0.34, flash: C.white } },
  { id: 'table', start: 13.50, end: 16.00, draw: sTable, tr: { type: 'wipe2', d: 0.30 } },
  { id: 'cta', start: 16.00, end: 20.00, draw: sCTA, tr: { type: 'iris', d: 0.44, flash: C.yellow } },
];
const IMPACTS = [[0.00, 18], [1.21, 26], [2.00, 12], [3.25, 14], [4.25, 12], [5.31, 16], [7.40, 10], [8.25, 12], [11.00, 12], [12.50, 30], [13.50, 12], [15.20, 14], [16.00, 16], [16.50, 14], [17.02, 26], [19.00, 14]];
function shake(t) {
  let dx = 0, dy = 0;
  for (const [ti, a] of IMPACTS) { const d = t - ti; if (d >= 0 && d < 0.4) { const k = Math.exp(-13 * d) * a; dx += Math.sin(d * 148) * k; dy += Math.cos(d * 121) * k * 0.75; } }
  return [dx, dy];
}

/* ================= COMPOSITOR ================= */
const stage = document.getElementById('stage');
const ctx = stage.getContext('2d', { alpha: false });
function mk() { const c = document.createElement('canvas'); c.width = W; c.height = H; return { c, g: c.getContext('2d', { alpha: false }) }; }
const CA = mk(), CB = mk(), CM = mk(), CO = mk();
function resetG(g) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.letterSpacing = '0px'; g.imageSmoothingEnabled = true; g.lineCap = 'butt'; g.lineJoin = 'miter'; }
function idxAt(t) { let i = 0; for (let k = 0; k < SCENES.length; k++) if (t >= SCENES[k].start) i = k; return i; }
function drawScene(target, i, time) { resetG(target.g); SCENES[i].draw(target.g, time - SCENES[i].start); }
function band(m, x, a, b, rev) {
  const s = rev ? -1 : 1;
  m.beginPath();
  m.moveTo(x + s * 180 + s * a, -2); m.lineTo(x + s * 180 + s * b, -2);
  m.lineTo(x - s * 180 + s * b, H + 2); m.lineTo(x - s * 180 + s * a, H + 2); m.closePath();
}
function compose(time) {
  const i = idxAt(time), sc = SCENES[i], dt = time - sc.start, tr = sc.tr;
  const m = CM.g; resetG(m);
  drawScene(CA, i, time);
  if (i > 0 && tr && dt < tr.d) {
    drawScene(CB, i - 1, time);
    const p = clamp(dt / tr.d), e = io(p);
    if (tr.type === 'wipe' || tr.type === 'wipe2') {
      const rev = tr.type === 'wipe2', x = rev ? lerp(W + 380, -380, e) : lerp(-380, W + 380, e);
      m.drawImage(CB.c, 0, 0);
      m.save(); band(m, x, -3000, 0, rev); m.clip(); m.drawImage(CA.c, 0, 0); m.restore();
      [[C.red, 0, 74], [C.yellow, 86, 146], [C.ink, 158, 182]].forEach(([col, a, b]) => { m.fillStyle = col; band(m, x, a, b, rev); m.fill(); });
    } else if (tr.type === 'card') {
      const q = iq(p);
      m.drawImage(CA.c, 0, 0);
      m.save(); m.translate(540 + 1700 * q, 960 - 1250 * q); m.rotate(0.8 * q); m.scale(1 - 0.3 * q, 1 - 0.3 * q);
      m.drawImage(CB.c, -540, -960); m.restore();
    } else if (tr.type === 'push') {
      m.save(); m.translate(0, -H * 0.3 * e); m.drawImage(CB.c, 0, 0); m.restore();
      m.save(); m.translate(0, H * (1 - e)); m.drawImage(CA.c, 0, 0); m.restore();
      m.fillStyle = C.ink; m.fillRect(0, H * (1 - e) - 14, W, 14);
      m.fillStyle = C.red; m.fillRect(0, H * (1 - e) - 26, W, 12);
    } else if (tr.type === 'blinds') {
      m.drawImage(CB.c, 0, 0);
      const n = 8, bh = H / n, sg = 0.05;
      for (let k = 0; k < n; k++) {
        const kp = clamp((p - k * sg) / (1 - (n - 1) * sg)), e2 = oe(kp); if (e2 <= 0) continue;
        m.save(); m.beginPath();
        if (k % 2) m.rect(0, (k + 1) * bh - bh * e2, W, bh * e2 + 1); else m.rect(0, k * bh, W, bh * e2 + 1);
        m.clip(); m.drawImage(CA.c, 0, 0); m.restore();
      }
    } else if (tr.type === 'iris') {
      const r0 = lerp(0, 1320, e);
      m.drawImage(CB.c, 0, 0);
      m.save(); m.beginPath(); m.arc(540, 1060, r0, 0, TAU); m.clip(); m.drawImage(CA.c, 0, 0); m.restore();
      m.save(); m.strokeStyle = C.yellow; m.lineWidth = lerp(46, 0, p); m.beginPath(); m.arc(540, 1060, r0, 0, TAU); m.stroke(); m.restore();
    } else { m.drawImage(CA.c, 0, 0); }
    if (tr.flash && dt < 0.055) { m.save(); m.globalAlpha = (1 - dt / 0.055) * 0.8; m.fillStyle = tr.flash; m.fillRect(0, 0, W, H); m.restore(); }
  } else m.drawImage(CA.c, 0, 0);
}
const GRAIN = [];
function buildGrain() {
  const r = rng(7);
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('canvas'); c.width = 270; c.height = 480;
    const g = c.getContext('2d'), d = g.createImageData(270, 480);
    for (let k = 0; k < d.data.length; k += 4) { const v = (r() * 255) | 0; d.data[k] = d.data[k + 1] = d.data[k + 2] = v; d.data[k + 3] = 255; }
    g.putImageData(d, 0, 0); GRAIN.push(c);
  }
}
function inTrans(time) { const i = idxAt(time), sc = SCENES[i]; return i > 0 && sc.tr && (time - sc.start) < sc.tr.d + 0.03; }
function renderFrame(n) {
  const time = n / FPS, o = CO.g; resetG(o);
  const subs = inTrans(time) ? 7 : SUB, spread = subs > 3 ? 0.92 : 0.44;
  for (let s = 0; s < subs; s++) {
    compose(time + (s - (subs - 1) / 2) * (spread / FPS));
    o.globalAlpha = 1 / (s + 1); o.drawImage(CM.c, 0, 0);
  }
  resetG(ctx);
  const [dx, dy] = shake(time);
  ctx.save(); ctx.translate(540 + dx, 960 + dy); ctx.scale(1.048, 1.048); ctx.translate(-540, -960); ctx.drawImage(CO.c, 0, 0); ctx.restore();
  ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.04; ctx.imageSmoothingEnabled = false;
  ctx.drawImage(GRAIN[n % GRAIN.length], 0, 0, W, H); ctx.restore();
  ctx.save(); const vg = ctx.createRadialGradient(540, 960, 430, 540, 960, 1260);
  vg.addColorStop(0, 'rgba(23,36,61,0)'); vg.addColorStop(1, 'rgba(23,36,61,0.17)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H); ctx.restore();
}
window.META = { W, H, FPS, DUR, TOTAL };
window.renderFrame = renderFrame;
window.__ready = (async () => {
  await document.fonts.load('1000 120px Geist'); await document.fonts.load('900 120px Geist'); await document.fonts.load('800 120px Geist');
  await document.fonts.ready; await loadIcons(); buildGrain(); renderFrame(0); return true;
})();
if (location.hash === '#play') {
  window.__ready.then(() => { const t0 = performance.now(); (function loop() { const n = Math.floor(((performance.now() - t0) / 1000 * FPS)) % TOTAL; renderFrame(n); requestAnimationFrame(loop); })(); });
}

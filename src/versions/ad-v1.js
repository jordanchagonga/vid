/* Amrison Ventures — "Build What's Next" (19 s, 1920x1080, 30 fps)
 *
 * Every frame is a pure function of time: window.renderFrame(t) draws the
 * frame at t seconds. No CSS animation, timers or Math.random(), so renders
 * are reproducible frame for frame.
 *
 * All cue times below come from the soundtrack analysis (ad time = source
 * time - 3.40 s) and are snapped to the nearest frame.
 */
'use strict';
(() => {
  const W = 1920, H = 1080, FPS = 30;
  const snap = s => Math.round(s * FPS) / FPS;

  const T = Object.fromEntries(Object.entries({
    impact: 0.13, b1: 1.14, b2: 1.33, b3: 1.60, b4: 1.82,   // hook hit + bass hits
    breakdown: 2.10, riser: 3.60, drop: 4.03,                // breakdown, riser, main drop
    a1: 4.38, a2: 5.22,                                      // panel 1 accents
    p2: 5.99, h7: 7.18,                                      // panel 2 + network pulse
    p3: 8.01, r2: 8.27, r3: 8.64, n1: 9.17,                  // panel 3 rank moves
    p4: 9.84, k1: 10.59, k2: 11.06,                          // panel 4 packets; k2 also starts the collapse
    pre: 11.64, lift: 11.77,                                 // lift (second drop)
    settle: 12.75, tag: 13.72, next: 14.21, svc: 15.42,
    c1: 16.62, c2: 17.12, c3: 17.60, c4: 18.09, fin: 18.56, end: 19.0,
  }).map(([k, v]) => [k, snap(v)]));

  const C = {
    night: '#020B1C', mid: '#06173A', navy: '#031E48',
    gold: '#CF9648', goldHi: '#E6B566', goldLo: '#A8742F', white: '#FCFCFC',
  };
  const SANS = 'Montserrat', MONO = '"JetBrains Mono"';
  const font = (w, s, f = SANS) => `${w} ${s}px ${f}`;
  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };

  // ---------- math ----------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const E = {
    outExpo: x => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    inExpo: x => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
    outCubic: x => 1 - Math.pow(1 - x, 3),
    inCubic: x => x * x * x,
    inOutCubic: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    outBack: x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  };
  /** Exponential decay envelope that starts at a cue. */
  const hit = (t, at, decay = 0.12) => (t < at ? 0 : Math.exp(-(t - at) / decay));
  /** Hard flash: full on the cue frame, 40% the next frame, then gone. */
  const flash = (t, at, peak) => {
    const n = Math.round((t - at) * FPS);
    return n === 0 ? peak : n === 1 ? peak * 0.4 : 0;
  };
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- canvas ----------
  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  function measure(str, f, spacing = 0) {
    ctx.save(); ctx.font = f; ctx.letterSpacing = `${spacing}px`;
    const w = ctx.measureText(str).width - spacing;
    ctx.restore();
    return w;
  }
  function text(str, x, y, { f, color, align = 'left', spacing = 0, alpha = 1 }) {
    ctx.save();
    ctx.font = f; ctx.letterSpacing = `${spacing}px`; ctx.fillStyle = color;
    ctx.globalAlpha *= alpha; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    const w = ctx.measureText(str).width - spacing;
    const sx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    ctx.fillText(str, sx, y);
    ctx.restore();
    return w;
  }
  /** Text rising into a mask line; p is 0..1 (already eased or not). */
  function riseText(str, x, y, size, p, opts, ease = E.outExpo) {
    if (p <= 0) return;
    const e = ease(clamp(p));
    ctx.save();
    ctx.beginPath(); ctx.rect(0, y - size * 1.05, W, size * 1.4); ctx.clip();
    text(str, x, y + (1 - e) * size * 1.15, opts);
    ctx.restore();
  }
  function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function withGlow(blur, color, fn) {
    ctx.save(); ctx.shadowBlur = blur; ctx.shadowColor = color; fn(); ctx.restore();
  }
  function scaleAbout(cx, cy, s) { ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy); }

  // ---------- the gold ribbon (swoosh-shaped line) ----------
  const quad = (p0, p1, p2, u) => {
    const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
    return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]];
  };
  // Thick near the start, tapering to a point at the tip, like the logo swoosh
  const profile = u => Math.pow(Math.sin(Math.PI * (0.1 + 0.9 * u)), 0.85);
  function arcPts(p0, p1, p2, wMax, n = 160, dx = 0, dy = 0) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const [x, y] = quad(p0, p1, p2, i / n);
      pts.push({ x: x + dx, y: y + dy, w: wMax * profile(i / n) });
    }
    return pts;
  }
  function ribbon(pts, u0, u1, o = {}) {
    const n = pts.length - 1;
    const i0 = Math.max(0, Math.floor(u0 * n)), i1 = Math.min(n, Math.ceil(u1 * n));
    if (i1 - i0 < 1) return;
    const L = [], R = [];
    for (let i = i0; i <= i1; i++) {
      const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, n)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
      const w = pts[i].w * (o.ws ?? 1) / 2;
      L.push([pts[i].x + nx * w, pts[i].y + ny * w]);
      R.push([pts[i].x - nx * w, pts[i].y - ny * w]);
    }
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    if (o.glow) { ctx.shadowColor = 'rgba(230,181,102,0.85)'; ctx.shadowBlur = o.glow; }
    const f = pts[0], l = pts[n];
    const g = ctx.createLinearGradient(f.x, f.y, l.x, l.y);
    g.addColorStop(0, C.goldLo); g.addColorStop(0.55, C.gold); g.addColorStop(1, C.goldHi);
    ctx.fillStyle = o.fill || g;
    ctx.beginPath();
    L.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let k = R.length - 1; k >= 0; k--) ctx.lineTo(R[k][0], R[k][1]);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    if (o.head && u1 < 1) {
      const h = pts[i1];
      withGlow(40, 'rgba(255,240,210,1)', () => {
        ctx.fillStyle = '#FFF6E4'; ctx.beginPath(); ctx.arc(h.x, h.y, 6, 0, Math.PI * 2); ctx.fill();
      });
    }
  }
  function polyLen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }
  function strokePartial(pts, p) {
    if (p <= 0) return;
    const L = polyLen(pts);
    ctx.save(); ctx.setLineDash([L * p, L + 10]);
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.restore();
  }
  function pointAt(pts, u) {
    const f = clamp(u) * (pts.length - 1), i = Math.min(Math.floor(f), pts.length - 2), k = f - i;
    return [lerp(pts[i][0], pts[i + 1][0], k), lerp(pts[i][1], pts[i + 1][1], k)];
  }
  function cubicPts(p0, p1, p2, p3, n = 48) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, v = 1 - u;
      out.push([
        v * v * v * p0[0] + 3 * v * v * u * p1[0] + 3 * v * u * u * p2[0] + u * u * u * p3[0],
        v * v * v * p0[1] + 3 * v * v * u * p1[1] + 3 * v * u * u * p2[1] + u * u * u * p3[1],
      ]);
    }
    return out;
  }

  // ---------- assets & precomputed data ----------
  const A = {};
  const GEO = window.LOGO_GEO;
  const LOGO_S = 1.05;                       // display scale vs. the 614 px cut-out
  const LW = GEO.width * LOGO_S, LH = GEO.height * LOGO_S;
  const LX = 960 - LW / 2, LY = 470 - LH / 2;
  const CAM_PAYOFF = [960, 560];

  function loadImage(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }

  async function init() {
    await Promise.all([
      `500 20px ${SANS}`, `600 20px ${SANS}`, `800 20px ${SANS}`, `900 20px ${SANS}`,
      `400 20px ${MONO}`, `600 20px ${MONO}`,
    ].map(f => document.fonts.load(f)));
    A.logo = await loadImage('../assets/brand/amrison-logo.png');
    A.gold = await loadImage('../assets/brand/amrison-logo-gold.png');
    A.logoBuf = mk(GEO.width, GEO.height);
    A.maskBuf = mk(GEO.width, GEO.height);

    // Film grain tile
    const r = rng(7);
    A.noise = mk(256, 256);
    const nctx = A.noise.getContext('2d'), img = nctx.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = r() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    nctx.putImageData(img, 0, 0);

    // Hook word, pre-rendered in white and gold
    const wf = font(900, 270);
    A.wordW = measure('AMRISON', wf, 10);
    for (const [key, color] of [['word', C.white], ['wordGold', C.gold]]) {
      const c = mk(W, 420), g = c.getContext('2d');
      g.font = wf; g.letterSpacing = '10px'; g.fillStyle = color; g.textBaseline = 'alphabetic';
      g.fillText('AMRISON', 960 - A.wordW / 2, 320);
      A[key] = c;
    }
    // Glitch strip offsets: [bass hit][strip] -> displacement factor (0 = strip stays)
    const gr = rng(21);
    A.glitch = [0, 1, 2, 3].map(() => Array.from({ length: 14 }, () => (gr() > 0.58 ? (gr() - 0.5) * 2 : 0)));

    // Riser streaks
    const sr = rng(33);
    A.streaks = Array.from({ length: 130 }, () => ({ a: sr() * Math.PI * 2, ph: sr(), w: 1 + sr() * 2.5, gold: sr() > 0.55 }));

    // Capabilities: one title size for all panels, fitted to the widest line
    let widest = 0;
    for (const p of PANELS) for (const l of p.lines) widest = Math.max(widest, measure(l, font(900, 100), 2));
    A.titleSize = Math.min(104, Math.floor(100 * 720 / widest));

    // Panel 1 chart & bars
    const cr = rng(48);
    A.chart = Array.from({ length: 13 }, (_, i) => 0.15 + 0.7 * (i / 12) + (cr() - 0.5) * 0.22);
    A.bars = Array.from({ length: 3 }, () => Array.from({ length: 7 }, () => 0.25 + cr() * 0.75));

    // Panel 2 network
    const layers = [4, 6, 6, 4, 2];
    A.nodes = []; A.edges = [];
    layers.forEach((n, L) => {
      for (let i = 0; i < n; i++) A.nodes.push({ L, x: 1010 + L * 175, y: 535 + (i - (n - 1) / 2) * 92 });
    });
    const er = rng(64);
    for (const a of A.nodes) for (const b of A.nodes) if (b.L === a.L + 1) A.edges.push({ a, b, ph: er(), sig: er() > 0.62 });

    // Panel 3 search results (id 0 = Amrison)
    const br = rng(80);
    A.rows = Array.from({ length: 5 }, () => ({ t1: 200 + br() * 160, t2: 260 + br() * 170 }));
    A.rankCurve = Array.from({ length: 24 }, (_, i) => {
      const u = i / 23;
      return [1600 + u * 200, 780 - Math.pow(u, 1.6) * 250 + (br() - 0.5) * 18 * (1 - u)];
    });

    // Panel 4 workflow
    A.flowIn = [320, 535, 750].map(y => cubicPts([1058, y], [1190, y], [1210, 535], [1274, 535]));
    A.flowOut = [380, 535, 690].map(y => cubicPts([1446, 535], [1510, 535], [1520, y], [1595, y]));

    // Lift burst particles
    const pr = rng(99);
    A.particles = Array.from({ length: 90 }, () => ({ a: pr() * Math.PI * 2, v: 700 + pr() * 1500, l: 10 + pr() * 40, gold: pr() > 0.3 }));

    // Logo swoosh centreline in screen space (for the landing trace)
    const sw = GEO.swoosh;
    A.swooshPts = sw.map(([x, y, th], i) => {
      const a = sw[Math.max(i - 1, 0)], b = sw[Math.min(i + 1, sw.length - 1)];
      const cos = Math.abs(Math.cos(Math.atan2(b[1] - a[1], b[0] - a[0])));
      return { x: LX + x * LOGO_S, y: LY + y * LOGO_S, w: Math.max(1.5, th * LOGO_S * cos * 0.95) };
    });
    A.swooshX = [sw[0][0], sw[sw.length - 1][0]];

    // End-card text layout
    A.tagF = font(800, 48); A.tagSp = 12;
    A.tag1W = measure("BUILD WHAT'S", A.tagF, A.tagSp);
    A.tag2W = measure('NEXT.', A.tagF, A.tagSp);
    A.svcF = font(600, 19, MONO); A.svcSp = 4;
    const pieces = ['WEB APPLICATIONS', ' · ', 'AI SYSTEMS', ' · ', 'SEO', ' · ', 'AI SOLUTIONS'];
    const total = measure(pieces.join(''), A.svcF, A.svcSp) + A.svcSp;
    let x = 960 - total / 2, chars = 0;
    A.svc = pieces.map(s => {
      const piece = { s, x, c0: chars, w: measure(s, A.svcF, A.svcSp), service: s.trim() !== '·' };
      x += measure(s, A.svcF, A.svcSp) + A.svcSp; chars += s.length;
      return piece;
    });
    A.svcChars = chars;
  }

  // ======================================================================
  // HOOK  0.00 – 4.03
  // ======================================================================
  const HOOK_ARC = arcPts([-120, 930], [720, 330], [2040, 170], 26, 160);
  const HOOK_TAN = (() => { const dx = 2160, dy = -760, l = Math.hypot(dx, dy); return [dx / l, dy / l]; })();
  const BASS = () => [T.b1, T.b2, T.b3, T.b4];

  function drawWord(t) {
    const out = prog(t, T.breakdown, T.breakdown + 0.35);
    if (t < T.impact || out >= 1) return;
    const bass = BASS();
    let split = 4 + 64 * hit(t, T.impact, 0.22);
    let punch = 0, chroma = 22 * hit(t, T.impact, 0.3);
    bass.forEach((b, i) => {
      split += (12 + 9 * i) * hit(t, b, 0.16);
      punch += 0.018 * (1 + i * 0.4) * hit(t, b, 0.12);
      chroma += (9 + 4 * i) * hit(t, b, 0.1);
    });
    const sc = 1 + 0.42 * (1 - E.outExpo(prog(t, T.impact, T.impact + 0.42))) + punch + 0.012 * (t - T.impact);
    const oy = 335 + 90 * E.inCubic(out);

    ctx.save();
    ctx.globalAlpha = 1 - E.inCubic(out);
    if (out > 0) ctx.filter = `blur(${(out * 14).toFixed(2)}px)`;
    scaleAbout(960, 560, sc);
    // Two halves, split along the hook arc and pushed apart along its tangent
    for (const side of [1, -1]) {
      ctx.save();
      ctx.beginPath();
      HOOK_ARC.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (side === 1) { ctx.lineTo(2400, -600); ctx.lineTo(-600, -600); } else { ctx.lineTo(2400, 1800); ctx.lineTo(-600, 1800); }
      ctx.closePath(); ctx.clip();
      const dx = side * split * HOOK_TAN[0], dy = side * split * HOOK_TAN[1];
      for (let k = 0; k < 14; k++) {
        let gx = 0;
        bass.forEach((b, i) => { gx += A.glitch[i][k] * (34 + 18 * i) * hit(t, b, 0.07); });
        const sy = k * 30;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - E.inCubic(out)) * 0.85;
        ctx.drawImage(A.wordGold, 0, sy, W, 30, dx + gx + chroma, oy + sy + dy, W, 30);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1 - E.inCubic(out);
        ctx.drawImage(A.word, 0, sy, W, 30, dx + gx, oy + sy + dy, W, 30);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function drawHookArc(t) {
    if (t < T.impact) return;
    const head = E.outExpo(prog(t, T.impact, T.impact + 0.32));
    const tail = E.inCubic(prog(t, T.breakdown, T.breakdown + 0.4));
    if (tail >= 1) return;
    const bass = BASS().reduce((s, b) => s + hit(t, b, 0.1), 0);
    ribbon(HOOK_ARC, tail, head, { glow: 26 + 30 * bass + 50 * hit(t, T.impact, 0.2), head: true });
  }

  function drawPrompt(t) {
    const start = T.breakdown + 0.22;
    if (t < T.breakdown + 0.1) return;
    const str = "> what's next?", f = font(600, 66, MONO), y = 565;
    const step = 0.065;
    const n = t < start ? 0 : clamp(Math.floor((t - start) / step) + 1, 0, str.length);
    const fullW = measure(str, f), x0 = 960 - fullW / 2;
    const riser = prog(t, T.riser, T.drop);
    const fadeIn = prog(t, T.breakdown + 0.1, T.breakdown + 0.3);
    const textA = fadeIn * (1 - E.outCubic(prog(t, T.riser, T.riser + 0.18)));

    if (n > 0 && textA > 0) {
      text('>', x0, y, { f, color: C.gold, alpha: textA });
      if (n > 1) text(str.slice(1, n), x0 + measure('>', f), y, { f, color: C.white, alpha: textA });
    }
    // cursor: blinks, then stretches into a horizontal gold line on the riser
    const curX = x0 + measure(str.slice(0, Math.max(n, 0)), f) + (n ? 8 : 0);
    const typing = t < start + str.length * step + 0.15;
    const blinkOn = typing || Math.floor((t - start) * 3.4) % 2 === 0 || riser > 0;
    if (!blinkOn) return;
    const e = E.inExpo(riser);
    const cw = lerp(38, 2600, e), ch = lerp(62, 3, E.outCubic(riser));
    const cx = lerp(curX + 19, 960, E.outCubic(riser)), cy = lerp(y - 24, 540, E.outCubic(riser));
    withGlow(20 + 60 * riser, 'rgba(230,181,102,0.9)', () => {
      ctx.globalAlpha = fadeIn;
      ctx.fillStyle = riser > 0.6 ? C.goldHi : C.gold;
      ctx.fillRect(cx - cw / 2, cy - ch / 2, cw, ch);
    });
    if (riser > 0) drawStreaks(riser);
  }

  function drawStreaks(p) {
    ctx.save();
    for (const s of A.streaks) {
      const d = (s.ph + p * p * 2.2) % 1;
      const r0 = 60 + d * d * 1500, len = 30 + p * 520 * d;
      const ca = Math.cos(s.a), sa = Math.sin(s.a);
      ctx.strokeStyle = s.gold ? C.goldHi : C.white;
      ctx.globalAlpha = p * 0.75 * d;
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.moveTo(960 + ca * r0, 540 + sa * r0 * 0.6);
      ctx.lineTo(960 + ca * (r0 + len), 540 + sa * (r0 + len) * 0.6);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ======================================================================
  // CAPABILITIES  4.03 – 11.77
  // ======================================================================
  const PANELS = [
    { at: () => T.drop, end: () => T.p2, idx: '01', lines: ['WEB', 'APPLICATIONS'], sub: 'Engineered to scale.', draw: drawWeb },
    { at: () => T.p2, end: () => T.p3, idx: '02', lines: ['AI', 'SYSTEMS'], sub: 'Intelligence in production.', draw: drawAI },
    { at: () => T.p3, end: () => T.p4, idx: '03', lines: ['SEO'], sub: 'Found first.', draw: drawSEO },
    { at: () => T.p4, end: () => T.lift, idx: '04', lines: ['AI-DRIVEN', 'SOLUTIONS'], sub: 'Systems that think for your business.', draw: drawFlow },
  ];
  const VIS = { x0: 900, x1: 1840 };

  function drawCapabilities(t) {
    const collapse = prog(t, T.k2, T.pre);
    ctx.save();
    if (collapse > 0) {
      scaleAbout(960, 540, 1 - 0.985 * E.inCubic(collapse));
      ctx.globalAlpha = 1 - E.inCubic(collapse);
    }
    drawHUD(t);
    const i = PANELS.findIndex(p => t >= p.at() && t < p.end());
    if (i >= 0) {
      const p = PANELS[i], lt = t - p.at();
      drawPanelText(p, lt);
      // Visual area revealed by a sweeping gold scan line
      const wp = E.outCubic(prog(lt, 0, 0.3));
      const xr = lerp(VIS.x0, VIS.x1 + 40, wp);
      ctx.save();
      ctx.beginPath(); ctx.rect(VIS.x0 - 40, 0, xr - VIS.x0 + 40, H); ctx.clip();
      const push = 1 + 0.03 * E.outCubic(prog(t, p.at(), p.end()));
      scaleAbout(1360, 535, push);
      p.draw(t, lt);
      ctx.restore();
      if (wp < 1) {
        withGlow(24, 'rgba(230,181,102,0.9)', () => {
          ctx.globalAlpha *= 1 - wp * wp;
          ctx.fillStyle = C.goldHi; ctx.fillRect(xr - 1.5, 150, 3, 780);
        });
      }
    }
    ctx.restore();
  }

  function drawHUD(t) {
    const a = prog(t, T.drop, T.drop + 0.25);
    if (a <= 0) return;
    const f = font(500, 17, MONO);
    text('AMRISON VENTURES', 120, 96, { f, color: C.white, spacing: 5, alpha: 0.55 * a });
    text('CAPABILITIES', 1800, 96, { f, color: C.white, spacing: 5, alpha: 0.55 * a, align: 'right' });
    ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = C.gold;
    ctx.beginPath(); ctx.arc(1800 - measure('CAPABILITIES', f, 5) - 22, 90, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Four-segment progress bar
    const segW = (1680 - 48) / 4;
    PANELS.forEach((p, i) => {
      const x = 120 + i * (segW + 16), y = 984;
      ctx.save(); ctx.globalAlpha *= a;
      ctx.fillStyle = rgba(C.white, 0.14); ctx.fillRect(x, y, segW, 2);
      const fp = prog(t, p.at(), p.end());
      if (fp > 0) { ctx.fillStyle = t >= p.end() ? rgba(C.white, 0.55) : C.gold; ctx.fillRect(x, y - 1, segW * fp, 4); }
      ctx.restore();
    });
  }

  function drawPanelText(p, lt) {
    const size = A.titleSize, lines = p.lines.length;
    const blockH = 40 + lines * size + 64;
    const top = 540 - blockH / 2;
    const idxY = top + 18;
    riseText(`${p.idx} / 04`, 186, idxY, 24, prog(lt, 0, 0.3), { f: font(600, 22, MONO), color: C.gold, spacing: 6 });
    ctx.save(); ctx.fillStyle = C.gold;
    ctx.fillRect(120, idxY - 8, 48 * E.outExpo(prog(lt, 0, 0.35)), 2);
    ctx.restore();
    p.lines.forEach((l, i) => {
      const y = top + 40 + (i + 1) * size * 0.98;
      riseText(l, 116, y, size, prog(lt, 0.04 + 0.06 * i, 0.45 + 0.06 * i), { f: font(900, size), color: C.white, spacing: 2 });
    });
    riseText(p.sub, 120, top + 40 + lines * size + 56, 34, prog(lt, 0.22, 0.6), { f: font(500, 32), color: C.white, alpha: 0.72 });
  }

  // ---- 01 Web applications ----
  function drawWeb(t, lt) {
    const bx = 930, by = 200, bw = 860, bh = 580;
    const tp = E.inOutCubic(prog(lt, 0, 0.42));
    const frameA = prog(lt, 0.3, 0.55);
    // panel body
    ctx.save(); ctx.globalAlpha *= prog(lt, 0.15, 0.45);
    rr(bx, by, bw, bh, 16); ctx.fillStyle = rgba(C.mid, 0.75); ctx.fill();
    ctx.restore();
    // gold trace of the frame, settling into a quiet white outline
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(C.white, 0.28 * frameA); rr(bx, by, bw, bh, 16); ctx.stroke();
    const perim = [[bx + 16, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh], [bx, by], [bx + 16, by]];
    ctx.strokeStyle = C.goldHi; ctx.lineWidth = 3; ctx.shadowBlur = 22; ctx.shadowColor = 'rgba(230,181,102,0.9)';
    ctx.globalAlpha *= 1 - prog(lt, 0.45, 0.8);
    strokePartial(perim, tp);
    ctx.restore();
    if (lt < 0.2) return;
    // top bar
    const ui = prog(lt, 0.2, 0.4);
    ctx.save(); ctx.globalAlpha *= ui;
    ctx.fillStyle = rgba(C.white, 0.08); ctx.fillRect(bx, by + 52, bw, 1);
    [C.gold, rgba(C.white, 0.35), rgba(C.white, 0.35)].forEach((c, i) => {
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(bx + 28 + i * 22, by + 26, 6, 0, Math.PI * 2); ctx.fill();
    });
    rr(bx + 120, by + 13, 400, 26, 13); ctx.fillStyle = rgba(C.white, 0.06); ctx.fill();
    ctx.fillStyle = C.gold; ctx.fillRect(bx + 136, by + 22, 8, 8);
    ctx.fillStyle = rgba(C.white, 0.3); ctx.fillRect(bx + 154, by + 24, 150, 4);
    ctx.restore();
    // sidebar
    for (let i = 0; i < 6; i++) {
      const e = E.outCubic(prog(lt, 0.25 + i * 0.03, 0.5 + i * 0.03));
      if (e <= 0) continue;
      const y = by + 92 + i * 44;
      ctx.save(); ctx.globalAlpha *= e; ctx.translate(-20 * (1 - e), 0);
      ctx.fillStyle = i === 1 ? C.gold : rgba(C.white, 0.28);
      ctx.fillRect(bx + 26, y, 14, 14);
      ctx.fillRect(bx + 52, y + 4, [92, 70, 104, 64, 84, 58][i], 6);
      ctx.restore();
    }
    ctx.save(); ctx.globalAlpha *= ui; ctx.fillStyle = rgba(C.white, 0.06); ctx.fillRect(bx + 180, by + 53, 1, bh - 53); ctx.restore();
    // header
    const x0 = bx + 210, y0 = by + 82, cw = bw - 240;
    const hdr = E.outCubic(prog(lt, 0.3, 0.5));
    ctx.save(); ctx.globalAlpha *= hdr;
    ctx.fillStyle = rgba(C.white, 0.85); ctx.fillRect(x0, y0, 220, 16);
    ctx.fillStyle = rgba(C.white, 0.3); ctx.fillRect(x0, y0 + 30, 140, 8);
    rr(x0 + cw - 132, y0 - 4, 132, 36, 18); ctx.fillStyle = C.gold; ctx.fill();
    text('DEPLOY', x0 + cw - 66, y0 + 19, { f: font(600, 14, MONO), color: C.night, spacing: 2, align: 'center' });
    ctx.restore();
    // row 1 cards snap in on the 4.38 accent
    const cardW = (cw - 40) / 3;
    for (let i = 0; i < 3; i++) {
      const e = E.outBack(prog(t, T.a1 + i * 0.04, T.a1 + i * 0.04 + 0.3));
      if (e <= 0) continue;
      const x = x0 + i * (cardW + 20), y = y0 + 70;
      ctx.save(); ctx.globalAlpha *= clamp(e * 1.6);
      scaleAbout(x + cardW / 2, y + 65, 1 + 0.2 * (1 - e));
      rr(x, y, cardW, 130, 10); ctx.fillStyle = rgba(C.white, 0.05); ctx.fill();
      ctx.strokeStyle = rgba(C.white, 0.12); ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = rgba(C.white, 0.3); ctx.fillRect(x + 18, y + 18, 70, 6);
      A.bars[i].forEach((v, k) => {
        const h = 70 * v * E.outCubic(prog(t, T.a1 + 0.1 + k * 0.02, T.a1 + 0.4 + k * 0.02));
        ctx.fillStyle = k === 6 ? C.gold : rgba(C.white, 0.35);
        ctx.fillRect(x + 18 + k * ((cardW - 36) / 7), y + 112 - h, (cardW - 36) / 7 - 6, h);
      });
      ctx.restore();
    }
    // row 2 on the 5.22 accent: chart + ring
    const y2 = y0 + 220, chW = cw * 0.64 - 10;
    const e2 = E.outBack(prog(t, T.a2, T.a2 + 0.3));
    if (e2 > 0) {
      ctx.save(); ctx.globalAlpha *= clamp(e2 * 1.6);
      scaleAbout(x0 + cw / 2, y2 + 105, 1 + 0.12 * (1 - e2));
      rr(x0, y2, chW, 210, 10); ctx.fillStyle = rgba(C.white, 0.05); ctx.fill();
      ctx.strokeStyle = rgba(C.white, 0.12); ctx.stroke();
      ctx.fillStyle = rgba(C.white, 0.08);
      for (let g = 0; g < 4; g++) ctx.fillRect(x0 + 20, y2 + 40 + g * 40, chW - 40, 1);
      const pts = A.chart.map((v, k) => [x0 + 24 + k * ((chW - 48) / 12), y2 + 180 - v * 140]);
      const cp = prog(t, T.a2 + 0.05, T.a2 + 0.6);
      if (cp > 0) {
        const head = pointAt(pts, cp), n = Math.floor(cp * (pts.length - 1));
        const shown = pts.slice(0, n + 1).concat([head]);
        const g = ctx.createLinearGradient(0, y2 + 40, 0, y2 + 190);
        g.addColorStop(0, rgba(C.gold, 0.32)); g.addColorStop(1, rgba(C.gold, 0));
        ctx.beginPath(); shown.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.lineTo(head[0], y2 + 190); ctx.lineTo(pts[0][0], y2 + 190); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = C.gold; ctx.lineWidth = 3; ctx.lineJoin = 'round';
        ctx.beginPath(); shown.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
        withGlow(16, 'rgba(230,181,102,1)', () => { ctx.fillStyle = C.goldHi; ctx.beginPath(); ctx.arc(head[0], head[1], 5, 0, Math.PI * 2); ctx.fill(); });
      }
      const rx = x0 + chW + 20, rw = cw - chW - 20;
      rr(rx, y2, rw, 210, 10); ctx.fillStyle = rgba(C.white, 0.05); ctx.fill(); ctx.strokeStyle = rgba(C.white, 0.12); ctx.stroke();
      const ccx = rx + rw / 2, ccy = y2 + 105;
      ctx.lineWidth = 12; ctx.strokeStyle = rgba(C.white, 0.1);
      ctx.beginPath(); ctx.arc(ccx, ccy, 58, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = C.gold; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(ccx, ccy, 58, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * 0.78 * E.outCubic(prog(t, T.a2 + 0.1, T.a2 + 0.7))); ctx.stroke();
      ctx.restore();
    }
    // floating code panel
    const ce = E.outCubic(prog(t, T.a1 + 0.12, T.a1 + 0.45));
    if (ce > 0) {
      const px = 1410, py = 600 + 40 * (1 - ce), pw = 420, ph = 250;
      ctx.save(); ctx.globalAlpha *= ce;
      withGlow(40, 'rgba(0,0,0,0.6)', () => { rr(px, py, pw, ph, 12); ctx.fillStyle = rgba(C.night, 0.94); ctx.fill(); });
      rr(px, py, pw, ph, 12); ctx.strokeStyle = rgba(C.gold, 0.55); ctx.lineWidth = 1.5; ctx.stroke();
      text('build.ts', px + 20, py + 30, { f: font(400, 14, MONO), color: C.white, alpha: 0.5 });
      ctx.fillStyle = rgba(C.white, 0.08); ctx.fillRect(px, py + 44, pw, 1);
      ctx.beginPath(); ctx.rect(px, py + 46, pw, ph - 50); ctx.clip();
      const scroll = (t - T.a1) * 28;
      const K = C.goldHi, S = rgba(C.white, 0.6), P = C.white, M = rgba(C.white, 0.35);
      const code = [
        [['import', K], [' { build } ', P], ['from', K], [" './platform'", S]],
        [],
        [['const', K], [' app = ', P], ['await', K], [' build({', P]],
        [['  stack: ', P], ["['web', 'api', 'edge']", S], [',', P]],
        [['  ai: ', P], ['true', K], [',', P]],
        [['  seo: ', P], ["'optimised'", S], [',', P]],
        [['})', P]],
        [],
        [['await', K], [' app.deploy()', P], [' // live', M]],
        [],
        [['export default', K], [' app', P]],
      ];
      const f = font(400, 17, MONO);
      code.forEach((line, li) => {
        let x = px + 22; const y = py + 80 + li * 27 - scroll;
        for (const [s, c] of line) x += text(s, x, y, { f, color: c });
      });
      ctx.restore();
    }
  }

  // ---- 02 AI systems ----
  function drawAI(t, lt) {
    const ign = L => T.p2 + 0.04 + L * 0.11;
    const wave = t >= T.h7 && t < T.h7 + 0.7 ? lerp(930, 1800, E.inOutCubic(prog(t, T.h7, T.h7 + 0.55))) : -1e4;
    const waveEnv = 1 - prog(t, T.h7 + 0.45, T.h7 + 0.7);
    const pulse = x => Math.exp(-Math.pow((x - wave) / 75, 2)) * waveEnv;
    ctx.save();
    for (const e of A.edges) {
      const p = E.outCubic(prog(t, ign(e.a.L) + 0.06, ign(e.a.L) + 0.3));
      if (p <= 0) continue;
      const x2 = lerp(e.a.x, e.b.x, p), y2 = lerp(e.a.y, e.b.y, p);
      ctx.strokeStyle = rgba(C.white, 0.12); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(x2, y2); ctx.stroke();
      const g = pulse((e.a.x + e.b.x) / 2);
      if (g > 0.02) {
        ctx.strokeStyle = rgba(C.goldHi, 0.85 * g); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(x2, y2); ctx.stroke();
      }
      if (e.sig && p >= 1) {
        const u = ((t - T.p2) * 0.9 + e.ph) % 1;
        ctx.fillStyle = rgba(C.gold, 0.85);
        ctx.beginPath(); ctx.arc(lerp(e.a.x, e.b.x, u), lerp(e.a.y, e.b.y, u), 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const n of A.nodes) {
      const e = E.outBack(prog(t, ign(n.L), ign(n.L) + 0.25));
      if (e <= 0) continue;
      const g = pulse(n.x);
      ctx.save();
      ctx.globalAlpha *= clamp(e);
      ctx.strokeStyle = rgba(C.gold, 0.35 + 0.65 * g); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(n.x, n.y, 16 * e + 8 * g, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 14 + 40 * g; ctx.shadowColor = g > 0.1 ? 'rgba(230,181,102,1)' : 'rgba(252,252,252,0.8)';
      ctx.fillStyle = g > 0.3 ? C.goldHi : C.white;
      ctx.beginPath(); ctx.arc(n.x, n.y, 7 * e + 3 * g, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    const la = prog(lt, 0.4, 0.7);
    text('INPUT', 1010, 860, { f: font(600, 13, MONO), color: C.white, spacing: 4, alpha: 0.4 * la, align: 'center' });
    text('OUTPUT', 1710, 860, { f: font(600, 13, MONO), color: C.white, spacing: 4, alpha: 0.4 * la, align: 'center' });
  }

  // ---- 03 SEO ----
  const RANKS = () => [[T.p3, 5], [T.r2, 3], [T.r3, 2], [T.n1, 1]];
  function rankState(t) {
    const rk = RANKS();
    let k = 0;
    for (let i = 0; i < rk.length; i++) if (t >= rk[i][0]) k = i;
    return { at: rk[k][0], prev: rk[Math.max(k - 1, 0)][1], cur: rk[k][1], k };
  }
  const slotOf = (id, R) => (id === 0 ? R - 1 : (id - 1 < R - 1 ? id - 1 : id));

  function drawSEO(t, lt) {
    const sx = 940, sy = 214, sw = 580;
    // search bar
    rr(sx, sy, sw, 72, 36); ctx.fillStyle = rgba(C.mid, 0.9); ctx.fill();
    ctx.strokeStyle = rgba(C.white, 0.3); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.save(); ctx.strokeStyle = C.gold; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(sx + 40, sy + 33, 12, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx + 49, sy + 42); ctx.lineTo(sx + 58, sy + 51); ctx.stroke(); ctx.restore();
    const q = 'amrison', n = Math.floor(prog(t, T.p3 + 0.04, T.p3 + 0.36) * q.length + 0.0001);
    const qf = font(400, 30, MONO);
    const qw = text(q.slice(0, n), sx + 80, sy + 46, { f: qf, color: C.white });
    if (Math.floor(lt * 3.4) % 2 === 0 || n < q.length) { ctx.fillStyle = C.gold; ctx.fillRect(sx + 84 + qw, sy + 22, 3, 32); }

    // results
    const st = rankState(t);
    const move = E.outBack(prog(t, st.at, st.at + 0.28));
    const slotY = s => 316 + s * 96;
    for (let id = 4; id >= 0; id--) {
      const from = slotOf(id, st.prev), to = slotOf(id, st.cur);
      const y = lerp(slotY(from), slotY(to), st.k === 0 ? 1 : move);
      const appear = E.outCubic(prog(lt, 0.1 + to * 0.04, 0.35 + to * 0.04));
      if (appear <= 0) continue;
      ctx.save(); ctx.globalAlpha *= appear; ctx.translate(0, 24 * (1 - appear));
      if (id === 0) {
        const moving = st.k > 0 ? hit(t, st.at, 0.25) : 0;
        ctx.shadowBlur = 10 + 30 * moving; ctx.shadowColor = 'rgba(230,181,102,0.7)';
        rr(sx, y, sw, 80, 10); ctx.fillStyle = rgba(C.gold, 0.13); ctx.fill();
        ctx.shadowBlur = 0; ctx.strokeStyle = C.gold; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = C.gold; ctx.fillRect(sx + 20, y + 22, 16, 16);
        text('Amrison Ventures', sx + 52, y + 37, { f: font(600, 24), color: C.white });
        text('Web applications · AI · SEO', sx + 52, y + 63, { f: font(400, 15, MONO), color: C.white, alpha: 0.6 });
        if (moving > 0.05) {
          ctx.fillStyle = rgba(C.goldHi, moving);
          ctx.beginPath(); ctx.moveTo(sx - 30, y + 48); ctx.lineTo(sx - 18, y + 30); ctx.lineTo(sx - 6, y + 48); ctx.closePath(); ctx.fill();
        }
      } else {
        rr(sx, y, sw, 80, 10); ctx.fillStyle = rgba(C.white, 0.035); ctx.fill();
        ctx.strokeStyle = rgba(C.white, 0.08); ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = rgba(C.white, 0.18); ctx.fillRect(sx + 20, y + 22, 16, 16);
        ctx.fillStyle = rgba(C.white, 0.32); ctx.fillRect(sx + 52, y + 26, A.rows[id].t1, 10);
        ctx.fillStyle = rgba(C.white, 0.14); ctx.fillRect(sx + 52, y + 52, A.rows[id].t2, 7);
      }
      ctx.restore();
    }

    // rank counter
    const cx = 1700, ca = prog(lt, 0.15, 0.4);
    text('RANK', cx, 262, { f: font(600, 16, MONO), color: C.white, spacing: 5, alpha: 0.5 * ca, align: 'center' });
    ctx.save(); ctx.globalAlpha *= ca;
    ctx.beginPath(); ctx.rect(1560, 280, 280, 160); ctx.clip();
    const roll = st.k === 0 ? 1 : E.outCubic(prog(t, st.at, st.at + 0.16));
    const nf = font(900, 140);
    if (roll < 1) text(`#${st.prev}`, cx, 420 - 150 * roll, { f: nf, color: C.gold, align: 'center', alpha: 1 - roll });
    text(`#${st.cur}`, cx, 420 + 150 * (1 - roll), { f: nf, color: st.cur === 1 ? C.goldHi : C.gold, align: 'center' });
    ctx.restore();
    if (t >= T.n1) {
      const bp = prog(t, T.n1, T.n1 + 0.5);
      ctx.save(); ctx.strokeStyle = rgba(C.goldHi, 1 - bp); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, 365, 70 + 150 * E.outCubic(bp), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    // visibility curve
    text('VISIBILITY', 1600, 500, { f: font(600, 13, MONO), color: C.white, spacing: 4, alpha: 0.4 * ca });
    ctx.save(); ctx.globalAlpha *= ca;
    ctx.fillStyle = rgba(C.white, 0.15); ctx.fillRect(1600, 800, 200, 1); ctx.fillRect(1600, 520, 1, 280);
    const cp = prog(t, T.p3 + 0.1, T.n1 + 0.1);
    if (cp > 0) {
      ctx.strokeStyle = C.gold; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      const pts = A.rankCurve, head = pointAt(pts, cp), k = Math.floor(cp * (pts.length - 1));
      ctx.beginPath(); pts.slice(0, k + 1).concat([head]).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
      withGlow(16, 'rgba(230,181,102,1)', () => { ctx.fillStyle = C.goldHi; ctx.beginPath(); ctx.arc(head[0], head[1], 5, 0, Math.PI * 2); ctx.fill(); });
    }
    ctx.restore();
  }

  // ---- 04 AI-driven solutions ----
  function drawFlow(t, lt) {
    const ys = [320, 535, 750];
    const linkP = prog(t, T.p4 + 0.12, T.p4 + 0.45);
    ctx.save();
    ctx.strokeStyle = rgba(C.white, 0.25); ctx.lineWidth = 2;
    A.flowIn.forEach(p => strokePartial(p, linkP));
    A.flowOut.forEach(p => strokePartial(p, prog(t, T.p4 + 0.3, T.p4 + 0.6)));
    ctx.restore();
    // ambient packets once links exist
    if (linkP >= 1) {
      [...A.flowIn, ...A.flowOut].forEach((p, i) => {
        const u = ((t - T.p4) * 0.8 + i * 0.17) % 1, [x, y] = pointAt(p, u);
        ctx.fillStyle = rgba(C.gold, 0.5); ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      });
    }
    // packet bursts on the 10.59 and 11.06 hits
    let coreKick = 0;
    for (const k of [T.k1, T.k2]) {
      coreKick += hit(t, k + 0.28, 0.15);
      const pin = prog(t, k, k + 0.28), pout = prog(t, k + 0.28, k + 0.56);
      const paths = pin < 1 ? A.flowIn.map(p => [p, E.inOutCubic(pin)]) : pout < 1 ? A.flowOut.map(p => [p, E.inOutCubic(pout)]) : [];
      if (t < k) continue;
      for (const [p, u] of paths) {
        for (let s = 0; s < 4; s++) {
          const [x, y] = pointAt(p, u - s * 0.035);
          ctx.save(); ctx.globalAlpha = 1 - s * 0.24;
          ctx.shadowBlur = 18; ctx.shadowColor = 'rgba(230,181,102,1)';
          ctx.fillStyle = s ? C.gold : '#FFF3DA'; ctx.beginPath(); ctx.arc(x, y, 6 - s, 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }
    }
    // input tiles with service glyphs
    ys.forEach((y, i) => {
      const e = E.outBack(prog(t, T.p4 + i * 0.05, T.p4 + 0.3 + i * 0.05));
      if (e <= 0) return;
      ctx.save(); ctx.globalAlpha *= clamp(e); scaleAbout(1010, y, e);
      rr(962, y - 48, 96, 96, 14); ctx.fillStyle = rgba(C.mid, 0.95); ctx.fill();
      ctx.strokeStyle = rgba(C.white, 0.28); ctx.lineWidth = 1.5; ctx.stroke();
      ctx.strokeStyle = C.white; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (i === 0) {
        rr(986, y - 22, 48, 40, 4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(986, y - 10); ctx.lineTo(1034, y - 10); ctx.stroke();
      } else if (i === 1) {
        const P = [[992, y + 14], [1010, y - 18], [1028, y + 14]];
        ctx.beginPath(); ctx.moveTo(...P[0]); ctx.lineTo(...P[1]); ctx.lineTo(...P[2]); ctx.closePath(); ctx.stroke();
        ctx.fillStyle = C.gold; P.forEach(([x, yy]) => { ctx.beginPath(); ctx.arc(x, yy, 5, 0, Math.PI * 2); ctx.fill(); });
      } else {
        ctx.beginPath(); ctx.moveTo(988, y + 16); ctx.lineTo(1002, y); ctx.lineTo(1014, y + 8); ctx.lineTo(1032, y - 16); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(1022, y - 16); ctx.lineTo(1032, y - 16); ctx.lineTo(1032, y - 6); ctx.stroke();
      }
      ctx.restore();
    });
    // AI core
    const ce = E.outBack(prog(t, T.p4 + 0.15, T.p4 + 0.45));
    if (ce > 0) {
      ctx.save(); ctx.globalAlpha *= clamp(ce);
      scaleAbout(1360, 535, ce * (1 + 0.12 * coreKick));
      ctx.fillStyle = rgba(C.gold, 0.08 + 0.2 * coreKick); ctx.beginPath(); ctx.arc(1360, 535, 86, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 20 + 40 * coreKick; ctx.shadowColor = 'rgba(230,181,102,1)';
      ctx.strokeStyle = C.gold; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(1360, 535, 86, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.save(); ctx.translate(1360, 535); ctx.rotate(t * 0.9);
      ctx.setLineDash([6, 12]); ctx.strokeStyle = rgba(C.white, 0.3); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 106, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      text('AI', 1360, 551, { f: font(800, 46), color: C.white, align: 'center', spacing: 2 });
      ctx.restore();
    }
    // outputs
    ['AUTOMATE', 'PREDICT', 'SCALE'].forEach((label, i) => {
      const y = [380, 535, 690][i];
      const e = E.outCubic(prog(t, T.p4 + 0.4 + i * 0.05, T.p4 + 0.65 + i * 0.05));
      if (e <= 0) return;
      const lit = hit(t, T.k1 + 0.56, 0.2) + hit(t, T.k2 + 0.56, 0.2);
      ctx.save(); ctx.globalAlpha *= e; ctx.translate(20 * (1 - e), 0);
      rr(1600, y - 29, 196, 58, 29);
      ctx.fillStyle = rgba(C.gold, 0.06 + 0.25 * clamp(lit)); ctx.fill();
      ctx.strokeStyle = rgba(C.gold, 0.7); ctx.lineWidth = 1.5; ctx.stroke();
      text(label, 1698, y + 6, { f: font(600, 17, MONO), color: C.white, spacing: 3, align: 'center' });
      ctx.restore();
    });
  }

  // ---- collapse point & lift burst ----
  function drawPoint(t) {
    if (t < T.k2) return;
    const p = prog(t, T.k2, T.pre);
    const flare = hit(t, T.pre, 0.06);
    const gone = prog(t, T.lift, T.lift + 0.12);
    if (gone >= 1) return;
    withGlow(20 + 70 * p + 60 * flare, 'rgba(230,181,102,1)', () => {
      ctx.globalAlpha = 1 - gone;
      ctx.fillStyle = '#FFF4DE';
      ctx.beginPath(); ctx.arc(960, 540, 2 + 7 * E.inCubic(p) + 5 * flare, 0, Math.PI * 2); ctx.fill();
    });
  }
  function drawBurst(t) {
    if (t < T.lift) return;
    const dt = t - T.lift, p = prog(t, T.lift, T.lift + 0.6);
    if (p >= 1) return;
    ctx.save();
    ctx.strokeStyle = rgba(C.goldHi, 1 - p); ctx.lineWidth = 8 * (1 - p);
    ctx.beginPath(); ctx.arc(960, 540, 20 + 1300 * E.outExpo(p), 0, Math.PI * 2); ctx.stroke();
    for (const s of A.particles) {
      const d = s.v * (1 - Math.exp(-dt * 4)) / 4, ca = Math.cos(s.a), sa = Math.sin(s.a);
      ctx.strokeStyle = s.gold ? C.goldHi : C.white; ctx.globalAlpha = 1 - p; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(960 + ca * d, 540 + sa * d); ctx.lineTo(960 + ca * (d + s.l), 540 + sa * (d + s.l)); ctx.stroke();
    }
    ctx.restore();
  }

  // ======================================================================
  // DARK WORLD (hook + capabilities)
  // ======================================================================
  function drawDark(t) {
    ctx.fillStyle = C.night; ctx.fillRect(0, 0, W, H);
    const bg = ctx.createRadialGradient(960, 540, 0, 960, 540, 1150);
    bg.addColorStop(0, rgba(C.mid, 0.95)); bg.addColorStop(1, rgba(C.night, 0));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const gridA = 0.04 * prog(t, T.breakdown + 0.2, T.breakdown + 0.8) * (1 - prog(t, T.k2, T.pre));
    if (gridA > 0) {
      ctx.fillStyle = rgba(C.white, gridA);
      for (let x = 0; x <= W; x += 96) ctx.fillRect(x, 0, 1, H);
      for (let y = 12; y <= H; y += 96) ctx.fillRect(0, y, W, 1);
    }

    // camera shake on the big hits
    const shake = 16 * hit(t, T.impact, 0.12) + 6 * BASS().reduce((s, b) => s + hit(t, b, 0.08), 0) + 9 * hit(t, T.drop, 0.1) + 14 * hit(t, T.lift, 0.12);
    ctx.save();
    ctx.translate(shake * Math.sin(t * 97.3), shake * Math.cos(t * 83.1));
    if (t < T.drop) {
      if (t < T.impact) {
        const b = 0.6 + 0.4 * Math.sin(t * 40);
        withGlow(30, 'rgba(230,181,102,1)', () => {
          ctx.fillStyle = C.goldHi; ctx.globalAlpha = b; ctx.beginPath(); ctx.arc(960, 540, 3, 0, Math.PI * 2); ctx.fill();
        });
      }
      drawWord(t);
      drawHookArc(t);
      drawPrompt(t);
    } else {
      drawCapabilities(t);
      drawPoint(t);
      drawBurst(t);
    }
    ctx.restore();

    // grain + vignette
    ctx.save();
    const r = rng(Math.round(t * FPS) + 1);
    ctx.globalAlpha = 0.045; ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = ctx.createPattern(A.noise, 'repeat');
    ctx.translate(-r() * 256, -r() * 256); ctx.fillRect(0, 0, W + 512, H + 512);
    ctx.restore();
    const v = ctx.createRadialGradient(960, 540, 500, 960, 540, 1250);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }

  // ======================================================================
  // PAYOFF  11.77 – 19.00 (daylight)
  // ======================================================================
  const SWEEP = { p0: [-1800, 1700], p1: [900, 560], p2: [3800, -300] };
  function sweepArc(t, extra = 0, w = 46) {
    const d = lerp(1400, -1500, E.outCubic(prog(t, T.lift, T.lift + 0.5))) + extra;
    return arcPts(SWEEP.p0, SWEEP.p1, SWEEP.p2, w, 200, -0.4 * d, d);
  }

  function drawLight(t) {
    const sweeping = t < T.lift + 0.5;
    ctx.save();
    if (sweeping) {
      const arc = sweepArc(t);
      ctx.beginPath();
      arc.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.lineTo(arc[arc.length - 1].x, 6000); ctx.lineTo(arc[0].x, 6000); ctx.closePath();
      ctx.clip();
    }
    ctx.fillStyle = C.white; ctx.fillRect(0, 0, W, H);
    drawEndCard(t);
    ctx.restore();
    if (sweeping) {
      ribbon(sweepArc(t, 90, 14), 0, 1, { alpha: 0.35 });
      ribbon(sweepArc(t, 40, 22), 0, 1, { alpha: 0.6 });
      ribbon(sweepArc(t), 0, 1, { glow: 50 });
    }
  }

  function drawLogo(t) {
    const pa = E.inOutCubic(prog(t, T.lift + 0.18, T.settle));      // A rises into view
    const pv = E.outCubic(prog(t, T.settle, T.settle + 0.55));      // VENTURES wipes in
    if (pa >= 1 && pv >= 1) { ctx.drawImage(A.logo, LX, LY, LW, LH); return; }
    if (pa <= 0) return;
    const g = A.logoBuf.getContext('2d'), m = A.maskBuf.getContext('2d');
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, GEO.width, GEO.height); g.drawImage(A.logo, 0, 0);
    m.clearRect(0, 0, GEO.width, GEO.height);
    const yr = lerp(GEO.aBottom + 30, GEO.aTop - 60, pa);
    let gr = m.createLinearGradient(0, yr - 40, 0, yr + 10);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,1)');
    m.fillStyle = gr; m.fillRect(0, 0, GEO.width, GEO.split);
    const xr = lerp(-60, GEO.width + 60, pv);
    gr = m.createLinearGradient(xr - 60, 0, xr, 0);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    m.fillStyle = gr; m.fillRect(0, GEO.split, GEO.width, GEO.height - GEO.split);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(A.maskBuf, 0, 0);
    ctx.drawImage(A.logoBuf, LX, LY, LW, LH);
  }

  function drawEndCard(t) {
    if (t < T.lift + 0.1) return;
    ctx.save();
    // steady creep (not eased out) so the card keeps breathing, locking still on the final hit
    const push = 0.05 * prog(t, T.settle, T.fin);
    scaleAbout(CAM_PAYOFF[0], CAM_PAYOFF[1], 1 + push);

    // soft warm bloom behind the logo on the final hit (gone before the last frames)
    const bloom = t < T.fin + 0.33 ? 0.16 * hit(t, T.fin, 0.12) : 0;
    if (bloom > 0.002) {
      const b = ctx.createRadialGradient(960, 470, 0, 960, 470, 520);
      b.addColorStop(0, rgba(C.goldHi, bloom)); b.addColorStop(1, rgba(C.goldHi, 0));
      ctx.fillStyle = b; ctx.fillRect(0, 0, W, H);
    }

    drawLogo(t);

    // gold trace that lands on the real swoosh, then hands over to it
    const head = E.inOutCubic(prog(t, T.lift + 0.22, T.lift + 0.75));
    const traceA = 1 - prog(t, T.settle - 0.1, T.settle + 0.2);
    if (head > 0 && traceA > 0) ribbon(A.swooshPts, 0, head, { glow: 18, alpha: traceA, head: true });

    // glint across the swoosh on the final hit (overlay only; logo pixels untouched)
    const gp = prog(t, T.fin, T.fin + 0.32);
    if (gp > 0 && gp < 1) {
      const g = A.logoBuf.getContext('2d');
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, GEO.width, GEO.height); g.drawImage(A.gold, 0, 0);
      g.globalCompositeOperation = 'source-in';
      const gx = lerp(A.swooshX[0] - 90, A.swooshX[1] + 90, E.inOutCubic(gp));
      const gr = g.createLinearGradient(gx - 70, 0, gx + 70, 0);
      gr.addColorStop(0, 'rgba(255,248,230,0)'); gr.addColorStop(0.5, 'rgba(255,248,230,0.85)'); gr.addColorStop(1, 'rgba(255,248,230,0)');
      g.fillStyle = gr; g.fillRect(0, 0, GEO.width, GEO.height);
      ctx.drawImage(A.logoBuf, LX, LY, LW, LH);
    }

    // tagline
    const gap = 26, tw = A.tag1W + gap + A.tag2W, tx = 960 - tw / 2, ty = 818;
    riseText("BUILD WHAT'S", tx, ty, 48, prog(t, T.tag, T.tag + 0.45), { f: A.tagF, color: C.navy, spacing: A.tagSp });
    riseText('NEXT.', tx + A.tag1W + gap, ty, 48, prog(t, T.next, T.next + 0.4), { f: A.tagF, color: C.gold, spacing: A.tagSp }, E.outBack);

    // service line: types on, each service lights on one of the four closing hits
    const out = prog(t, T.fin, T.fin + 0.25);
    if (t >= T.svc && out < 1) {
      const shown = Math.floor(prog(t, T.svc, T.svc + 0.45) * A.svcChars + 0.0001);
      const lights = [T.c1, T.c2, T.c3, T.c4];
      let s = 0;
      for (const piece of A.svc) {
        const vis = clamp(shown - piece.c0, 0, piece.s.length);
        if (vis > 0) {
          const on = piece.service ? prog(t, lights[s], lights[s] + 0.12) : 0;
          text(piece.s.slice(0, vis), piece.x, 890, { f: A.svcF, spacing: A.svcSp, color: on > 0.5 ? C.gold : C.navy, alpha: (1 - out) * lerp(0.6, 1, on) });
          if (piece.service && on > 0) {
            ctx.save(); ctx.globalAlpha = 1 - out; ctx.fillStyle = C.gold;
            ctx.fillRect(piece.x, 902, piece.w * E.outCubic(prog(t, lights[s], lights[s] + 0.25)), 2);
            ctx.restore();
          }
        }
        if (piece.service) s++;
      }
    }
    ctx.restore();
  }

  // ======================================================================
  function render(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    if (t < T.lift + 0.5) drawDark(t);
    if (t >= T.lift) drawLight(t);
    const fl = Math.max(flash(t, T.impact, 0.9), flash(t, T.lift, 0.85));
    if (fl > 0) { ctx.fillStyle = `rgba(255,246,230,${fl})`; ctx.fillRect(0, 0, W, H); }
    // No full-screen flash on the drop (it turns the navy muddy); the gold scan
    // line and camera kick carry that hit instead.
  }

  window.CUES = T;
  window.renderFrame = render;
  window.adReady = init().then(() => { render(0); return true; });

  // Preview: open src/index.html?play and click to play with audio
  if (location.search.includes('play')) {
    document.body.classList.add('preview');
    const audio = new Audio('../build/audio.wav');
    const loop = () => { render(Math.min(audio.currentTime, 19 - 1 / FPS)); requestAnimationFrame(loop); };
    window.adReady.then(() => { requestAnimationFrame(loop); });
    document.body.addEventListener('click', () => { audio.currentTime = 0; audio.play(); });
  }
})();

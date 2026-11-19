'use strict';

// ---------- physics ----------
const XMIN = -10, XMAX = 10;
const MINUS = '−';

const pos = (p, t) => p.x0 + p.v0 * t + 0.5 * p.a * t * t;
const vel = (p, t) => p.v0 + p.a * t;
const sgn = (v) => (Math.abs(v) < 1e-9 ? 0 : Math.sign(v));

// First time (> 0) the object reaches either end of the track, or null if it never does.
function exitTime(p) {
  let best = null;
  for (const B of [XMIN, XMAX]) {
    const roots = [];
    if (Math.abs(p.a) < 1e-12) { if (Math.abs(p.v0) > 1e-12) roots.push((B - p.x0) / p.v0); }
    else {
      const disc = p.v0 * p.v0 - 2 * p.a * (p.x0 - B);
      if (disc >= 0) { const s = Math.sqrt(disc); roots.push((-p.v0 + s) / p.a, (-p.v0 - s) / p.a); }
    }
    for (const r of roots) if (r > 1e-9 && (best === null || r < best)) best = r;
  }
  return best;
}

// Everything needed to draw one motion diagram.
function scenario(p, maxIntervals) {
  const turning = sgn(p.a) !== 0 && sgn(p.v0) !== 0 && sgn(p.a) !== sgn(p.v0);
  const tTurn = turning ? -p.v0 / p.a : null;
  let T = maxIntervals * p.dt;
  const ex = exitTime(p);
  if (ex !== null && ex < T) T = ex;
  const dots = [];
  for (let k = 0; k * p.dt <= T + 1e-9; k++) {
    const t = k * p.dt;
    dots.push({ k, t, x: pos(p, t), v: vel(p, t), row: tTurn !== null && t > tTurn + 1e-9 ? 1 : 0 });
  }
  return { ...p, T, tTurn, dots };
}

// ---------- formatting ----------
function signed(v, digits = 1) {
  const s = sgn(v);
  const n = Math.abs(v).toFixed(digits);
  return s > 0 ? `+${n}` : s < 0 ? `${MINUS}${n}` : n;
}
function motionState(v, a) {
  const sv = sgn(v), sa = sgn(a);
  if (sv === 0 && sa === 0) return { key: 'rest', main: 'At rest', why: 'v = 0 and a = 0, so nothing changes.' };
  if (sa === 0) return { key: 'const', main: 'Constant velocity', why: 'a = 0, so the dots are evenly spaced.' };
  if (sv === 0) return { key: 'stop', main: 'Momentarily stopped', why: `v = 0 right now, but a is still ${sa > 0 ? '+' : MINUS}, so it starts moving ${sa > 0 ? 'right' : 'left'}.` };
  if (sv === sa) return { key: 'speed', main: 'Speeding up', why: 'v and a point the same way, so the gaps between dots grow.' };
  return { key: 'slow', main: 'Slowing down', why: 'v and a point opposite ways, so the gaps between dots shrink.' };
}

// ---------- theme ----------
const root = document.documentElement;
let C = {};
function readColors() {
  const cs = getComputedStyle(root);
  for (const k of ['text', 'muted', 'line', 'card', 'card-2', 'pos', 'vel', 'acc', 'frc', 'dot', 'cart', 'grid', 'axis', 'accent'])
    C[k] = cs.getPropertyValue('--' + k).trim();
}
function setTheme(t) {
  root.dataset.theme = t;
  try { localStorage.setItem('motion-theme', t); } catch (e) { /* storage blocked */ }
  document.getElementById('themeBtn').textContent = t === 'light' ? 'Dark' : 'Light';
  readColors(); redraw();
}

// ---------- canvas helpers ----------
function fit(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}
function arrow(g, x1, y, x2, color, width = 4, head = 11) {
  const len = x2 - x1;
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = width; g.lineCap = 'round';
  if (Math.abs(len) < 2) { g.beginPath(); g.arc(x1, y, width, 0, Math.PI * 2); g.fill(); return; }
  const dir = Math.sign(len), h = Math.min(head, Math.abs(len) * 0.6);
  g.beginPath(); g.moveTo(x1, y); g.lineTo(x2 - dir * h * 0.6, y); g.stroke();
  g.beginPath(); g.moveTo(x2, y); g.lineTo(x2 - dir * h, y - h * 0.6); g.lineTo(x2 - dir * h, y + h * 0.6); g.closePath(); g.fill();
}
function drawCart(g, x, baseY, color, alpha = 1) {
  g.save(); g.globalAlpha = alpha;
  const w = 54, h = 24, r = 6;
  g.fillStyle = color;
  g.beginPath(); g.roundRect(x - w / 2, baseY - 14 - h, w, h, r); g.fill();
  g.fillStyle = 'rgba(255,255,255,.35)';
  g.beginPath(); g.roundRect(x - w / 2 + 8, baseY - 14 - h + 5, w - 16, 8, 3); g.fill();
  g.fillStyle = C.text;
  for (const dx of [-15, 15]) { g.beginPath(); g.arc(x + dx, baseY - 7, 7, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = C.card;
  for (const dx of [-15, 15]) { g.beginPath(); g.arc(x + dx, baseY - 7, 2.5, 0, Math.PI * 2); g.fill(); }
  g.restore();
}

// ---------- the motion diagram ----------
const stage = document.getElementById('stage');
function drawStage(sc, t, o) {
  const { g, w, h } = fit(stage);
  const padL = 46, padR = 46;
  const X = (x) => padL + (x - XMIN) / (XMAX - XMIN) * (w - padL - padR);
  const lineY = h - 48, roadY = lineY - 104;
  const rowY = [lineY - 16, lineY - 62];

  // track / road
  g.strokeStyle = C.line; g.lineWidth = 2;
  g.beginPath(); g.moveTo(X(XMIN), roadY); g.lineTo(X(XMAX), roadY); g.stroke();

  // number line with big − and + like the paper version
  g.strokeStyle = C.axis; g.lineWidth = 2;
  g.beginPath(); g.moveTo(X(XMIN), lineY); g.lineTo(X(XMAX), lineY); g.stroke();
  g.fillStyle = C.axis;
  g.beginPath(); g.moveTo(X(XMAX) + 12, lineY); g.lineTo(X(XMAX) + 2, lineY - 6); g.lineTo(X(XMAX) + 2, lineY + 6); g.fill();
  g.font = '700 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(MINUS, 20, lineY - 2); g.fillText('+', w - 18, lineY - 2);
  g.font = '12px system-ui, sans-serif'; g.textBaseline = 'top';
  const labelEvery = (w - padL - padR) / (XMAX - XMIN) < 24 ? 5 : 2;
  for (let x = XMIN; x <= XMAX; x++) {
    const big = x % labelEvery === 0;
    g.strokeStyle = C.axis; g.lineWidth = big ? 1.5 : 1;
    g.beginPath(); g.moveTo(X(x), lineY - (big ? 6 : 3)); g.lineTo(X(x), lineY + (big ? 6 : 3)); g.stroke();
    if (big) { g.fillStyle = x === 0 ? C.text : C.muted; g.fillText(x > 0 ? `+${x}` : x < 0 ? `${MINUS}${-x}` : '0', X(x), lineY + 10); }
  }
  g.textAlign = 'right'; g.fillStyle = C.muted; g.fillText('x (m)', X(XMAX), lineY + 26);

  const shown = sc.dots.filter((d) => d.t <= t + 1e-9);

  // ghost images
  if (o.ghosts) for (const d of shown) drawCart(g, X(d.x), roadY, C.cart, 0.16);

  // gap sizes between neighbouring dots, written on the dot row between them
  if (o.gaps) {
    g.font = '600 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = C.muted;
    for (let i = 1; i < shown.length; i++) {
      const a = shown[i - 1], b = shown[i];
      if (a.row !== b.row) continue;
      const dx = Math.abs(b.x - a.x), label = `${+dx.toFixed(2)} m`;
      if (Math.abs(X(b.x) - X(a.x)) < g.measureText(label).width + 18) continue;
      g.fillText(label, (X(a.x) + X(b.x)) / 2, rowY[a.row]);
    }
  }

  // the dots (grouped when several land on the same spot)
  const groups = [];
  for (const d of shown) {
    const px = X(d.x), last = groups.find((gr) => gr.row === d.row && Math.abs(gr.px - px) < 2.5);
    if (last) last.items.push(d); else groups.push({ px, row: d.row, items: [d] });
  }
  if (sc.tTurn !== null && shown.some((d) => d.row === 1)) {
    const back = sgn(sc.a) > 0 ? 'right' : 'left';
    g.font = '600 11px system-ui, sans-serif'; g.fillStyle = C.muted; g.textBaseline = 'middle';
    g.textAlign = back === 'right' ? 'left' : 'right';
    g.fillText(`after turning around (moving ${back})`, back === 'right' ? X(XMIN) : X(XMAX), rowY[1] - 22);
  }
  for (const gr of groups) {
    const y = rowY[gr.row], first = gr.items[0];
    const isStart = o.startRing && first.k === 0;
    g.fillStyle = C.dot;
    if (isStart) {
      g.strokeStyle = C.dot; g.lineWidth = 2.5;
      g.beginPath(); g.arc(gr.px, y, 9, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(gr.px, y, 4, 0, Math.PI * 2); g.fill();
    } else { g.beginPath(); g.arc(gr.px, y, 6, 0, Math.PI * 2); g.fill(); }

    if (o.dotArrows) {
      const len = Math.max(-44, Math.min(44, first.v * 7));
      arrow(g, gr.px, y - 15, gr.px + len, C.vel, 2.5, 7);
    } else if (o.numbers || isStart) {
      g.font = '600 12px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillStyle = C.muted;
      let label = gr.items.map((d) => d.k).join(',');
      if (gr.items.length > 3) label = `${gr.items[0].k}–${gr.items[gr.items.length - 1].k}`;
      if (isStart && !o.numbers) label = 'start';
      g.fillText(label, gr.px, y - (isStart ? 12 : 9));
    }
    if (gr.items.length > 1) {
      g.font = '700 11px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = C.accent;
      g.fillText(`×${gr.items.length}`, gr.px + 10, y + 1);
    }
  }

  if (!o.cart) return;
  const xNow = pos(sc, t), vNow = vel(sc, t), cx = X(xNow);

  // drop line from cart to the number line
  g.save(); g.setLineDash([3, 5]); g.strokeStyle = C.muted; g.globalAlpha = 0.6; g.lineWidth = 1;
  g.beginPath(); g.moveTo(cx, roadY + 2); g.lineTo(cx, lineY); g.stroke(); g.restore();
  drawCart(g, cx, roadY, C.cart);

  // vectors above the cart
  // keep every arrow on screen
  const maxLen = w * 0.3;
  const clamp = (L) => Math.max(Math.max(-maxLen, 8 - cx), Math.min(maxLen, w - 8 - cx, L));
  const vecs = [];
  if (o.v) vecs.push({ c: C.vel, L: clamp(vNow * 16), label: `v = ${signed(vNow)} m/s` });
  if (o.a) vecs.push({ c: C.acc, L: clamp(sc.a * 30), label: `a = ${signed(sc.a, 2)} m/s²` });
  if (o.F) { const F = sc.m * sc.a; vecs.push({ c: C.frc, L: clamp(F * 15), label: `F net = ${signed(F)} N` }); }
  const top = roadY - 46 - vecs.length * 26;
  g.font = '700 13px system-ui, sans-serif'; g.textBaseline = 'middle';
  vecs.forEach((v, i) => {
    const y = top + 13 + i * 26;
    arrow(g, cx, y, cx + v.L, v.c);
    const tw = g.measureText(v.label).width;
    let lx = v.L >= 0 ? cx + v.L + 10 : cx + v.L - 10 - tw;
    if (lx + tw > w - 4) lx = cx - 12 - tw;
    if (lx < 4) lx = cx + Math.max(0, v.L) + 12;
    g.fillStyle = v.c; g.textAlign = 'left'; g.fillText(v.label, lx, y);
  });
}

// ---------- graphs ----------
function drawGraph(cv, sc, t, kind) {
  const { g, w, h } = fit(cv);
  const L = 42, R = kind === 'a' ? 40 : 12, T = 26, B = 22, pw = w - L - R, ph = h - T - B;
  const tMax = Math.max(sc.T, 1);
  const f = kind === 'x' ? (tt) => pos(sc, tt) : kind === 'v' ? (tt) => vel(sc, tt) : () => sc.a;
  let lo, hi;
  if (kind === 'x') { lo = XMIN; hi = XMAX; }
  else if (kind === 'v') { const m = Math.max(2, Math.abs(vel(sc, 0)), Math.abs(vel(sc, sc.T))) * 1.15; lo = -m; hi = m; }
  else { const m = Math.max(2, Math.abs(sc.a)) * 1.25; lo = -m; hi = m; }
  const Xp = (tt) => L + tt / tMax * pw, Yp = (v) => T + ph - (v - lo) / (hi - lo) * ph;
  const color = kind === 'x' ? C.pos : kind === 'v' ? C.vel : C.acc;

  // title + current value
  g.font = '700 12.5px system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = color;
  g.fillText(kind === 'x' ? 'Position x (m)' : kind === 'v' ? 'Velocity v (m/s)' : 'Acceleration a (m/s²)', L, 12);
  if (kind === 'a') { g.fillStyle = C.frc; g.textAlign = 'right'; g.fillText('F net (N)', w - 4, 12); }

  // grid + labels
  g.font = '11px system-ui, sans-serif';
  const step = kind === 'x' ? 5 : niceStep(hi - lo);
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const y = Yp(v);
    g.strokeStyle = Math.abs(v) < 1e-9 ? C.axis : C.grid; g.lineWidth = Math.abs(v) < 1e-9 ? 1.5 : 1;
    g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke();
    g.fillStyle = C.muted; g.textAlign = 'right';
    g.fillText(fmtTick(v), L - 6, y);
    if (kind === 'a') { g.textAlign = 'left'; g.fillStyle = C.frc; g.fillText(fmtTick(v * sc.m), L + pw + 6, y); }
  }
  const tStep = niceStep(tMax);
  g.textAlign = 'center'; g.fillStyle = C.muted; g.textBaseline = 'top';
  for (let tt = 0; tt <= tMax + 1e-9; tt += tStep) if (Xp(tt) < L + pw - 34) g.fillText(fmtTick(tt), Xp(tt), T + ph + 6);
  g.textAlign = 'right'; g.fillText('t (s)', L + pw, T + ph + 6); g.textBaseline = 'middle';

  // curve: faint preview of the whole run, solid up to now
  const N = 160;
  const path = (t1) => { g.beginPath(); for (let i = 0; i <= N; i++) { const tt = t1 * i / N; const y = Yp(f(tt)); i ? g.lineTo(Xp(tt), y) : g.moveTo(Xp(tt), y); } };
  g.lineWidth = 2.5; g.lineJoin = 'round';
  g.globalAlpha = 0.22; g.strokeStyle = color; path(sc.T); g.stroke();
  g.globalAlpha = 1; path(Math.min(t, sc.T)); g.stroke();
  if (kind === 'x') {
    g.fillStyle = C.dot;
    for (const d of sc.dots) if (d.t <= t + 1e-9) { g.beginPath(); g.arc(Xp(d.t), Yp(d.x), 3.5, 0, Math.PI * 2); g.fill(); }
  }
  // now marker
  g.strokeStyle = C.muted; g.globalAlpha = 0.5; g.lineWidth = 1;
  g.beginPath(); g.moveTo(Xp(t), T); g.lineTo(Xp(t), T + ph); g.stroke(); g.globalAlpha = 1;
  g.fillStyle = color; g.beginPath(); g.arc(Xp(t), Yp(f(t)), 5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = C.line; g.strokeRect(L + 0.5, T + 0.5, pw, ph);
}
function niceStep(span) {
  const raw = span / 5, p = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}
function fmtTick(v) {
  const r = Math.round(v * 100) / 100;
  return r < 0 ? MINUS + String(-r) : String(r);
}

// ---------- explore state ----------
const S = {
  x0: -9, v0: 1, a: 1, m: 2, F: 2, dt: 1, t: 0, playing: false, speed: 1, mode: 'explore', stopNote: false,
  lead: 'a', // which of a / F the user set last; it stays fixed when the mass changes
  show: { v: true, a: true, F: true, numbers: true, dotArrows: false, ghosts: false, gaps: false, graphs: true },
  pauseAtStop: true,
};
let SC = null;
const maxIntervals = () => Math.min(24, Math.round(12 / S.dt));
function rebuild() { SC = scenario({ x0: S.x0, v0: S.v0, a: S.a, m: S.m, dt: S.dt }, maxIntervals()); }
// Newton's 2nd law ties a, F and m together: recompute whichever of a / F the user didn't set.
function applyNewton() {
  if (S.lead === 'F') S.a = S.F / S.m || 0;
  else S.F = S.m * S.a || 0;
}

const PRESETS = [
  { name: 'Speeding up →', v: '+', a: '+', p: { x0: -9, v0: 1, a: 1 } },
  { name: 'Slowing down →', v: '+', a: MINUS, p: { x0: -9, v0: 6, a: -1.5 } },
  { name: 'Speeding up ←', v: MINUS, a: MINUS, p: { x0: 9, v0: -1, a: -1 } },
  { name: 'Slowing down ←', v: MINUS, a: '+', p: { x0: 9, v0: -6, a: 1.5 } },
  { name: 'Constant velocity', v: '+', a: '0', p: { x0: -9, v0: 1.5, a: 0 } },
  { name: 'At rest', v: '0', a: '0', p: { x0: 0, v0: 0, a: 0 } },
  { name: 'Starts from rest', v: '0', a: '+', p: { x0: -9, v0: 0, a: 1 } },
  { name: 'Thrown, comes back', v: '+', a: MINUS, p: { x0: -8, v0: 5, a: -1.25 } },
];
const $ = (id) => document.getElementById(id);
const presetBox = $('presets');
PRESETS.forEach((pr, i) => {
  const b = document.createElement('button');
  b.innerHTML = `<b>${pr.name}</b><small><span class="sg v">v ${pr.v}</span> · <span class="sg a">a ${pr.a}</span> · <span class="sg f">F ${pr.a}</span></small>`;
  b.onclick = () => { Object.assign(S, pr.p); S.dt = 1; S.lead = 'a'; applyNewton(); resetRun(); S.playing = true; syncUI(); markPreset(i); };
  presetBox.append(b);
});
function markPreset(i) { [...presetBox.children].forEach((b, j) => b.classList.toggle('on', j === i)); }

function resetRun() { S.t = 0; S.stopNote = false; rebuild(); }
function syncUI() {
  $('x0').value = S.x0; $('x0Out').textContent = `${signed(S.x0)} m`;
  $('v0').value = S.v0; $('v0Out').textContent = `${signed(S.v0)} m/s`;
  $('a').value = S.a; $('aOut').textContent = `${signed(S.a, 2)} m/s²`;
  $('F').value = S.F; $('FOut').textContent = `${signed(S.F)} N`;
  $('m').value = S.m; $('mOut').textContent = `${S.m.toFixed(1)} kg`;
  $('holdHint').textContent = S.lead === 'F'
    ? 'Changing the mass keeps F net the same, so a = F net ÷ m changes.'
    : 'Changing the mass keeps a the same, so F net = m · a changes.';
  $('dt').value = String(S.dt);
  $('playBtn').textContent = S.playing ? 'Pause' : S.t >= SC.T - 1e-9 ? 'Replay' : 'Play';
  $('graphs').hidden = !S.show.graphs;
}

for (const key of ['x0', 'v0', 'a', 'F', 'm']) {
  $(key).addEventListener('input', (e) => {
    S[key] = +e.target.value;
    if (key === 'a' || key === 'F') S.lead = key;
    applyNewton(); markPreset(-1); resetRun(); syncUI();
  });
}
$('dt').onchange = (e) => { S.dt = +e.target.value; resetRun(); syncUI(); };
$('speed').onchange = (e) => { S.speed = +e.target.value; };
const toggles = { showV: 'v', showA: 'a', showF: 'F', showNumbers: 'numbers', showDotArrows: 'dotArrows', showGhosts: 'ghosts', showGaps: 'gaps', showGraphs: 'graphs' };
for (const [id, key] of Object.entries(toggles)) $(id).onchange = (e) => { S.show[key] = e.target.checked; syncUI(); };
$('pauseAtStop').onchange = (e) => { S.pauseAtStop = e.target.checked; };

function playPause() {
  if (S.mode !== 'explore') return quizPlayPause();
  if (S.t >= SC.T - 1e-9) { S.t = 0; S.stopNote = false; }
  S.playing = !S.playing; syncUI();
}
function stepDot() {
  const k = Math.floor(S.t / S.dt + 1e-6) + 1;
  S.t = Math.min(SC.T, k * S.dt); S.playing = false; S.stopNote = false; syncUI();
}
$('playBtn').onclick = playPause;
$('stepBtn').onclick = () => (S.mode === 'explore' ? stepDot() : null);
$('endBtn').onclick = () => { if (S.mode === 'explore') { S.t = SC.T; S.playing = false; S.stopNote = false; syncUI(); } };
$('resetBtn').onclick = () => { if (S.mode === 'explore') { resetRun(); S.playing = false; syncUI(); } };

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || (e.target.tagName === 'INPUT' && e.target.type === 'range')) return;
  if (e.key === ' ') { e.preventDefault(); playPause(); }
  else if ((e.key === 'r' || e.key === 'R') && S.mode === 'explore') { resetRun(); S.playing = false; syncUI(); }
  else if (e.key === 'ArrowRight' && S.mode === 'explore') stepDot();
});

function updateReadouts(sc, t) {
  const v = vel(sc, t);
  $('roT').textContent = `${t.toFixed(1)} s`;
  $('roX').textContent = `${signed(pos(sc, t))} m`;
  $('roV').textContent = `${signed(v)} m/s`;
  $('roA').textContent = `${signed(sc.a, 2)} m/s²`;
  $('roF').textContent = `${signed(sc.m * sc.a)} N`;
  const st = motionState(v, sc.a);
  const box = $('status');
  box.className = 'status ' + st.key;
  $('statusMain').textContent = st.main;
  $('statusWhy').textContent = st.why;
}

// ---------- quiz ----------
const Q = { sc: null, ans: {}, key: {}, checked: false, revealing: false, t: 0, score: 0, total: 0, streak: 0, harder: false };
const SIGN_CHOICES = [['-', MINUS], ['0', '0'], ['+', '+']];
const MOTION_CHOICES = [['speed', 'Speeding up'], ['slow', 'Slowing down'], ['const', 'Constant velocity'], ['rest', 'At rest'], ['turn', 'Slows, then turns around']];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function newQuiz() {
  let vs, as;
  do {
    vs = Q.harder && Math.random() < 0.15 ? 0 : pick([1, -1]);
    as = Math.random() < (Q.harder ? 0.25 : 0.18) ? 0 : pick([1, -1]);
  } while (!Q.harder && vs === 0);
  let v0, a, turn = false;
  if (as === 0) { v0 = vs * rnd(2, 3.5); a = 0; }
  else if (vs === 0 || vs === as) { v0 = vs * rnd(0.4, 1.6); a = as * rnd(0.6, 1.2); }
  else if (Q.harder && Math.random() < 0.45) { turn = true; v0 = vs * rnd(3, 4); a = as * Math.abs(v0) / rnd(2.2, 3.2); }
  else { v0 = vs * rnd(4, 5.5); a = as * Math.abs(v0) / rnd(5.6, 7); }
  const n = 5, p = { x0: 0, v0, a, m: 2, dt: 1 };
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k <= n; k++) { const x = pos(p, k); lo = Math.min(lo, x); hi = Math.max(hi, x); }
  if (hi - lo > 17) { const s = 17 / (hi - lo); p.v0 *= s; p.a *= s; lo *= s; hi *= s; }
  p.x0 = Math.round(-(lo + hi) / 2 * 2) / 2;
  if (vs === 0 && as === 0) p.x0 = Math.round(rnd(-6, 6));
  Q.sc = scenario(p, n);
  Q.key = { v: String(vs > 0 ? '+' : vs < 0 ? '-' : '0'), a: as > 0 ? '+' : as < 0 ? '-' : '0' };
  Q.key.F = Q.key.a;
  Q.key.motion = turn ? 'turn' : vs === 0 && as === 0 ? 'rest' : as === 0 ? 'const' : vs === 0 || vs === as ? 'speed' : 'slow';
  Q.turn = turn;
  Q.ans = {}; Q.checked = false; Q.revealing = false; Q.t = Q.sc.T;
  renderQuiz();
}

function renderQuiz() {
  for (const q of document.querySelectorAll('.q')) {
    const id = q.dataset.q, box = q.querySelector('.choices');
    const list = box.dataset.choices === 'sign' ? SIGN_CHOICES : MOTION_CHOICES.filter(([k]) => Q.harder || !['rest', 'turn'].includes(k));
    box.innerHTML = '';
    for (const [val, label] of list) {
      const b = document.createElement('button');
      b.textContent = label;
      if (Q.ans[id] === val) b.classList.add('picked');
      if (Q.checked) {
        b.disabled = true;
        if (val === Q.key[id]) b.classList.add('right');
        else if (Q.ans[id] === val) b.classList.add('wrong');
      }
      b.onclick = () => { if (!Q.checked) { Q.ans[id] = val; renderQuiz(); } };
      box.append(b);
    }
    let mark = q.querySelector('.mark');
    if (!mark) { mark = document.createElement('span'); mark.className = 'mark'; q.querySelector('.qlabel').append(mark); }
    mark.textContent = Q.checked ? (Q.ans[id] === Q.key[id] ? '✓' : '✗') : '';
    mark.className = 'mark ' + (Q.checked ? (Q.ans[id] === Q.key[id] ? 'ok' : 'no') : '');
  }
  $('checkBtn').disabled = Q.checked || ['v', 'a', 'F', 'motion'].some((k) => !Q.ans[k]);
  $('revealBtn').disabled = !Q.checked;
  $('score').textContent = `Score ${Q.score} / ${Q.total}` + (Q.streak > 1 ? ` · streak ${Q.streak}` : '');
  const fb = $('feedback');
  fb.hidden = !Q.checked;
  if (Q.checked) fb.innerHTML = explain();
}

function explain() {
  const k = Q.key, allRight = ['v', 'a', 'F', 'motion'].every((q) => Q.ans[q] === k[q]);
  const dir = k.v === '+' ? 'left to right, toward +' : k.v === '-' ? `right to left, toward ${MINUS}` : 'nowhere at first';
  const parts = [`<p class="big">${allRight ? 'All correct!' : 'Not quite. Here is how to read it:'}</p>`];
  if (k.v === '0') parts.push(`<p><b>Velocity:</b> the first dots sit on top of each other, so it starts at rest: v = 0.</p>`);
  else parts.push(`<p><b>Velocity:</b> the dots go ${dir}, so v is <b>${k.v === '+' ? '+' : MINUS}</b>.</p>`);
  if (k.motion === 'const') parts.push('<p><b>Spacing:</b> the gaps are all equal, so the speed is constant and <b>a = 0</b>.</p>');
  else if (k.motion === 'rest') parts.push('<p><b>Spacing:</b> every dot is in the same spot. Nothing moves, so v = 0 and a = 0.</p>');
  else if (k.motion === 'speed') parts.push(`<p><b>Spacing:</b> the gaps get bigger, so it is speeding up. Speeding up means <b>a points the same way it moves</b>: a is <b>${k.a === '+' ? '+' : MINUS}</b>.</p>`);
  else if (k.motion === 'slow') parts.push(`<p><b>Spacing:</b> the gaps get smaller, so it is slowing down. Slowing down means <b>a points opposite the motion</b>: a is <b>${k.a === '+' ? '+' : MINUS}</b>.</p>`);
  else parts.push(`<p><b>Spacing:</b> the gaps shrink, it stops, then it comes back the other way. a points ${k.a === '+' ? 'right (+)' : `left (${MINUS})`} the whole time, even at the moment it stops.</p>`);
  parts.push(`<p><b>Net force:</b> Newton's 2nd law, F<sub>net</sub> = m·a, so F<sub>net</sub> always has the same sign as a: <b>${k.F === '+' ? '+' : k.F === '-' ? MINUS : '0'}</b>.</p>`);
  return parts.join('');
}

$('checkBtn').onclick = () => {
  Q.checked = true; Q.total++;
  const ok = ['v', 'a', 'F', 'motion'].every((q) => Q.ans[q] === Q.key[q]);
  if (ok) { Q.score++; Q.streak++; } else Q.streak = 0;
  renderQuiz();
};
$('revealBtn').onclick = () => { Q.revealing = true; Q.t = 0; Q.playing = true; };
$('nextBtn').onclick = newQuiz;
$('harder').onchange = (e) => { Q.harder = e.target.checked; newQuiz(); };
function quizPlayPause() { if (Q.checked) { if (Q.t >= Q.sc.T) Q.t = 0; Q.revealing = true; Q.playing = !Q.playing; } }

// ---------- mode switching ----------
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => setMode(b.dataset.mode);
function setMode(m) {
  S.mode = m;
  for (const b of document.querySelectorAll('.tabs button')) { b.classList.toggle('on', b.dataset.mode === m); b.setAttribute('aria-selected', b.dataset.mode === m); }
  $('explorePanel').hidden = m !== 'explore';
  $('quizPanel').hidden = m !== 'quiz';
  $('transport').hidden = m !== 'explore';
  if (m === 'quiz') { S.playing = false; if (!Q.sc) newQuiz(); }
  syncUI();
}

// ---------- loop ----------
function redraw() {
  if (!SC) return;
  if (S.mode === 'explore') {
    drawStage(SC, S.t, { cart: true, v: S.show.v, a: S.show.a, F: S.show.F, numbers: S.show.numbers, dotArrows: S.show.dotArrows, ghosts: S.show.ghosts, gaps: S.show.gaps, startRing: false });
    updateReadouts(SC, S.t);
    if (S.stopNote) { $('statusMain').textContent = 'Paused: it stopped for an instant'; }
    if (S.show.graphs) for (const [id, k] of [['gx', 'x'], ['gv', 'v'], ['ga', 'a']]) drawGraph($(id), SC, S.t, k);
  } else {
    const sc = Q.sc, t = Q.revealing ? Q.t : sc.T;
    drawStage(sc, t, { cart: Q.revealing, v: true, a: true, F: true, numbers: Q.revealing, dotArrows: false, ghosts: false, gaps: false, startRing: true });
    $('readouts').hidden = !Q.revealing;
    if (Q.revealing) updateReadouts(sc, t);
    $('graphs').hidden = !Q.revealing || !S.show.graphs;
    if (Q.revealing && S.show.graphs) for (const [id, k] of [['gx', 'x'], ['gv', 'v'], ['ga', 'a']]) drawGraph($(id), sc, t, k);
  }
  if (S.mode === 'explore') $('readouts').hidden = false;
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (S.mode === 'explore' && S.playing) {
    const prev = S.t;
    S.t += dt * S.speed;
    if (S.pauseAtStop && SC.tTurn !== null && prev < SC.tTurn - 1e-6 && S.t >= SC.tTurn) {
      S.t = SC.tTurn; S.playing = false; S.stopNote = true; syncUI();
    } else if (S.t >= SC.T) { S.t = SC.T; S.playing = false; syncUI(); }
    else if (S.stopNote) S.stopNote = false;
  }
  if (S.mode === 'quiz' && Q.revealing && Q.playing) {
    Q.t += dt * S.speed;
    if (Q.t >= Q.sc.T) { Q.t = Q.sc.T; Q.playing = false; }
  }
  redraw();
  requestAnimationFrame(frame);
}

// ---------- start ----------
let theme = 'dark';
try { theme = localStorage.getItem('motion-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); } catch (e) { /* storage blocked */ }
$('themeBtn').onclick = () => setTheme(root.dataset.theme === 'light' ? 'dark' : 'light');
const params = new URLSearchParams(location.search);
if (params.get('theme')) theme = params.get('theme');
setTheme(theme);
rebuild(); syncUI(); markPreset(0);
if (params.get('preset')) { const i = +params.get('preset'); Object.assign(S, PRESETS[i].p); applyNewton(); resetRun(); markPreset(i); }
// direct links like ?v0=4&F=-6&m=2 (F wins over a if both are given)
for (const k of ['x0', 'v0', 'm', 'a', 'F']) {
  if (params.has(k) && isFinite(+params.get(k))) { S[k] = +params.get(k); if (k === 'a' || k === 'F') S.lead = k; markPreset(-1); }
}
applyNewton(); resetRun(); syncUI();
if (params.get('t')) S.t = Math.min(+params.get('t'), SC.T);
for (const k of ['ghosts', 'gaps', 'dotArrows']) if (params.get(k)) { S.show[k] = true; $(Object.keys(toggles).find((id) => toggles[id] === k)).checked = true; }
if (params.get('mode') === 'quiz') setMode('quiz');
syncUI();
requestAnimationFrame(frame);

import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

// ---------- constants ----------
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const YEAR = 365.25;          // days
const D = 10;                 // deferent radius in scene units
const SKY_R = 48;             // radius of the zodiac band around the observer
const MAX_TRAIL = Math.ceil(30 * YEAR) + 2;
const CAP = MAX_TRAIL * 2;
const SNAP_COUNT = 9;

const COL_PRO_SKY = new THREE.Color('#7fd1ff');
const COL_RETRO = new THREE.Color('#ff5470');

const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpius',
  'Sagittarius', 'Capricornus', 'Aquarius', 'Pisces'];
const SIGN_ABBR = ['Ari', 'Tau', 'Gem', 'Cnc', 'Leo', 'Vir', 'Lib', 'Sco', 'Sgr', 'Cap', 'Aqr', 'Psc'];

// Superior planets: epicycle period = 1 year (Earth's orbit in disguise), deferent = planet's orbit.
// Inferior planets: deferent period = 1 year (center locked to the Sun), epicycle = planet's orbit.
// k = epicycle radius / deferent radius = ratio of orbit sizes. ecc = Ptolemy's eccentricity.
const PRESETS = {
  mercury: { name: 'Mercury', color: '#b8b1a6', kind: 'inferior', Td: 1, Te: 0.2408, k: 0.387, tilt: 7.0, ecc: 0.05 },
  venus:   { name: 'Venus',   color: '#f1d8a0', kind: 'inferior', Td: 1, Te: 0.6152, k: 0.723, tilt: 3.4, ecc: 0.021 },
  mars:    { name: 'Mars',    color: '#e0603a', kind: 'superior', Td: 1.8809, Te: 1, k: 0.656, tilt: 1.9, ecc: 0.1 },
  jupiter: { name: 'Jupiter', color: '#d9b38c', kind: 'superior', Td: 11.862, Te: 1, k: 0.192, tilt: 1.3, ecc: 0.046 },
  saturn:  { name: 'Saturn',  color: '#e8d08f', kind: 'superior', Td: 29.457, Te: 1, k: 0.105, tilt: 2.5, ecc: 0.057 },
};

// ---------- state ----------
const P = {};                 // model parameters
const S = {
  mode: 'ptolemy', preset: 'mars', custom: false,
  t: 0, playing: true, speed: 40, trailDays: 4 * YEAR,
  view: '3d',
  show: { trail: true, sky: true, sight: true, snaps: false, sun: true, arms: true, labels: true, chart: true },
};

function wrapPi(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
function wrap2Pi(a) { a %= TAU; return a < 0 ? a + TAU : a; }
const logMap = (v, lo, hi) => lo * Math.pow(hi / lo, v / 1000);
const logInv = (x, lo, hi) => Math.round(1000 * Math.log(x / lo) / Math.log(hi / lo));

function loadPreset(key) {
  const p = PRESETS[key];
  Object.assign(P, { name: p.name, color: p.color, kind: p.kind, Td: p.Td, Te: p.Te, k: p.k, tilt: p.tilt, ecc: p.ecc });
  S.preset = key; S.custom = false;
  derive(); resetPhases();
  S.trailDays = Math.min(MAX_TRAIL - 2, Math.max(2 * synodicDays(), key === 'saturn' || key === 'jupiter' ? 1.1 * P.Td * YEAR : 0));
}
function derive() { P.wd = TAU / (P.Td * YEAR); P.we = TAU / (P.Te * YEAR); }
function synodicDays() { const f = Math.abs(1 / P.Td - 1 / P.Te); return f < 1e-6 ? 1e5 : YEAR / f; }

// Line everything up so the middle of a retrograde loop happens on day T0.
const T0 = 120;
function resetPhases() {
  const ldAt = 150 * DEG;
  P.ld0 = ldAt - P.wd * T0;
  P.le0 = P.ld0 + (P.wd - P.we) * T0 + Math.PI;
  P.ls0 = P.kind === 'superior' ? P.le0 : P.ld0;
  P.node = (P.kind === 'superior' ? ldAt : P.le0 + P.we * T0) - 60 * DEG;
}
// Keep the current angles continuous when a period slider changes.
function changePeriod(which, T) {
  const t = S.t;
  if (which === 'Td') { const a = P.ld0 + P.wd * t; P.Td = T; derive(); P.ld0 = a - P.wd * t; }
  else { const a = P.le0 + P.we * t; P.Te = T; derive(); P.le0 = a - P.we * t; }
}

// ---------- model ----------
// Plane coords (x, y) + height h. World: x → x, h → y, y → -z (counter-clockwise seen from above).
function mkState() {
  return { earth: { x: 0, y: 0, h: 0 }, planet: { x: 0, y: 0, h: 0 }, center: { x: 0, y: 0, h: 0 },
    sun: { x: 0, y: 0, h: 0 }, equant: { x: 0, y: 0, h: 0 }, G: { x: 0, y: 0, h: 0 }, lon: 0, lat: 0, sunLon: 0 };
}
const tv = { x: 0, y: 0, h: 0 };
function tilt(x, y, out) {
  const i = P.tilt * DEG, cO = Math.cos(P.node), sO = Math.sin(P.node);
  const a = x * cO + y * sO, b = -x * sO + y * cO;
  out.x = a * cO - b * Math.cos(i) * sO;
  out.y = a * sO + b * Math.cos(i) * cO;
  out.h = b * Math.sin(i);
  return out;
}
function set(o, x, y, h) { o.x = x; o.y = y; o.h = h; return o; }

function compute(t, st, mode = S.mode) {
  const ld = P.ld0 + P.wd * t, le = P.le0 + P.we * t, ls = P.ls0 + TAU * t / YEAR;
  const R = D, r = P.k * D, sup = P.kind === 'superior';
  if (mode === 'ptolemy') {
    const e = P.equant ? P.ecc * R : 0;
    set(st.earth, -e, 0, 0);
    set(st.equant, e, 0, 0);
    let cx = R * Math.cos(ld), cy = R * Math.sin(ld);
    if (e) {
      // The center moves at a steady angle as seen from the equant, staying on the deferent circle.
      const ux = Math.cos(ld), uy = Math.sin(ld), qu = e * ux;
      const s = -qu + Math.sqrt(qu * qu - e * e + R * R);
      cx = e + s * ux; cy = s * uy;
    }
    if (sup) tilt(cx, cy, st.center); else set(st.center, cx, cy, 0);
    const ax = r * Math.cos(le), ay = r * Math.sin(le);
    if (sup) set(tv, ax, ay, 0); else tilt(ax, ay, tv);
    set(st.planet, st.center.x + tv.x, st.center.y + tv.y, st.center.h + tv.h);
    const sd = sup ? Math.max(r, 4.5) : R;
    set(st.sun, st.earth.x + sd * Math.cos(ls), st.earth.y + sd * Math.sin(ls), 0);
  } else {
    set(st.sun, 0, 0, 0);
    if (sup) { tilt(R * Math.cos(ld), R * Math.sin(ld), st.planet); set(st.earth, -r * Math.cos(le), -r * Math.sin(le), 0); }
    else { tilt(r * Math.cos(le), r * Math.sin(le), st.planet); set(st.earth, -R * Math.cos(ld), -R * Math.sin(ld), 0); }
    set(st.center, 0, 0, 0);
  }
  const G = set(st.G, st.planet.x - st.earth.x, st.planet.y - st.earth.y, st.planet.h - st.earth.h);
  st.lon = wrap2Pi(Math.atan2(G.y, G.x));
  st.lat = Math.atan2(G.h, Math.hypot(G.x, G.y));
  st.sunLon = wrap2Pi(Math.atan2(st.sun.y - st.earth.y, st.sun.x - st.earth.x));
  return st;
}
const tmpA = mkState(), tmpB = mkState();
function lonRate(t) { // radians per day, centered difference
  return wrapPi(compute(t + 0.5, tmpA).lon - compute(t - 0.5, tmpB).lon);
}
const STATION = 0.02 * DEG; // below this daily motion we call it "stationary"

function W(p, v = new THREE.Vector3()) { return v.set(p.x, p.h, -p.y); }

// ---------- renderer / scene ----------
const canvas = document.getElementById('gl');
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#04060c');
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 3000);
camera.position.set(0, 24, 30);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 3; controls.maxDistance = 220;

scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const sunLight = new THREE.PointLight(0xfff2d6, 2.4, 0, 0);
scene.add(sunLight);

// seeded random for a stable sky
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function makeStars() {
  const group = new THREE.Group();
  for (const [n, size, op] of [[2200, 1.4, 0.75], [400, 2.6, 0.95]]) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1, th = rnd() * TAU, s = Math.sqrt(1 - u * u), rr = 900;
      pos.set([rr * s * Math.cos(th), rr * u, rr * s * Math.sin(th)], i * 3);
      const c = new THREE.Color().setHSL(0.55 + (rnd() - 0.5) * 0.25, 0.4, 0.7 + rnd() * 0.3);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    group.add(new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: op, depthWrite: false })));
  }
  return group;
}
const stars = makeStars();
scene.add(stars);

function glowTexture(inner, outer = 'rgba(0,0,0,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.45)')); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function glow(color, size) {
  const m = new THREE.SpriteMaterial({ map: glowTexture(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const s = new THREE.Sprite(m); s.scale.set(size, size, 1); return s;
}

function makeLabel(text, color = '#e6eaf5', size = 0.9) {
  const fs = 56, c = document.createElement('canvas'), g = c.getContext('2d');
  const font = `600 ${fs}px system-ui, -apple-system, Segoe UI, sans-serif`;
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width) + 20; c.height = Math.ceil(fs * 1.35);
  g.font = font; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,.95)'; g.shadowBlur = 8;
  g.fillStyle = color; g.fillText(text, 10, c.height / 2);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true }));
  s.userData.base = size; s.userData.aspect = c.width / c.height;
  s.scale.set(size * s.userData.aspect, size, 1);
  s.center.set(0.5, -0.25);
  s.renderOrder = 10;
  return s;
}

function earthTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1d5fae'; g.fillRect(0, 0, 256, 128);
  seed = 42;
  for (let i = 0; i < 26; i++) {
    g.fillStyle = rnd() < 0.7 ? '#3f8f4a' : '#a88d58';
    g.beginPath(); g.ellipse(rnd() * 256, 20 + rnd() * 88, 8 + rnd() * 26, 5 + rnd() * 14, rnd() * 3, 0, TAU); g.fill();
  }
  g.fillStyle = '#eef3f8'; g.fillRect(0, 0, 256, 9); g.fillRect(0, 119, 256, 9);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// bodies
const earth = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 16), new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 0.9, emissive: 0x0a1a30 }));
const earthGlow = glow('rgba(110,170,255,0.6)', 2.2); earth.add(earthGlow);
const sun = new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 16), new THREE.MeshBasicMaterial({ color: 0xffd36b }));
sun.add(glow('rgba(255,200,90,0.95)', 7));
const planet = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 16), new THREE.MeshStandardMaterial({ color: 0xe0603a, roughness: 0.8 }));
const planetGlow = glow('rgba(255,140,90,0.8)', 2.4); planet.add(planetGlow);
scene.add(earth, sun, planet);

const lblEarth = makeLabel('Earth', '#9cc7ff'), lblSun = makeLabel('Sun', '#ffd36b'), lblPlanet = makeLabel('Mars', '#ffb08c');
const lblDef = makeLabel('Deferent', '#8d97b3', 0.75), lblEpi = makeLabel('Epicycle', '#c79bff', 0.7), lblEq = makeLabel('Equant', '#ffcf5a', 0.65);
const lblDefC = makeLabel('Center', '#8d97b3', 0.55);
scene.add(lblEarth, lblSun, lblPlanet, lblDef, lblEpi, lblEq, lblDefC);

// lines
function lineObj(n, color, opacity = 1, dashed = false) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const m = dashed ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.5, gapSize: 0.35 })
    : new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  const l = new THREE.Line(g, m); l.frustumCulled = false; return l;
}
function setLine(l, ...pts) {
  const a = l.geometry.attributes.position;
  pts.forEach((p, i) => a.setXYZ(i, p.x, p.y, p.z));
  a.needsUpdate = true;
  if (l.material.isLineDashedMaterial) l.computeLineDistances();
}
const RING_N = 160;
const bodyScale = { sun: 1, planet: 1 };
const ringDef = lineObj(RING_N + 1, 0x5b6a92, 0.9);
const ringEpi = lineObj(RING_N + 1, 0xb68cff, 0.9);
const ringSun = lineObj(RING_N + 1, 0xffcf5a, 0.28, true);
const ringEarthOrbit = lineObj(RING_N + 1, 0x6aa8ff, 0.7);
const ringPlanetOrbit = lineObj(RING_N + 1, 0x5b6a92, 0.9);
const armDef = lineObj(2, 0x8d97b3, 0.8), armEpi = lineObj(2, 0xb68cff, 0.95), armEq = lineObj(2, 0xffcf5a, 0.6, true);
const armSunEarth = lineObj(2, 0x6aa8ff, 0.5), armSunPlanet = lineObj(2, 0x8d97b3, 0.5);
const sight = lineObj(2, 0xffffff, 0.45);
scene.add(ringDef, ringEpi, ringSun, ringEarthOrbit, ringPlanetOrbit, armDef, armEpi, armEq, armSunEarth, armSunPlanet, sight);

const dotMat = (c) => new THREE.MeshBasicMaterial({ color: c });
const equantDot = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), dotMat(0xffcf5a));
const centerDot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), dotMat(0x8d97b3));
const epiCenterDot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), dotMat(0xb68cff));
scene.add(equantDot, centerDot, epiCenterDot);

function fillRing(l, fn) {
  const a = l.geometry.attributes.position, v = { x: 0, y: 0, h: 0 };
  for (let i = 0; i <= RING_N; i++) { fn(i / RING_N * TAU, v); a.setXYZ(i, v.x, v.h, -v.y); }
  a.needsUpdate = true;
  l.geometry.computeBoundingSphere();
  if (l.material.isLineDashedMaterial) l.computeLineDistances();
}
function buildRings() {
  const R = D, r = P.k * D, sup = P.kind === 'superior';
  const flat = (rad) => (a, v) => set(v, rad * Math.cos(a), rad * Math.sin(a), 0);
  const tilted = (rad) => (a, v) => tilt(rad * Math.cos(a), rad * Math.sin(a), v);
  // deferent: centered on origin; Earth sits at -e in the equant model
  fillRing(ringDef, sup ? tilted(R) : flat(R));
  fillRing(ringEpi, sup ? flat(r) : tilted(r)); // epicycle ring is drawn around the origin, moved each frame
  fillRing(ringSun, flat(sup ? Math.max(r, 4.5) : R));
  fillRing(ringEarthOrbit, flat(sup ? r : R));
  fillRing(ringPlanetOrbit, sup ? tilted(R) : tilted(r));
  const sc = THREE.MathUtils.clamp(Math.min(r, R) / 4, 0.35, 1);
  earth.scale.setScalar(sc); bodyScale.sun = sc; bodyScale.planet = Math.max(sc, 0.5);
}

// ---------- sky (zodiac band around the observer) ----------
const sky = new THREE.Group();
scene.add(sky);
{
  const band = 8 * DEG;
  for (const [lat, op] of [[0, 0.55], [band, 0.22], [-band, 0.22]]) {
    const l = lineObj(RING_N + 1, 0x7f8db8, op);
    fillRing(l, (a, v) => set(v, SKY_R * Math.cos(lat) * Math.cos(a), SKY_R * Math.cos(lat) * Math.sin(a), SKY_R * Math.sin(lat)));
    sky.add(l);
  }
  for (let i = 0; i < 12; i++) {
    const a = i * 30 * DEG, l = lineObj(2, 0x7f8db8, 0.35);
    const c = Math.cos(band) * SKY_R;
    setLine(l, new THREE.Vector3(c * Math.cos(a), SKY_R * Math.sin(band), -c * Math.sin(a)),
      new THREE.Vector3(c * Math.cos(a), -SKY_R * Math.sin(band), -c * Math.sin(a)));
    sky.add(l);
    const m = (i * 30 + 15) * DEG, lb = makeLabel(SIGNS[i], '#a9b4d6', 2.1);
    lb.position.set(c * Math.cos(m), SKY_R * Math.sin(band) + 0.3, -c * Math.sin(m));
    lb.userData.zodiac = true;
    sky.add(lb);
  }
}
// sky track + apparent-position marker
function trackLine() {
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const ca = new THREE.BufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa); g.setAttribute('color', ca); g.setDrawRange(0, 0);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
  l.frustumCulled = false; return l;
}
const skyTrack = trackLine(); sky.add(skyTrack);
const trail = trackLine(); scene.add(trail);
const skyMarker = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 10), dotMat(0x7fd1ff));
const skyMarkerGlow = glow('rgba(127,209,255,0.9)', 4); skyMarker.add(skyMarkerGlow);
sky.add(skyMarker);
const sunSkyMarker = glow('rgba(255,207,90,0.9)', 5);
sky.add(sunSkyMarker);

// numbered sight lines
const snaps = [];
const labelCache = new Map();
function numberTexture(n) {
  if (labelCache.has(n)) return labelCache.get(n);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,14,26,.9)'; g.beginPath(); g.arc(32, 32, 28, 0, TAU); g.fill();
  g.strokeStyle = '#ffcf5a'; g.lineWidth = 4; g.stroke();
  g.fillStyle = '#ffcf5a'; g.font = '700 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 32, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  labelCache.set(n, t); if (labelCache.size > 60) labelCache.delete(labelCache.keys().next().value);
  return t;
}
const snapGroup = new THREE.Group(); scene.add(snapGroup);
for (let i = 0; i < SNAP_COUNT; i++) {
  const line = lineObj(2, 0xffcf5a, 0.45);
  const pDot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 6), dotMat(0xffcf5a));
  const eDot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 6), dotMat(0x9cc7ff));
  const num = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true }));
  num.scale.set(1.6, 1.6, 1); num.renderOrder = 11;
  const pNum = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, transparent: true }));
  pNum.scale.set(0.8, 0.8, 1); pNum.center.set(-0.2, -0.2); pNum.renderOrder = 11;
  snapGroup.add(line, pDot, eDot, num, pNum);
  snaps.push({ line, pDot, eDot, num, pNum, n: -1 });
}

// ---------- history (path, sky track, chart) ----------
const H = { n: 0, lastDay: -1, lon: new Float32Array(CAP), retro: new Uint8Array(CAP), day: new Float32Array(CAP) };
const trailCol = new THREE.Color(), trailRetro = new THREE.Color('#ff5470');
const hs = mkState(), v3 = new THREE.Vector3();
function pushSample(d) {
  if (H.n >= CAP) compact();
  const i = H.n++;
  compute(d, hs);
  const rate = lonRate(d), retro = rate < 0 ? 1 : 0;
  H.lon[i] = hs.lon; H.retro[i] = retro; H.day[i] = d;
  const tp = trail.geometry.attributes.position, tc = trail.geometry.attributes.color;
  W(hs.planet, v3); tp.setXYZ(i, v3.x, v3.y, v3.z);
  const c = retro ? trailRetro : trailCol; tc.setXYZ(i, c.r, c.g, c.b);
  const sp = skyTrack.geometry.attributes.position, sc = skyTrack.geometry.attributes.color;
  W(hs.G, v3).normalize().multiplyScalar(SKY_R * 0.995); sp.setXYZ(i, v3.x, v3.y, v3.z);
  const c2 = retro ? COL_RETRO : COL_PRO_SKY; sc.setXYZ(i, c2.r, c2.g, c2.b);
}
function compact() {
  const keep = MAX_TRAIL, from = H.n - keep;
  for (const arr of [H.lon, H.retro, H.day]) arr.copyWithin(0, from, H.n);
  for (const l of [trail, skyTrack]) for (const a of [l.geometry.attributes.position, l.geometry.attributes.color]) {
    a.array.copyWithin(0, from * 3, H.n * 3); a.clearUpdateRanges(); a.needsUpdate = true;
  }
  H.n = keep;
}
function markUpdate(from, count) {
  for (const l of [trail, skyTrack]) for (const a of [l.geometry.attributes.position, l.geometry.attributes.color]) {
    a.addUpdateRange(from * 3, count * 3); a.needsUpdate = true;
  }
}
function rebuildHistory() {
  H.n = 0;
  const last = Math.floor(S.t), first = Math.max(0, last - Math.ceil(S.trailDays));
  for (let d = first; d <= last; d++) pushSample(d);
  H.lastDay = last;
  for (const l of [trail, skyTrack]) for (const a of [l.geometry.attributes.position, l.geometry.attributes.color]) {
    a.clearUpdateRanges(); a.needsUpdate = true;
  }
}
function advanceHistory() {
  const last = Math.floor(S.t);
  if (last < H.lastDay) return rebuildHistory();
  if (last - H.lastDay > MAX_TRAIL) { H.lastDay = last - MAX_TRAIL; }
  const start = H.n;
  let compacted = false;
  while (H.lastDay < last) { if (H.n >= CAP) compacted = true; pushSample(++H.lastDay); }
  if (compacted) rebuildHistory(); else if (H.n > start) markUpdate(start, H.n - start);
}
function windowStart() { return Math.max(0, H.n - Math.ceil(S.trailDays) - 1); }

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
const chips = $('planetChips');
for (const [key, p] of Object.entries(PRESETS)) {
  const b = document.createElement('button');
  b.dataset.key = key; b.innerHTML = `<i style="background:${p.color}"></i>${p.name}`;
  b.onclick = () => { selectPlanet(key); };
  chips.append(b);
}

function fmtYears(T) { return T < 1.5 ? `${Math.round(T * YEAR)} days` : `${T.toFixed(T < 10 ? 2 : 1)} yr`; }
function syncUI() {
  for (const b of chips.children) b.classList.toggle('on', !S.custom && b.dataset.key === S.preset);
  $('customNote').hidden = !S.custom; $('customBase').textContent = PRESETS[S.preset].name;
  $('k').value = Math.round(P.k * 1000); $('kOut').textContent = P.k.toFixed(3);
  $('Td').value = logInv(P.Td, 0.1, 40); $('TdOut').textContent = fmtYears(P.Td);
  $('Te').value = logInv(P.Te, 0.1, 40); $('TeOut').textContent = fmtYears(P.Te);
  $('tilt').value = Math.round(P.tilt * 10); $('tiltOut').textContent = `${P.tilt.toFixed(1)}°`;
  $('equant').checked = !!P.equant;
  $('ecc').value = Math.round(P.ecc * 1000); $('eccOut').textContent = P.ecc.toFixed(3);
  $('eccRow').classList.toggle('disabled', !P.equant);
  $('equantNote').hidden = !(P.equant && S.mode === 'copernicus');
  $('speed').value = logInv(S.speed, 1, 1000); $('speedOut').textContent = `${S.speed < 10 ? S.speed.toFixed(1) : Math.round(S.speed)} days/s`;
  $('trail').value = logInv(S.trailDays / YEAR, 0.25, 30);
  $('trailOut').textContent = S.trailDays < YEAR * 1.5 ? `${Math.round(S.trailDays)} days` : `${(S.trailDays / YEAR).toFixed(1)} yr`;
  $('playBtn').textContent = S.playing ? 'Pause' : 'Play';
  for (const b of document.querySelectorAll('#modeSeg button')) b.classList.toggle('on', b.dataset.mode === S.mode);
  for (const b of document.querySelectorAll('#viewbar button')) b.classList.toggle('on', b.dataset.view === S.view);
  $('hudMode').textContent = S.mode === 'ptolemy' ? 'Earth-centered · Ptolemy' : 'Sun-centered · Copernicus';
  $('hudPlanet').textContent = P.name + (S.custom ? ' (custom)' : '');
  $('hudDot').style.background = P.color; $('hudDot').style.color = P.color;
  $('chartWrap').hidden = !S.show.chart;
  document.body.classList.toggle('view-earth', S.view === 'earth');
  writeExplain();
}

function applyColors() {
  const c = new THREE.Color(P.color);
  planet.material.color.copy(c);
  planetGlow.material.map = glowTexture(`rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},0.8)`);
  trailCol.copy(c).lerp(new THREE.Color('#ffffff'), 0.25);
  scene.remove(lblPlanet); lblPlanet.material.map.dispose();
  const nl = makeLabel(P.name, '#' + c.clone().lerp(new THREE.Color('#fff'), 0.4).getHexString());
  lblPlanet.material = nl.material; lblPlanet.scale.copy(nl.scale); lblPlanet.userData = nl.userData;
  scene.add(lblPlanet);
}

function selectPlanet(key) {
  const eq = P.equant;
  loadPreset(key); P.equant = eq;
  S.t = 0; H.lastDay = -1;
  applyColors(); buildRings(); rebuildHistory(); syncUI();
  if (S.view === 'earth') aimAtPlanet();
}
function paramsChanged(rings = true) {
  S.custom = true;
  if (rings) buildRings();
  rebuildHistory(); syncUI();
}

$('k').oninput = (e) => { P.k = e.target.value / 1000; paramsChanged(); };
$('Td').oninput = (e) => { changePeriod('Td', logMap(+e.target.value, 0.1, 40)); paramsChanged(); };
$('Te').oninput = (e) => { changePeriod('Te', logMap(+e.target.value, 0.1, 40)); paramsChanged(); };
$('tilt').oninput = (e) => { P.tilt = e.target.value / 10; paramsChanged(); };
$('ecc').oninput = (e) => { P.ecc = e.target.value / 1000; if (!P.equant) P.equant = true; paramsChanged(); };
$('equant').onchange = (e) => { P.equant = e.target.checked; rebuildHistory(); syncUI(); };
$('speed').oninput = (e) => { S.speed = logMap(+e.target.value, 1, 1000); syncUI(); };
$('trail').oninput = (e) => { S.trailDays = logMap(+e.target.value, 0.25, 30) * YEAR; rebuildHistory(); syncUI(); };
$('playBtn').onclick = () => { S.playing = !S.playing; syncUI(); };
$('stepBtn').onclick = () => { S.t += 10; };
$('resetBtn').onclick = reset;
function reset() { resetPhases(); S.t = 0; rebuildHistory(); syncUI(); if (S.view === 'earth') aimAtPlanet(); }
for (const b of document.querySelectorAll('#modeSeg button')) b.onclick = () => setMode(b.dataset.mode);
for (const b of document.querySelectorAll('#viewbar button')) b.onclick = () => setView(b.dataset.view);
for (const key of Object.keys(S.show)) {
  const el = $('show' + key[0].toUpperCase() + key.slice(1));
  el.checked = S.show[key];
  el.onchange = () => { S.show[key] = el.checked; syncUI(); };
}
function setMode(m) { S.mode = m; rebuildHistory(); syncUI(); }

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
  if (e.key === ' ') { e.preventDefault(); S.playing = !S.playing; syncUI(); }
  else if (e.key === 'r' || e.key === 'R') reset();
  else if (e.key === '1') setView('3d');
  else if (e.key === '2') setView('top');
  else if (e.key === '3') setView('earth');
  else if (e.key === 'm' || e.key === 'M') setMode(S.mode === 'ptolemy' ? 'copernicus' : 'ptolemy');
  else if (e.key === 'ArrowRight' && e.target.type !== 'range') S.t += 5;
  else if (e.key === 'ArrowLeft' && e.target.type !== 'range') S.t = Math.max(0, S.t - 5);
});

// ---------- explanation ----------
function writeExplain() {
  const sup = P.kind === 'superior', n = P.name;
  const key = (c) => `<span class="key" style="background:${c}"></span>`;
  let html;
  if (S.mode === 'ptolemy') {
    html = `
      <p>Earth sits at the center. ${n} rides on a small circle, the ${key('#b68cff')}<b>epicycle</b>, whose center travels around a big circle, the ${key('#5b6a92')}<b>deferent</b>.</p>
      <p>Most of the time the two motions add up and ${n} drifts <b>east</b> against the stars. When ${n} swings around the inner side of its epicycle, closest to Earth, it moves backward faster than the epicycle's center moves forward. For a few weeks it drifts <b>west</b>: ${key('#ff5470')}<b>retrograde motion</b>.</p>
      ${sup
        ? `<p>For ${n} the epicycle arm always points the same way as the Earth–Sun line, so retrograde always happens when ${n} is opposite the Sun in the sky (<b>opposition</b>), and it is also when ${n} looks brightest.</p>`
        : `<p>For ${n} the epicycle's center always lies on the Earth–Sun line. That is why ${n} never strays far from the Sun, and why it goes retrograde as it passes between us and the Sun.</p>`}
      <p>Ptolemy (about 150 CE) also moved Earth a little off the deferent's center and made the epicycle's center sweep out equal angles in equal times as seen from a third point, the <b>equant</b>. Turn it on to see it.</p>`;
  } else {
    html = `
      <p>Same sky, different explanation. Here the Sun is at the center and Earth and ${n} both orbit it.</p>
      ${sup
        ? `<p>Earth is on the inside track and moves faster. As Earth catches up to ${n} and passes it, the line of sight from Earth to ${n} swings backward for a while, like a slower car seeming to slide backward as you pass it on the highway. That is ${key('#ff5470')}<b>retrograde motion</b>, and nothing about ${n} itself reverses.</p>
           <p>Ptolemy's epicycle is really Earth's own orbit, reflected, and his deferent is ${n}'s orbit. The epicycle size ${P.k.toFixed(3)} is the size of Earth's orbit compared with ${n}'s.</p>`
        : `<p>${n} is on the inside track and moves faster than Earth. When ${n} laps Earth, passing between us and the Sun, the line of sight swings backward for a while: ${key('#ff5470')}<b>retrograde motion</b>.</p>
           <p>Ptolemy's epicycle is really ${n}'s orbit around the Sun, and his deferent is Earth's orbit, reflected. The epicycle size ${P.k.toFixed(3)} is ${n}'s distance from the Sun compared with Earth's.</p>`}
      <p>Turn on <b>Numbered sight lines</b>: the numbers march forward along the zodiac, back up, then forward again.</p>`;
  }
  html += `<p>${key('#7fd1ff')}The blue track on the zodiac band is where ${n} appears among the stars, and the chart plots that position over time.</p>`;
  $('explainBody').innerHTML = html;
}

// ---------- views ----------
const look = { yaw: 0, pitch: 0, targetYaw: 0, fov: 70, auto: true };
const saved3d = { pos: new THREE.Vector3(0, 24, 30), target: new THREE.Vector3() };
function setView(v) {
  if (S.view === '3d') { saved3d.pos.copy(camera.position); saved3d.target.copy(controls.target); }
  S.view = v;
  if (v === 'earth') {
    controls.enabled = false; aimAtPlanet();
  } else {
    controls.enabled = true; camera.fov = 50; camera.updateProjectionMatrix();
    camera.up.set(0, 1, 0);
    if (v === 'top') {
      controls.enableRotate = false;
      camera.position.set(0, 70 / Math.min(1, camAspect() + 0.25), 0.001); controls.target.set(0, 0, 0);
    } else {
      controls.enableRotate = true;
      camera.position.copy(saved3d.pos); controls.target.copy(saved3d.target);
    }
    controls.update();
  }
  syncUI();
}
function camAspect() { return stage.clientWidth / Math.max(1, stage.clientHeight); }
function aimAtPlanet() {
  compute(S.t, tmpA);
  look.yaw = look.targetYaw = tmpA.lon; look.pitch = 0.05; look.auto = true;
}
// drag-to-look in Earth view
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (S.view !== 'earth') return;
  drag = { x: e.clientX, y: e.clientY, yaw: look.yaw, pitch: look.pitch };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag || S.view !== 'earth') return;
  const k = (camera.fov * DEG) / stage.clientHeight;
  look.yaw = drag.yaw + (e.clientX - drag.x) * k;
  look.targetYaw = look.yaw;
  look.pitch = THREE.MathUtils.clamp(drag.pitch + (e.clientY - drag.y) * k, -1.4, 1.4);
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('wheel', (e) => {
  if (S.view !== 'earth') return;
  e.preventDefault();
  look.fov = THREE.MathUtils.clamp(look.fov * Math.exp(e.deltaY * 0.001), 15, 110);
}, { passive: false });
// pinch zoom in Earth view
const pointers = new Map(); let pinch0 = null;
canvas.addEventListener('pointerdown', (e) => { pointers.set(e.pointerId, e); if (pointers.size === 2) { pinch0 = { d: pinchDist(), fov: look.fov }; drag = null; } });
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, e);
  if (pinch0 && pointers.size === 2 && S.view === 'earth') look.fov = THREE.MathUtils.clamp(pinch0.fov * pinch0.d / pinchDist(), 15, 110);
});
const endPtr = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch0 = null; };
canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
function pinchDist() { const [a, b] = [...pointers.values()]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1; }

// ---------- chart ----------
// Shows the last ~half synodic period so each retrograde loop is big enough to see.
const chart = $('chart'), cg = chart.getContext('2d');
let chartLon = new Float64Array(0);
function chartDays() { return Math.max(40, Math.min(S.trailDays, 0.6 * synodicDays(), 2 * YEAR)); }
function drawChart() {
  if (!S.show.chart) return;
  const dpr = Math.min(devicePixelRatio, 2), w = chart.clientWidth, h = chart.clientHeight;
  if (chart.width !== Math.round(w * dpr) || chart.height !== Math.round(h * dpr)) { chart.width = Math.round(w * dpr); chart.height = Math.round(h * dpr); }
  cg.setTransform(dpr, 0, 0, dpr, 0, 0);
  cg.clearRect(0, 0, w, h);
  const L = 40, Rm = 12, T = 24, B = 18, pw = w - L - Rm, ph = h - T - B;
  const span = chartDays(), tStart = Math.max(0, S.t - span), tEnd = tStart + span;
  const X = (d) => L + (d - tStart) / span * pw;

  cg.font = '600 11px system-ui, sans-serif'; cg.textBaseline = 'middle'; cg.textAlign = 'left';
  cg.fillStyle = '#8d97b3';
  cg.fillText(w < 500 ? 'Position on the zodiac' : 'Position on the zodiac (↑ east) over time', L, 11);
  cg.textAlign = 'right';
  cg.fillStyle = '#ff5470'; cg.fillText('■ retrograde', w - Rm, 11);
  cg.fillStyle = '#7fd1ff'; cg.fillText('■ eastward', w - Rm - 92, 11);

  // unwrap longitudes backward from "now" so the line never jumps at 360°
  const n = H.n;
  let s0 = n - 1;
  while (s0 > 0 && H.day[s0 - 1] >= tStart) s0--;
  const cnt = n - s0;
  if (chartLon.length < cnt) chartLon = new Float64Array(cnt * 2);
  let lo = Infinity, hi = -Infinity;
  for (let j = cnt - 1, i = n - 1; j >= 0; j--, i--) {
    chartLon[j] = j === cnt - 1 ? H.lon[i] : chartLon[j + 1] + wrapPi(H.lon[i] - H.lon[i + 1]);
    lo = Math.min(lo, chartLon[j]); hi = Math.max(hi, chartLon[j]);
  }
  if (cnt < 2) { lo = (H.lon[n - 1] || 0) - 0.2; hi = lo + 0.4; }
  const pad = Math.max((hi - lo) * 0.12, 3 * DEG);
  lo -= pad; hi += pad;
  const Y = (a) => T + ph - (a - lo) / (hi - lo) * ph;

  // zodiac sign boundaries
  cg.font = '10px system-ui, sans-serif'; cg.textAlign = 'right';
  const k0 = Math.ceil(lo / (30 * DEG)), k1 = Math.floor(hi / (30 * DEG));
  for (let k = k0 - 1; k <= k1; k++) {
    const yb = Y(k * 30 * DEG);
    if (k >= k0) { cg.strokeStyle = 'rgba(127,141,184,.28)'; cg.beginPath(); cg.moveTo(L, yb); cg.lineTo(L + pw, yb); cg.stroke(); }
    const ym = Y((Math.max(lo, k * 30 * DEG) + Math.min(hi, (k + 1) * 30 * DEG)) / 2);
    if ((k + 1) * 30 * DEG > lo && k * 30 * DEG < hi && ym > T + 4 && ym < T + ph - 4) {
      cg.fillStyle = '#6d7799'; cg.fillText(SIGN_ABBR[((k % 12) + 12) % 12], L - 5, ym);
    }
  }
  // time ticks
  const tickStep = [10, 20, 30, 60, 100, 200, 365.25].find((st) => span / st <= 7) || 365.25;
  cg.textAlign = 'center'; cg.fillStyle = '#6d7799';
  for (let d = Math.ceil(tStart / tickStep) * tickStep; d <= tEnd - span * 0.04; d += tickStep) {
    const x = X(d);
    cg.strokeStyle = 'rgba(127,141,184,.12)'; cg.beginPath(); cg.moveTo(x, T); cg.lineTo(x, T + ph); cg.stroke();
    cg.fillText(`day ${Math.round(d)}`, x, h - 8);
  }
  // data, colored by direction
  if (cnt > 1) {
    cg.lineJoin = 'round'; cg.lineCap = 'round';
    let j = 0;
    while (j < cnt - 1) {
      const r = H.retro[s0 + j];
      cg.strokeStyle = r ? '#ff5470' : '#7fd1ff'; cg.lineWidth = r ? 3 : 2;
      cg.beginPath(); cg.moveTo(X(H.day[s0 + j]), Y(chartLon[j]));
      while (j < cnt - 1) {
        j++; cg.lineTo(X(H.day[s0 + j]), Y(chartLon[j]));
        if (H.retro[s0 + j] !== r) break;
      }
      cg.stroke();
    }
    const li = n - 1;
    cg.fillStyle = H.retro[li] ? '#ff5470' : '#ffffff';
    cg.beginPath(); cg.arc(X(H.day[li]), Y(chartLon[cnt - 1]), 4, 0, TAU); cg.fill();
  }
  cg.strokeStyle = 'rgba(127,141,184,.35)'; cg.strokeRect(L + 0.5, T + 0.5, pw, ph);
}

// ---------- per-frame update ----------
const cur = mkState();
const vE = new THREE.Vector3(), vP = new THREE.Vector3(), vC = new THREE.Vector3(), vS = new THREE.Vector3(), vQ = new THREE.Vector3(), vD = new THREE.Vector3();
const snapState = mkState();

function placeLabel(lbl, pos, lift) {
  lbl.position.copy(pos); lbl.position.y += lift;
  let s = lbl.userData.base;
  const dist = camera.position.distanceTo(lbl.position);
  s *= S.view === 'earth' ? dist * 0.045 * look.fov / 70 : THREE.MathUtils.clamp(dist / 32, 1, 3);
  lbl.scale.set(s * lbl.userData.aspect, s, 1);
}

function updateScene() {
  compute(S.t, cur);
  const ptol = S.mode === 'ptolemy', earthView = S.view === 'earth', sup = P.kind === 'superior';
  W(cur.earth, vE); W(cur.planet, vP); W(cur.center, vC); W(cur.sun, vS); W(cur.equant, vQ);
  earth.position.copy(vE); planet.position.copy(vP); sun.position.copy(vS);
  earth.rotation.y = S.t / 1 * TAU * 0.02;
  sunLight.position.copy(vS);
  earth.visible = !earthView;
  if (earthView) {
    const ang = Math.tan(0.9 * DEG) * look.fov / 70;
    planet.scale.setScalar(vP.distanceTo(vE) * ang / 0.42);
    sun.scale.setScalar(vS.distanceTo(vE) * ang * 1.6 / 0.9);
  } else { planet.scale.setScalar(bodyScale.planet); sun.scale.setScalar(bodyScale.sun); }
  sun.visible = S.show.sun || !ptol;

  // Ptolemy geometry
  ringDef.visible = ptol && !earthView;
  ringEpi.visible = ptol && !earthView;
  ringEpi.position.copy(vC);
  ringSun.visible = ptol && S.show.sun && !earthView;
  epiCenterDot.visible = ptol && !earthView; epiCenterDot.position.copy(vC);
  const eq = ptol && P.equant;
  equantDot.visible = eq && !earthView; equantDot.position.copy(vQ);
  centerDot.visible = eq && !earthView;
  armDef.visible = ptol && S.show.arms && !earthView;
  armEpi.visible = ptol && S.show.arms && !earthView;
  armEq.visible = eq && S.show.arms && !earthView;
  setLine(armDef, vE, vC); setLine(armEpi, vC, vP); setLine(armEq, vQ, vC);

  // Copernican geometry
  ringEarthOrbit.visible = !ptol && !earthView;
  ringPlanetOrbit.visible = !ptol && !earthView;
  armSunEarth.visible = armSunPlanet.visible = !ptol && S.show.arms && !earthView;
  setLine(armSunEarth, vS, vE); setLine(armSunPlanet, vS, vP);

  // sky around the observer
  sky.position.copy(vE);
  W(cur.G, vD).normalize();
  sight.visible = S.show.sight && !earthView;
  setLine(sight, vE, vD.clone().multiplyScalar(SKY_R).add(vE));
  skyTrack.visible = S.show.sky;
  skyMarker.position.copy(vD).multiplyScalar(SKY_R);
  const rate = lonRate(S.t), retro = rate < 0, stationary = Math.abs(rate) < STATION;
  skyMarker.material.color.set(retro ? '#ff5470' : '#7fd1ff');
  skyMarkerGlow.material.color.set(retro ? '#ff5470' : '#7fd1ff');
  sunSkyMarker.visible = S.show.sun || !ptol;
  W({ x: cur.sun.x - cur.earth.x, y: cur.sun.y - cur.earth.y, h: 0 }, sunSkyMarker.position).normalize().multiplyScalar(SKY_R);

  trail.visible = S.show.trail && !earthView;
  const s0 = windowStart();
  trail.geometry.setDrawRange(s0, H.n - s0);
  skyTrack.geometry.setDrawRange(s0, H.n - s0);

  // labels
  const L = S.show.labels;
  lblEarth.visible = L && !earthView; placeLabel(lblEarth, vE, 0.7 * earth.scale.x);
  lblSun.visible = L && sun.visible; placeLabel(lblSun, vS, 1.0 * sun.scale.x);
  lblPlanet.visible = L; placeLabel(lblPlanet, vP, 0.55 * planet.scale.x);
  lblDef.visible = L && ringDef.visible;
  { const a = P.ld0 + P.wd * S.t + Math.PI * 0.75; const p = { x: 0, y: 0, h: 0 };
    if (sup) tilt(D * Math.cos(a), D * Math.sin(a), p); else set(p, D * Math.cos(a), D * Math.sin(a), 0);
    placeLabel(lblDef, W(p, new THREE.Vector3()), 0.15); }
  lblEpi.visible = L && ringEpi.visible && P.k > 0.25;
  placeLabel(lblEpi, vC, P.k * D + 0.2);
  lblEq.visible = L && equantDot.visible; placeLabel(lblEq, vQ, 0.4);
  lblDefC.visible = L && centerDot.visible; placeLabel(lblDefC, new THREE.Vector3(), 0.25);
  for (const c of sky.children) if (c.userData.zodiac) c.visible = L || earthView;

  // numbered sight lines
  updateSnaps(earthView);

  // HUD
  $('hudDay').textContent = `${Math.floor(S.t)}  (year ${Math.floor(S.t / YEAR) + 1})`;
  const lonDeg = cur.lon / DEG, sign = Math.floor(lonDeg / 30) % 12;
  $('hudPos').textContent = `${Math.floor(lonDeg - sign * 30)}° ${SIGNS[sign]}`;
  const el = wrapPi(cur.lon - cur.sunLon) / DEG;
  $('hudElong').textContent = `${Math.round(Math.abs(el))}° ${el >= 0 ? 'east' : 'west'}`;
  const badge = $('badge'), bstate = stationary ? 's' : retro ? 'r' : 'p';
  if (badge.dataset.s !== bstate) { badge.dataset.s = bstate;
  if (stationary) { badge.className = 'badge station'; badge.textContent = 'Stationary (turning around)'; }
  else if (retro) { badge.className = 'badge retro'; badge.textContent = 'RETROGRADE: moving westward'; }
  else { badge.className = 'badge pro'; badge.textContent = 'Moving eastward (prograde)'; } }
  let ev = '';
  if (sup && Math.abs(el) > 172) ev = 'Opposition: opposite the Sun in the sky';
  else if (!sup && Math.abs(el) < 6 && retro) ev = 'Inferior conjunction: passing between Earth and Sun';
  else if (!sup && Math.abs(el) < 6) ev = 'Superior conjunction: behind the Sun';
  else if (Math.abs(el) < 6) ev = 'Conjunction: behind the Sun';
  $('event').textContent = ev;
  return cur;
}

function updateSnaps(earthView) {
  const on = S.show.snaps;
  snapGroup.visible = on;
  if (!on) return;
  const interval = Math.max(3, Math.round(synodicDays() / 24));
  const lastN = Math.floor(S.t / interval);
  for (let j = 0; j < SNAP_COUNT; j++) {
    const s = snaps[j], k = lastN - (SNAP_COUNT - 1 - j);
    const vis = k >= 0;
    for (const o of [s.line, s.pDot, s.eDot, s.num, s.pNum]) o.visible = vis;
    if (!vis) continue;
    compute(k * interval, snapState);
    const e = W(snapState.earth, new THREE.Vector3()), p = W(snapState.planet, new THREE.Vector3());
    const dir = p.clone().sub(e).normalize();
    // extend the sight line to the current zodiac band (sphere around the current observer)
    const oc = e.clone().sub(vE), b = oc.dot(dir), c = oc.lengthSq() - SKY_R * SKY_R;
    const tt = -b + Math.sqrt(Math.max(0, b * b - c));
    const end = e.clone().addScaledVector(dir, tt);
    setLine(s.line, e, end);
    s.line.visible = !earthView;
    s.pDot.position.copy(p); s.eDot.position.copy(e);
    s.eDot.visible = S.mode === 'copernicus' && !earthView;
    s.num.position.copy(end);
    s.pNum.position.copy(p); s.pNum.visible = !earthView;
    if (s.n !== k) { s.n = k; s.num.material.map = numberTexture(k + 1); s.pNum.material.map = s.num.material.map; s.num.material.needsUpdate = s.pNum.material.needsUpdate = true; }
    const op = 0.35 + 0.65 * (j + 1) / SNAP_COUNT;
    s.line.material.opacity = 0.5 * op; s.num.material.opacity = op;
    const ns = earthView ? 2.2 : 1.6; s.num.scale.set(ns, ns, 1);
  }
}

function updateCamera(dt) {
  if (S.view !== 'earth') { controls.update(); return; }
  const aspect = camAspect();
  camera.fov = look.fov;
  const hfov = 2 * Math.atan(Math.tan(look.fov * DEG / 2) * aspect);
  // keep the planet in view: re-center ahead of it when it nears the edge
  if (!drag && look.auto) {
    const diff = wrapPi(cur.lon - look.yaw);
    if (Math.abs(diff) > 0.36 * hfov) look.targetYaw = cur.lon + Math.sign(diff) * 0.22 * hfov;
  }
  look.yaw += wrapPi(look.targetYaw - look.yaw) * Math.min(1, dt * 2.5);
  camera.position.copy(earth.position);
  const cp = Math.cos(look.pitch);
  vD.set(cp * Math.cos(look.yaw), Math.sin(look.pitch), -cp * Math.sin(look.yaw)).add(camera.position);
  camera.up.set(0, 1, 0);
  camera.lookAt(vD);
  camera.updateProjectionMatrix();
}

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

// ---------- loop ----------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  if (S.playing) S.t += dt * S.speed;
  advanceHistory();
  updateScene();
  updateCamera(dt);
  renderer.render(scene, camera);
  drawChart();
  requestAnimationFrame(frame);
}

// ---------- start ----------
P.equant = false;
loadPreset('mars');
applyColors(); buildRings();
const params = new URLSearchParams(location.search);
if (PRESETS[params.get('planet')]) selectPlanet(params.get('planet'));
if (params.get('mode') === 'copernicus') S.mode = 'copernicus';
rebuildHistory(); syncUI(); resize();
if (params.get('t')) { S.t = +params.get('t'); rebuildHistory(); }
if (['top', 'earth'].includes(params.get('view'))) setView(params.get('view'));
if (params.get('paused')) { S.playing = false; syncUI(); }
requestAnimationFrame(frame);

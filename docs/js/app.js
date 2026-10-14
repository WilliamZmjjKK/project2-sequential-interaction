(() => {
'use strict';

/* ---- tuning ---------------------------------------------------------- */
const CFG = {
  TARGET_FRAC_W: 0.70,  // required stretch distance = 70% of the screen width
  REST_FRAC_H: 0.10     // resting thread length = 10% of the screen height
};

/* ---- geometry + palette from feathery-3-plumage.svg ------------------ */
const FW = 112, FH = 152, DX = 84, DY = 54, PAD = 4;
const SHAPE = `M${-0.3 * FW},0C${-0.5 * FW},${0.2 * FH} ${-0.42 * FW},${FH} 0,${FH}C${0.42 * FW},${FH} ${0.5 * FW},${0.2 * FH} ${0.3 * FW},0Z`;
const STOPS = [[0, [18, 26, 54]], [.26, [26, 82, 108]], [.48, [44, 150, 140]], [.68, [226, 178, 74]], [.86, [240, 218, 170]], [1, [247, 240, 226]]];
const INK = '247,240,226';
const FONT = '"Avenir Next","Segoe UI",system-ui,-apple-system,"Helvetica Neue",sans-serif';
// D major pentatonic, D4..D6
const SCALE = [293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25, 739.99, 880, 987.77, 1174.66];

const stage = document.getElementById('stage');
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const cap = document.getElementById('cap');
const capText = document.getElementById('capText');
const dot1 = document.getElementById('dot1');
const dot2 = document.getElementById('dot2');
const dot3 = document.getElementById('dot3');
const replay = document.getElementById('replay');
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.35 : 1;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const ink = a => `rgba(${INK},${a})`;
const smooth = v => v * v * (3 - 2 * v);

function rng(seed) {
  return () => {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function color(t) {
  t = clamp(t, 0, 1);
  for (let i = 1; i < STOPS.length; i++) {
    const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
    if (t <= b) {
      const f = (t - a) / (b - a);
      return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * f)).join(',')})`;
    }
  }
  return 'rgb(247,240,226)';
}
function halfWidth(yq) {
  let best = 0;
  for (let i = 0; i <= 200; i++) {
    const q = i / 200, a = (1 - q) ** 3, b = 3 * (1 - q) ** 2 * q, c = 3 * (1 - q) * q * q, d = q ** 3;
    const yy = b * 0.2 * FH + c * FH + d * FH;
    if (Math.abs(yy - yq) < 1.2) best = Math.max(best, a * 0.3 * FW + b * 0.5 * FW + c * 0.42 * FW);
  }
  return best;
}

/* ---- scene ----------------------------------------------------------- */
let W = 0, H = 0, dpr = 1, s = 1;
let feathers = [], threads = [], specks = [];
let sprite = null;
const featherPath = new Path2D(SHAPE);
let target = 0, restLen = 0, yT = 0;

// 'rest' → 'pull' → 'bloom' → 'float'
let state = 'rest';
let down = false, pid = null;
let fx = 0, fy = 0, gx = 0, startY = 0, gain = 1;
let pull = 0, prog = 0, solid = 0, floatAmt = 0, threadA = 1;
let hintA = 0, hintHold = 0, bloomT = 0, ringT = -9, ringX = 0, rowsHeard = 0;
let swish = 0, stroke = null, heard = 0, last = performance.now();
let nudgeT = -9, nudgeNext = 0;                   // gentle ripple that hints the feathers can be stroked

function buildSprite() {
  const k = s * dpr;
  sprite = document.createElement('canvas');
  sprite.width = Math.ceil((FW + 2 * PAD) * k);
  sprite.height = Math.ceil((FH + 2 * PAD) * k);
  const c = sprite.getContext('2d');
  c.setTransform(k, 0, 0, k, (FW / 2 + PAD) * k, PAD * k);
  const g = c.createLinearGradient(0, 0, 0, FH);
  g.addColorStop(0, 'rgba(15,23,48,.42)');
  g.addColorStop(.6, 'rgba(15,23,48,0)');
  g.addColorStop(1, 'rgba(255,255,255,.24)');
  c.fillStyle = g; c.fill(featherPath);
  c.strokeStyle = 'rgba(255,255,255,.28)'; c.lineWidth = 1; c.stroke(featherPath);
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(255,255,255,.42)'; c.lineWidth = 1.3;
  c.beginPath(); c.moveTo(0, 26); c.lineTo(0, FH - 9); c.stroke();
  c.strokeStyle = 'rgba(255,255,255,.22)'; c.lineWidth = .6;
  c.beginPath();
  for (let y0 = 40; y0 < 128; y0 += 6) {
    const ye = y0 + 20, ex = .84 * halfWidth(ye);
    for (const sg of [1, -1]) { c.moveTo(0, y0); c.quadraticCurveTo(sg * ex * .45, y0 + 3, sg * ex, ye); }
  }
  c.stroke();
}

function layout() {
  const r = stage.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return;
  W = r.width; H = r.height;
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  s = clamp(W / 600, .6, 1.15);
  restLen = CFG.REST_FRAC_H * H;
  target = Math.min(CFG.TARGET_FRAC_W * W, H * .68);
  yT = restLen + target;

  const rand = rng(23), Wu = W / s, Hu = H / s;
  const rows = Math.ceil((Hu + 20) / DY) + 1, cols = Math.ceil(Wu / DX) + 1;
  const kmin = -2, kmax = 2 * cols + 1;
  const open = state === 'float' || state === 'bloom';
  threads = [];
  for (let k = kmin; k <= kmax; k++) {
    const rest = restLen * (.88 + .24 * rand());
    threads.push({ x: k * DX / 2 * s, rest, len: open ? H + 60 : rest, ph: rand() * 6.283, delay: 0 });
  }
  feathers = [];
  for (let r2 = rows; r2 >= -3; r2--) {          // lower rows first, so upper rows overlap them
    const odd = r2 & 1;
    for (let c = -1; c <= cols; c++) {
      const xu = c * DX + (odd ? DX / 2 : 0) + (rand() * 6 - 3);
      const yu = r2 * DY - 20 + (rand() * 6 - 3);
      const t = (yu + 150) / (Hu + 80) + .07 * Math.sin(xu / 120 + r2 * .4) + (rand() * .07 - .035);
      feathers.push({
        x: xu * s, y: yu * s, rot: (rand() * 10 - 5) * Math.PI / 180, col: color(t),
        th: 2 * c + odd - kmin, ph: rand() * 6.283, a: 0, va: 0, e: 0
      });
    }
  }
  buildSprite();
}

/* ---- sound ----------------------------------------------------------- */
let AC = null, master, wet, noiseBuf, noiseGain, noiseFilter;
const pending = [];
function audio() {
  if (AC) { if (AC.state !== 'running') AC.resume().catch(() => {}); return; }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    AC = new Ctx();
    master = AC.createGain(); master.gain.value = .6;
    const comp = AC.createDynamicsCompressor();
    master.connect(comp); comp.connect(AC.destination);
    const delay = AC.createDelay(1); delay.delayTime.value = .27;
    const fb = AC.createGain(); fb.gain.value = .36;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    wet = AC.createGain(); wet.gain.value = .34;
    wet.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(master);
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = AC.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    noiseFilter = AC.createBiquadFilter(); noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = 1200; noiseFilter.Q.value = .7;
    noiseGain = AC.createGain(); noiseGain.gain.value = 0;
    src.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(master); src.start();
    AC.onstatechange = () => { if (AC.state === 'running') while (pending.length) pending.shift()(); };
    if (AC.state !== 'running') AC.resume().catch(() => {});
  } catch (e) { AC = null; }
}
function voice(freq, delay, vel, dur) {
  const t = AC.currentTime + delay + .005;
  const g = AC.createGain();
  g.gain.setValueAtTime(.0001, t);
  g.gain.linearRampToValueAtTime(.2 * vel, t + .016);
  g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  g.connect(master); g.connect(wet);
  [['sine', 1, 1], ['sine', 2.005, .14], ['triangle', .5, .1]].forEach(([type, mul, lvl]) => {
    const o = AC.createOscillator(); o.type = type; o.frequency.value = freq * mul;
    const og = AC.createGain(); og.gain.value = lvl;
    o.connect(og); og.connect(g); o.start(t); o.stop(t + dur + .05);
  });
  const b = AC.createBufferSource(); b.buffer = noiseBuf;      // a breath of air on the attack
  const hp = AC.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4200;
  const bg = AC.createGain();
  bg.gain.setValueAtTime(.03 * vel, t); bg.gain.exponentialRampToValueAtTime(.0001, t + .08);
  b.connect(hp); hp.connect(bg); bg.connect(master); b.start(t, Math.random() * 1.5, .1);
}
function note(freq, delay = 0, vel = 1, dur = 1.5, keep = false) {
  if (!AC) return;
  if (AC.state === 'running') voice(freq, delay, vel, dur);
  else if (keep) { pending.push(() => voice(freq, delay, vel, dur)); AC.resume().catch(() => {}); }
}
function chime() {
  [[587.33, 0], [880, .09], [1174.66, .18], [1479.98, .3]].forEach(([f, d]) => note(f, d, .85, 2.2, true));
  note(293.66, 0, .5, 2.8, true);
  try { if (navigator.vibrate) navigator.vibrate([10, 40, 18]); } catch (e) {}
}

/* ---- transitions ----------------------------------------------------- */
function caption(text) { if (capText.textContent !== text) capText.textContent = text; }
function succeed() {
  state = 'bloom'; bloomT = performance.now(); ringT = bloomT; ringX = gx;
  for (const th of threads) th.delay = Math.abs(th.x - gx) / W * .35;
  for (let i = 0; i < 30; i++) specks.push({
    x: W * (.12 + .76 * Math.random()), y: yT + (Math.random() * 16 - 8),
    vx: Math.random() * 30 - 15, vy: -(14 + Math.random() * 38), life: 0, max: 1.4 + Math.random() * 1.4, r: .7 + Math.random() * 1.3
  });
  chime();
  dot2.className = 'done'; dot3.className = 'on';
  caption('Stroke the feathers'); replay.hidden = false; heard = 0;
  nudgeNext = performance.now() + 2600;
}
function reset() {
  state = 'rest'; down = false; pull = 0; prog = 0; stroke = null; rowsHeard = 0;
  for (const f of feathers) { f.a = 0; f.va = 0; f.e = 0; }
  dot1.className = 'on'; dot2.className = ''; dot3.className = ''; nudgeNext = 0; nudgeT = -9; heard = 0;
  cap.classList.remove('quiet'); caption('Touch the screen'); replay.hidden = true;
}

function excite(x, y, vx, vy) {
  const R = FH * s * .85, cy = FH * s * .5;
  for (const f of feathers) {
    const dx = f.x - x, dy = f.y + cy - y, d2 = dx * dx + dy * dy;
    if (d2 > R * R) continue;
    const fall = (1 - Math.sqrt(d2) / R) ** 2;
    f.va += (clamp(vx, -1400, 1400) * .0022 + (Math.random() - .5) * (.5 + Math.abs(vy) * .0012)) * fall;
    if (fall > f.e) f.e = fall;
  }
  if (Math.random() < .3 && specks.length < 70) specks.push({
    x: x + (Math.random() * 30 - 15), y: y - 10, vx: vx * .03 + (Math.random() * 16 - 8), vy: -(12 + Math.random() * 24),
    life: 0, max: 1 + Math.random(), r: .6 + Math.random()
  });
}
const pitchAt = (x, y) => clamp(Math.round(y / H * 8 + x / W * 2), 0, SCALE.length - 1);

/* ---- touch ----------------------------------------------------------- */
function local(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

cv.addEventListener('pointerdown', e => {
  if (down) return;
  audio();
  down = true; pid = e.pointerId;
  try { cv.setPointerCapture(pid); } catch (err) {}
  [fx, fy] = local(e);
  if (state === 'rest') {
    state = 'pull'; startY = fy; gx = fx; pull = 0; prog = 0; rowsHeard = 0;
    gain = clamp(target / Math.max(40, H - startY - 28), 1, 3);
    dot1.className = 'done'; dot2.className = 'on';
    caption('Drag down');
  } else if (state === 'float') {
    stroke = { x: fx, y: fy, t: performance.now(), travel: 0, noteT: 0, count: 0, idx: -1 };
    excite(fx, fy, 0, 300);
    const i = pitchAt(fx, fy);
    note(SCALE[i], 0, .7, 1.6); stroke.idx = i; stroke.count = 1; stroke.noteT = stroke.t;
  }
  e.preventDefault();
});

cv.addEventListener('pointermove', e => {
  if (!down || e.pointerId !== pid) return;
  const [x, y] = local(e), now = performance.now();
  const dist = Math.hypot(x - fx, y - fy);
  if (state === 'pull') {
    swish = Math.max(swish, clamp(dist * 60 / 1500, 0, 1));
    fx = x; fy = y;
    pull = clamp((fy - startY) * gain, 0, target * 1.1);
    prog = pull / target;
    const rowsNow = Math.floor(pull / (DY * s));
    if (rowsNow > rowsHeard) { note(SCALE[Math.min(9, rowsNow)], 0, .26, .5); rowsHeard = rowsNow; }
    if (prog >= 1) succeed();
  } else if (state === 'float' && stroke) {
    const dt = Math.max(8, now - stroke.t) / 1000;
    const vx = (x - stroke.x) / dt, vy = (y - stroke.y) / dt;
    excite(x, y, vx, vy);
    swish = Math.max(swish, clamp(dist * 60 / 1800, 0, .7));
    stroke.travel += dist;
    if (stroke.travel >= 30 && now - stroke.noteT >= 90) {
      const i = pitchAt(x, y);
      if (i !== stroke.idx || stroke.travel >= 72) {
        note(SCALE[i], 0, .5 + .4 * clamp(Math.hypot(vx, vy) / 1500, 0, 1), 1.5);
        stroke.idx = i; stroke.count++; stroke.noteT = now; stroke.travel = 0;
        if (++heard >= 4) cap.classList.add('quiet');
      }
    }
    stroke.x = x; stroke.y = y; stroke.t = now; fx = x; fy = y;
  }
});

function release(e) {
  if (!down || (e && e.pointerId !== pid)) return;
  down = false;
  audio();
  if (state === 'pull') {
    state = 'rest'; pull = 0; prog = 0;
    hintHold = performance.now() + 1700;
    caption('Drag down');
  } else if (state === 'float' && stroke) {
    if (stroke.count >= 2) {                      // close the phrase on a resting tone
      const homes = [0, 5, 10].sort((a, b) => Math.abs(a - stroke.idx) - Math.abs(b - stroke.idx));
      const end = homes[0] === stroke.idx ? (stroke.idx >= 5 ? 8 : 3) : homes[0];
      note(SCALE[end], .13, .55, 2.3);
    }
    stroke = null;
  }
}
cv.addEventListener('pointerup', release);
cv.addEventListener('pointercancel', release);
cv.addEventListener('contextmenu', e => e.preventDefault());
replay.addEventListener('click', () => { audio(); reset(); });

/* ---- drawing --------------------------------------------------------- */
function chevron(x, y, sz) { ctx.moveTo(x - sz, y - sz * .5); ctx.lineTo(x, y + sz * .5); ctx.lineTo(x + sz, y - sz * .5); }

function frame(now) {
  requestAnimationFrame(frame);
  if (!W) return;
  const t = now / 1000, dt = Math.min(.05, Math.max(.001, (now - last) / 1000));
  last = now;
  const open = state === 'bloom' || state === 'float';
  const tb = (now - bloomT) / 1000;
  if (state === 'bloom' && tb > 1.35) state = 'float';
  if (state === 'pull') gx += (fx - gx) * (1 - Math.exp(-dt * 14));

  // threads
  const sig = W * .33;
  for (const th of threads) {
    let goal = th.rest, rate = 6;
    if (open) { goal = H + 60; rate = state === 'bloom' && tb < th.delay ? 0 : 5; }
    else if (state === 'pull') { const d = (th.x - gx) / sig; goal = th.rest + pull * (.62 + .38 * Math.exp(-d * d)); rate = 20; }
    th.len += (goal - th.len) * (1 - Math.exp(-dt * rate));
  }
  const solidGoal = open ? 1 : state === 'pull' ? Math.pow(clamp(prog, 0, 1), 1.2) * .8 : 0;
  solid += (solidGoal - solid) * (1 - Math.exp(-dt * 7));
  floatAmt += ((open ? 1 : .4) - floatAmt) * (1 - Math.exp(-dt * 2));
  threadA += ((state === 'float' ? 0 : 1) - threadA) * (1 - Math.exp(-dt * 1.6));

  // shimmer that sweeps down as the plumage opens
  if (state === 'bloom') {
    const yb = yT + (H + 120 - yT) * smooth(clamp(tb / 1.1, 0, 1));
    for (const f of feathers) {
      const d = Math.abs(f.y + FH * s * .5 - yb);
      if (d < 110) { const k = 1 - d / 110; if (k > f.e) { f.e = k; f.va += (Math.random() - .5) * .6 * k; } }
    }
  }

  // a slight ripple, repeated until the first stroke, shows the feathers can now be stroked
  if (state === 'float' && heard === 0 && !down) {
    if (nudgeNext && now > nudgeNext) { nudgeT = now; nudgeNext = now + 3800; }
    const tn = (now - nudgeT) / 1000;
    if (tn >= 0 && tn < 1.6) {
      const yb = H * (.15 + .7 * smooth(clamp(tn / 1.4, 0, 1)));
      for (const f of feathers) {
        const d = Math.abs(f.y + FH * s * .5 - yb);
        if (d < 90) { const k = (1 - d / 90) * .55; if (k > f.e) { f.e = k; f.va += Math.sin(f.ph + t * 6) * .18 * k; } }
      }
    }
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0f1730';
  ctx.fillRect(0, 0, W, H);

  // feathers
  const grow = .75 * FH * s, k = dpr * s;
  const sx0 = -(FW / 2 + PAD), sw = FW + 2 * PAD, sh = FH + 2 * PAD;
  for (const f of feathers) {
    f.va += (-70 * f.a - 4.5 * f.va) * dt;
    f.a = clamp(f.a + f.va * dt, -.4, .4);
    f.e *= Math.exp(-dt * 2.2);
    const th = threads[f.th];
    const v = th ? clamp((th.len - f.y) / grow, 0, 1) : 1;
    if (v <= .01) continue;
    const ev = smooth(v), alpha = ev * (.3 + .7 * solid);
    const wave = (.045 * Math.sin(t * 1.1 - f.y * .012 / s + f.x * .006 / s + f.ph * .3) + .02 * Math.sin(t * .37 + f.x * .01 / s)) * floatAmt * calm;
    const ang = f.rot * ev + wave + f.a;
    const lift = 1 + .06 * f.e;
    const sx = (.25 + .75 * ev) * lift, sy = (.35 + .65 * ev) * lift;
    const co = Math.cos(ang), si = Math.sin(ang);
    const oy = Math.sin(t * .9 + f.ph) * 1.2 * floatAmt * calm;
    ctx.setTransform(k * co * sx, k * si * sx, -k * si * sy, k * co * sy, dpr * f.x, dpr * (f.y + oy));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = f.col;
    ctx.fill(featherPath);
    ctx.drawImage(sprite, sx0, -PAD, sw, sh);
    const glow = alpha * f.e * .44 + ev * (1 - solid) * .1;      // ghostly while unpulled, bright when stroked
    if (glow > .01) { ctx.globalAlpha = glow; ctx.fillStyle = '#f7f0e2'; ctx.fill(featherPath); }
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;

  // threads + beads
  if (threadA > .02) {
    ctx.lineWidth = 1; ctx.lineCap = 'round';
    ctx.strokeStyle = ink(.62 * threadA);
    ctx.beginPath();
    for (const th of threads) {
      const sw2 = Math.sin(t * .9 + th.ph) * 1.6 * calm;
      ctx.moveTo(th.x, -4); ctx.quadraticCurveTo(th.x + sw2 * .3, th.len * .5, th.x + sw2, th.len);
    }
    ctx.stroke();
    const pulse = state === 'rest' ? .6 + .4 * Math.sin(t * 2.2) : 1;
    ctx.fillStyle = ink(.95 * threadA * pulse);
    ctx.beginPath();
    for (const th of threads) {
      const sw2 = Math.sin(t * .9 + th.ph) * 1.6 * calm;
      ctx.moveTo(th.x + sw2 + 1.9, th.len); ctx.arc(th.x + sw2, th.len, 1.9, 0, 6.283);
    }
    ctx.fill();
  }

  // hint + distance indicator (step 1)
  const showHint = (state === 'pull') || (state === 'rest' && now < hintHold);
  hintA += ((showHint ? 1 : 0) - hintA) * (1 - Math.exp(-dt * (showHint ? 12 : 4)));
  if (hintA > .01) {
    const a = hintA, p = clamp(prog, 0, 1), x0 = W * .15, x1 = W * .85;   // line spans 70% of the width
    ctx.lineWidth = 1;
    ctx.strokeStyle = ink(.62 * a);
    ctx.setLineDash([2, 6]);
    ctx.beginPath(); ctx.moveTo(x0, yT); ctx.lineTo(x1, yT); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x0, yT - 5); ctx.lineTo(x0, yT + 5); ctx.moveTo(x1, yT - 5); ctx.lineTo(x1, yT + 5); ctx.stroke();
    ctx.font = `400 10px ${FONT}`;
    try { ctx.letterSpacing = '1.2px'; } catch (e) {}
    ctx.fillStyle = ink(.78 * a);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left'; ctx.fillText('PULL TO HERE', x0, yT + 10);
    ctx.textAlign = 'right'; ctx.fillText(Math.round(p * 100) + '%', x1, yT + 10);

    const tipY = restLen + pull;
    if (yT - tipY > 4) {                           // the remaining distance, as a dotted guide
      ctx.strokeStyle = ink(.5 * a);
      ctx.setLineDash([1, 5]);
      ctx.beginPath(); ctx.moveTo(gx, tipY + 6); ctx.lineTo(gx, yT - 8); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = ink(.9 * a);
    ctx.beginPath(); ctx.arc(gx, yT, 7, 0, 6.283); ctx.stroke();
    ctx.fillStyle = ink(.9 * a);
    ctx.beginPath(); ctx.arc(gx, yT, 6 * p, 0, 6.283); ctx.fill();

    const ca = a * clamp(1 - p * 1.5, 0, 1);       // "drag down" chevrons: on the guide and beside the finger
    if (ca > .01) {
      const flow = (t * 1.1) % 1;
      ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
      const span = yT - 16 - (tipY + 16);
      if (span > 36) for (let i = 0; i < 3; i++) {
        const u = (i + flow) / 3;
        ctx.strokeStyle = ink(ca * Math.sin(u * Math.PI) * .9);
        ctx.beginPath(); chevron(gx, tipY + 16 + u * span, 6); ctx.stroke();
      }
      if (down) for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
        const u = (i + flow) / 3;
        ctx.strokeStyle = ink(ca * Math.sin(u * Math.PI) * .9);
        ctx.beginPath(); chevron(fx + side * 46, fy - 14 + u * 54, 6); ctx.stroke();
      }
    }
    if (down) {
      ctx.lineWidth = 1; ctx.strokeStyle = ink(.4 * a);
      ctx.beginPath(); ctx.arc(fx, fy, 27, 0, 6.283); ctx.stroke();
    }
  }

  // confirmation: the target line snaps solid and a ring opens from it
  const ru = (now - ringT) / 900;
  if (ru >= 0 && ru < 1) {
    const e = 1 - (1 - ru) ** 3;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ink((1 - ru) * .85);
    ctx.beginPath(); ctx.moveTo(W * .15 * (1 - e), yT); ctx.lineTo(W - W * .15 * (1 - e), yT); ctx.stroke();
    ctx.beginPath(); ctx.arc(ringX, yT, 7 + e * W * .75, 0, 6.283); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = ink((1 - ru) * .4);
    ctx.beginPath(); ctx.arc(ringX, yT, 7 + e * W * .45, 0, 6.283); ctx.stroke();
  }

  // drifting down
  if (specks.length) {
    for (let i = specks.length - 1; i >= 0; i--) {
      const q = specks[i];
      q.life += dt;
      if (q.life > q.max) { specks.splice(i, 1); continue; }
      q.vy *= Math.exp(-dt * .8); q.x += (q.vx + Math.sin(t * 3 + i) * 10) * dt; q.y += q.vy * dt;
      ctx.fillStyle = ink(.8 * Math.sin(q.life / q.max * Math.PI));
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 6.283); ctx.fill();
    }
  }

  // silk / brushing noise follows the finger's speed
  swish *= Math.exp(-dt * 9);
  if (AC && noiseGain && AC.state === 'running') {
    noiseGain.gain.setTargetAtTime(swish * (state === 'float' ? .05 : .085), AC.currentTime, .04);
    noiseFilter.frequency.setTargetAtTime(state === 'float' ? 3200 : 800 + 2200 * clamp(prog, 0, 1), AC.currentTime, .08);
  }
}

layout();
if ('ResizeObserver' in window) new ResizeObserver(layout).observe(stage);
else addEventListener('resize', layout);
requestAnimationFrame(frame);
})();

// ============================================================
//  8 BITS BATTLE - Cliente (navegador de cada alumno)
//  Carrera de obstáculos vertical
// ============================================================
const $ = s => document.querySelector(s);
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const SCALE = 2;                       // resolución interna x2 para textos nítidos
const W = canvas.width / SCALE, H = canvas.height / SCALE;
const FONT = '"Press Start 2P", "Courier New", monospace';

// URL pública del servidor WebSocket (Render/Railway/Fly...). Vacío = mismo origen (uso local con INICIAR.bat).
const BACKEND_URL = 'https://eightbits-dj6n.onrender.com';

let ws, myId = null, joined = false;
let worldW = W, groundY = 4000, finishY = 0, rowH = 46, maxPlayers = 20, totalCp = 7;
let platforms = [], platformsById = new Map();
let brokenSet = new Set(), movingPos = new Map();
let prev = null, curr = null, prevT = 0, currT = 0;
let roster = new Map();   // id -> {n, c}; llega aparte, no en cada snapshot
let particles = [];
let shakeUntil = 0;
let muted = false;
let lastListKey = '';
let camY = 0;
let track = 'easy';       // pista de la partida actual: cambia el aspecto del mapa
let myDeath = null;      // 'lava' | 'fell': para el mensaje al quedar eliminado

// ------------------------------------------------------------
//  Sonido 8 bits (WebAudio, sin archivos)
// ------------------------------------------------------------
let actx = null;
function initAudio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; }
  }
  if (actx && actx.state === 'suspended') actx.resume();
}
function beep(freq, dur, { type = 'square', vol = 0.08, slide = 0, delay = 0 } = {}) {
  if (!actx || muted) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const sfx = {
  jump: () => beep(440, 0.06, { vol: 0.05, slide: 220 }),
  cp: () => [660, 880].forEach((f, i) => beep(f, 0.1, { delay: i * 0.07, vol: 0.07 })),
  crack: () => beep(140, 0.12, { type: 'sawtooth', vol: 0.06, slide: -80 }),
  fall: () => beep(300, 0.15, { type: 'triangle', vol: 0.06, slide: -200 }),
  arrow: () => beep(900, 0.08, { type: 'sawtooth', vol: 0.05, slide: -600 }),
  lava: () => [440, 330, 220, 110].forEach((f, i) => beep(f, 0.12, { delay: i * 0.1, vol: 0.06 })),
  finish: () => [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.14, { delay: i * 0.1, vol: 0.08 })),
  count: () => beep(523, 0.12),
  go: () => beep(1046, 0.3),
  win: () => [523, 659, 784, 1046, 784, 1046].forEach((f, i) => beep(f, 0.14, { delay: i * 0.12 })),
  stomp: () => [220, 440].forEach((f, i) => beep(f, 0.08, { delay: i * 0.05, vol: 0.09, slide: 200 })),
  burn: () => beep(200, 0.25, { type: 'sawtooth', vol: 0.07, slide: -150 }),
  fire: () => beep(120, 0.15, { type: 'sawtooth', vol: 0.04, slide: 300 }),
  lose: () => [392, 330, 262, 196].forEach((f, i) => beep(f, 0.2, { delay: i * 0.18, type: 'triangle', vol: 0.1 })),
};

// ------------------------------------------------------------
//  Conexión WebSocket
// ------------------------------------------------------------
function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function connect() {
  // En local (INICIAR.bat) se usa el propio servidor; en la web, el de Render.
  const local = ['localhost', '127.0.0.1', ''].includes(location.hostname);
  const backend = local ? '' : BACKEND_URL;
  const host = backend ? backend.replace(/^https?:\/\//, '') : location.host;
  const proto = (backend ? backend.startsWith('https') : location.protocol === 'https:') ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${host}`);
  ws.onopen = () => { $('#offline').hidden = true; };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') onWelcome(m);
    else if (m.t === 'joined') onJoined(m);
    else if (m.t === 'full') alert('LA SALA ESTÁ LLENA (máx. ' + maxPlayers + ' jugadores)');
    else if (m.t === 'level') onLevel(m);
    else if (m.t === 'roster') roster = new Map(m.list.map(r => [r.id, r]));
    else if (m.t === 's') onState(m);
  };
  ws.onclose = () => {
    $('#offline').hidden = false;
    joined = false;
    setTimeout(connect, 2000);
  };
}

function setLevel(list) {
  platforms = list || [];
  platformsById = new Map(platforms.map(p => [p.id, p]));
  brokenSet = new Set();
  movingPos = new Map(platforms.filter(p => p.type === 'move').map(p => [p.id, p.x]));
}

function onWelcome(m) {
  myId = m.id;
  worldW = m.worldW; groundY = m.groundY; finishY = m.finishY; rowH = m.rowH;
  maxPlayers = m.maxPlayers; totalCp = m.totalCp;
  setLevel(m.level);
  if (m.track) track = m.track;

  showScreen('join');
  let saved = '';
  try { saved = localStorage.getItem('8bits-name') || ''; } catch {}
  $('#nameInput').value = saved;
  $('#nameInput').focus();
  if (saved && sessionStorage.getItem('8bits-auto')) send({ t: 'join', name: saved });
}

function onLevel(m) {
  setLevel(m.platforms);
  track = m.track || 'easy';
  worldW = m.worldW; groundY = m.groundY; finishY = m.finishY; rowH = m.rowH; totalCp = m.totalCp;
}

function onJoined(m) {
  joined = true;
  try {
    localStorage.setItem('8bits-name', m.name);
    sessionStorage.setItem('8bits-auto', '1');
  } catch {}
  showScreen('game');
}

function showScreen(id) {
  $('#join').hidden = id !== 'join';
  $('#game').hidden = id !== 'game';
}

$('#joinForm').addEventListener('submit', e => {
  e.preventDefault();
  initAudio();
  send({ t: 'join', name: $('#nameInput').value.toUpperCase() });
});
$('#btnStart').addEventListener('click', () => { initAudio(); send({ t: 'start' }); });
for (const b of document.querySelectorAll('#trackPick button')) {
  b.addEventListener('click', () => { initAudio(); send({ t: 'vote', v: b.dataset.track }); });
}

const TRACK_NAMES = { easy: 'FÁCIL', hard: 'DIFÍCIL' };
const TRACK_COLORS = { easy: '#00e436', hard: '#ff004d' };

// Cada pista tiene su propio aspecto: FÁCIL es un cielo con nubes, DIFÍCIL un volcán con brasas
const THEMES = {
  easy: {
    sky: t => `rgb(${18 + t * 10},${24 + t * 30},${74 + t * 90})`,
    deco: 'clouds',
    ground: ['#5f574f', '#3a332e'],
    normal: ['#8f7a5a', '#6b5a41'],
  },
  hard: {
    sky: t => `rgb(${40 + t * 30},${6 + t * 6},${14 + t * 10})`,
    deco: 'embers',
    ground: ['#2b1b1b', '#120a0a'],
    normal: ['#4a3f45', '#ff004d'],
  },
};

// ------------------------------------------------------------
//  Estado recibido del servidor
// ------------------------------------------------------------
function me() { return curr && curr.p.find(p => p.id === myId); }
function byId(state, id) { return state && state.p.find(p => p.id === id); }

function onState(s) {
  const oldPhase = curr && curr.ph;
  const oldCd = curr && curr.cd;
  for (const p of s.p) {
    const r = roster.get(p.id);
    p.n = r ? r.n : '';
    p.c = r ? r.c : '#c2c3c7';
  }
  prev = curr; prevT = currT;
  curr = s; currT = performance.now();
  brokenSet = new Set(s.brk);
  for (const [id, x] of s.mv) movingPos.set(id, x);

  if (s.ph === 'countdown' && s.cd !== oldCd) sfx.count();
  if (s.ph === 'playing' && oldPhase === 'countdown') sfx.go();
  if (s.ph === 'countdown') myDeath = null;

  for (const ev of s.e) handleEvent(ev);
  updateHud();
  updateSide();
}

function handleEvent(ev) {
  const p = byId(curr, ev.id);
  if (ev.k === 'cp') {
    if (p) burst(p.x, p.y, '#00e436', 6);
    if (ev.id === myId) sfx.cp();
  }
  if (ev.k === 'break') { burst(ev.x, ev.y, '#ffa300', 10, 2.2); sfx.crack(); }
  if (ev.k === 'spike') {
    if (p) burst(p.x, p.y, '#ff004d', 10);
    if (ev.id === myId) { sfx.fall(); shakeUntil = performance.now() + 200; }
  }
  if (ev.k === 'arrow') {
    if (p) burst(p.x, p.y, '#c2c3c7', 8);
    if (ev.id === myId) { sfx.arrow(); shakeUntil = performance.now() + 200; }
  }
  if (ev.k === 'fell') {
    if (p) burst(p.x, p.y, '#83769c', 14, 2);
    sfx.fall();
    addFeedMsg(`${ev.name} se cayó`);
    if (ev.id === myId) { myDeath = 'fell'; shakeUntil = performance.now() + 300; }
  }
  if (ev.k === 'lava') {
    if (p) burst(p.x, p.y, '#ff004d', 20, 2.5);
    sfx.lava();
    addFeedMsg(`${ev.name} cayó en la lava`);
    if (ev.id === myId) { myDeath = 'lava'; shakeUntil = performance.now() + 300; }
  }
  if (ev.k === 'track') {
    const name = TRACK_NAMES[ev.v];
    addFeedMsg(ev.tie
      ? `Empate ${ev.easy}-${ev.hard}: al azar sale ${name}`
      : `Pista ${name} (${ev.easy} fácil / ${ev.hard} difícil)`);
  }
  // Modo final: quedan 2 y ya nadie puede quedar eliminado
  if (ev.k === 'final') {
    addFeedMsg(`¡Quedan ${ev.names.length}! Nadie más cae: todos al jefe`);
    sfx.cp();
  }
  if (ev.k === 'fall') {
    if (p) burst(p.x, p.y, '#29adff', 10);
    if (ev.id === myId) { sfx.fall(); shakeUntil = performance.now() + 200; }
  }
  // Jefe final
  if (ev.k === 'stomp') {
    const bs = curr.bs;
    if (bs) burst(bs.x, finishY - 24, '#ffec27', 12, 2.2);
    sfx.stomp();
    addFeedMsg(`${ev.name} pisó al jefe (${ev.hits}/${bs ? bs.n : 3})`);
    if (ev.id === myId) shakeUntil = performance.now() + 150;
  }
  if (ev.k === 'burn') {
    if (p) burst(p.x, p.y, '#ffa300', 14, 2.2);
    sfx.burn();
    addFeedMsg(`${ev.name} se quemó con el jefe`);
    if (ev.id === myId) shakeUntil = performance.now() + 250;
  }
  if (ev.k === 'fire') {
    const m = me();
    if (m && m.ig && m.y < finishY + 200) sfx.fire();
  }
  if (ev.k === 'bossdie') {
    burst(ev.x, ev.y, '#ff004d', 30, 3);
    burst(ev.x, ev.y, '#ffec27', 20, 2.5);
    sfx.finish();
    addFeedMsg(`¡${ev.name} derrotó al jefe!`);
    shakeUntil = performance.now() + 400;
  }
  if (ev.k === 'end') {
    const m = me();
    if (joined && m && m.ig) (ev.winner === m.n ? sfx.win : sfx.lose)();
    else sfx.win();
  }
}

function burst(x, y, color, n, speed = 1.8) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = Math.random() * speed + 0.3;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 20 + Math.random() * 15, c: Math.random() < 0.3 ? '#fff' : color });
  }
}

function addFeedMsg(text) {
  const li = document.createElement('li');
  li.textContent = text;
  const feed = $('#feed');
  feed.prepend(li);
  while (feed.children.length > 6) feed.lastChild.remove();
}

function updateHud() {
  const m = me();
  const inGame = m && m.ig;
  $('#hudPct').textContent = inGame ? `${m.pct}%` : '-';
  $('#hudCp').textContent = inGame ? `${m.cp}/${totalCp}` : '-';
  $('#hudStatus').textContent = inGame ? (m.fin ? '¡JEFE DERROTADO!' : (m.al ? '' : 'ELIMINADO')) : '';
}

function updateSide() {
  const ps = [...curr.p].sort((a, b) => (b.fin - a.fin) || (b.al - a.al) || (b.pct - a.pct));
  const key = ps.map(p => `${p.id}|${p.n}|${p.pct}|${p.al}|${p.ig}|${p.fin}|${p.vo}`).join(';') + curr.ph + curr.tr;
  if (key === lastListKey) return;
  lastListKey = key;

  const playing = curr.ph !== 'lobby';
  const racing = curr.p.filter(p => p.ig && p.al && !p.fin).length;
  $('#aliveCount').textContent = playing ? `(${racing} SUBIENDO)` : `(${curr.p.length})`;

  const ul = $('#playerList');
  ul.replaceChildren();
  for (const p of ps) {
    const li = document.createElement('li');
    if (playing && p.ig && !p.al && !p.fin) li.className = 'dead';
    if (p.id === myId) li.classList.add('me');
    const name = document.createElement('span');
    name.className = 'pname';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.c;
    name.append(dot, p.n);
    const info = document.createElement('span');
    info.textContent = !playing ? (TRACK_NAMES[p.vo] || 'SIN VOTO')
      : !p.ig ? 'ESPERA'
      : p.fin ? 'GANÓ' : !p.al ? 'FUERA' : p.bh ? `JEFE ${p.bh}/3` : `${p.pct}%`;
    li.append(name, info);
    ul.appendChild(li);
  }

  // Panel de votación: en la sala marca mi voto y el recuento; en partida, la pista que salió
  const lobby = curr.ph === 'lobby';
  const m = me();
  const noVotes = !curr.vt || curr.vt.easy + curr.vt.hard === 0;
  $('#btnStart').disabled = !lobby || curr.p.length < 1 || noVotes;
  $('#btnStart').textContent = !lobby ? 'PARTIDA EN CURSO'
    : noVotes ? 'VOTA UNA PISTA'
    : curr.p.length === 1 ? 'JUGAR SOLO' : 'EMPEZAR PARTIDA';
  for (const b of document.querySelectorAll('#trackPick button')) {
    const t = b.dataset.track;
    b.classList.toggle('on', lobby ? !!m && m.vo === t : curr.tr === t);
    b.disabled = !lobby;
    b.querySelector('.votes').textContent = lobby && curr.vt ? curr.vt[t] : '';
  }
}

// ------------------------------------------------------------
//  Controles
// ------------------------------------------------------------
const keys = { l: false, r: false, jump: false };
const KEYMAP = {
  KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
  KeyW: 'jump', ArrowUp: 'jump', Space: 'jump',
};
let inputDirty = false;

function typing() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

addEventListener('keydown', e => {
  if (typing()) return;
  initAudio();
  const k = KEYMAP[e.code];
  if (k) {
    e.preventDefault();
    if (!keys[k]) { keys[k] = true; inputDirty = true; if (k === 'jump') sfx.jump(); }
  }
  if (e.code === 'KeyM') muted = !muted;
});
addEventListener('keyup', e => {
  const k = KEYMAP[e.code];
  if (k && keys[k]) { keys[k] = false; inputDirty = true; }
});
addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  inputDirty = true;
});

// Controles táctiles (móvil y tablet): cada botón sigue su propio dedo, así se
// puede mantener ► y pulsar SALTAR a la vez.
const isTouch = matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('is-touch');
addEventListener('touchstart', () => document.body.classList.add('is-touch'), { once: true, passive: true });

for (const b of document.querySelectorAll('#touch button')) {
  const k = b.dataset.key;
  const press = e => {
    e.preventDefault();
    initAudio();
    try { b.setPointerCapture(e.pointerId); } catch {}
    b.classList.add('pressed');
    if (!keys[k]) { keys[k] = true; inputDirty = true; if (k === 'jump') sfx.jump(); }
  };
  const release = e => {
    e.preventDefault();
    b.classList.remove('pressed');
    if (keys[k]) { keys[k] = false; inputDirty = true; }
  };
  b.addEventListener('pointerdown', press);
  b.addEventListener('pointerup', release);
  b.addEventListener('pointercancel', release);
  b.addEventListener('lostpointercapture', release);
  b.addEventListener('contextmenu', e => e.preventDefault());
}

// Enviar teclas como mucho 20 veces por segundo
setInterval(() => {
  if (joined && inputDirty) {
    send({ t: 'in', ...keys });
    inputDirty = false;
  }
}, 50);

// ------------------------------------------------------------
//  Dibujo
// ------------------------------------------------------------
function text(str, x, y, size = 8, color = '#fff', align = 'center') {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(str, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

// Sprite 10x10: X = color del jugador, o = contorno, w = blanco, e = pupila
const SPRITE = [
  '..oooooo..',
  '.oXXXXXXo.',
  'oXXXXXXXXo',
  'oXXwwXXwwo',
  'oXXweXXweo',
  'oXXXXXXXXo',
  'oXXXXXXXXo',
  '.oXXXXXXo.',
  '.oXo..oXo.',
  '.oo....oo.',
];

function drawSprite(x, y, color, flip) {
  const ox = Math.round(x) - 5, oy = Math.round(y) - 5;
  for (let j = 0; j < 10; j++) {
    for (let i = 0; i < 10; i++) {
      const ch = SPRITE[j][flip ? 9 - i : i];
      if (ch === '.') continue;
      ctx.fillStyle = ch === 'X' ? color : ch === 'w' ? '#fff' : '#000';
      ctx.fillRect(ox + i, oy + j, 1, 1);
    }
  }
}

function platX(p) {
  return p.type === 'move' ? (movingPos.get(p.id) ?? p.x) : p.x;
}

function drawPlatform(p, sy) {
  const px = platX(p), w = p.w;
  const th = THEMES[track] || THEMES.easy;
  if (p.type === 'ground') {
    ctx.fillStyle = th.ground[0]; ctx.fillRect(px, sy, w, 10);
    ctx.fillStyle = th.ground[1]; ctx.fillRect(px, sy, w, 3);
  } else if (p.type === 'checkpoint') {
    ctx.fillStyle = '#00b3a4'; ctx.fillRect(px, sy, w, 6);
    ctx.fillStyle = '#00e436'; ctx.fillRect(px, sy, w, 2);
    for (let x = 6; x < w; x += 24) { ctx.fillStyle = '#fff1e8'; ctx.fillRect(px + x, sy - 8, 2, 8); ctx.fillStyle = '#00e436'; ctx.fillRect(px + x + 2, sy - 8, 6, 4); }
  } else if (p.type === 'arena') {
    // Suelo de piedra de la arena del jefe, con dos columnas y antorchas a los lados
    ctx.fillStyle = '#3a332e'; ctx.fillRect(px, sy, w, 14);
    ctx.fillStyle = '#c2c3c7'; ctx.fillRect(px, sy, w, 2);
    ctx.fillStyle = '#5f574f';
    for (let x = 0; x < w; x += 16) { ctx.fillRect(px + x, sy + 2, 1, 6); ctx.fillRect(px + x + 8, sy + 8, 1, 6); }
    ctx.fillRect(px, sy + 8, w, 1);
    const flick = Math.floor(performance.now() / 120) % 2;
    for (const cx of [px + 6, px + w - 14]) {
      ctx.fillStyle = '#5f574f'; ctx.fillRect(cx, sy - 60, 8, 60);
      ctx.fillStyle = '#3a332e'; ctx.fillRect(cx + 6, sy - 60, 2, 60);
      ctx.fillStyle = '#ffa300'; ctx.fillRect(cx + 1, sy - 68 - flick, 6, 8);
      ctx.fillStyle = '#ffec27'; ctx.fillRect(cx + 3, sy - 66 - flick, 2, 4);
    }
  } else if (p.type === 'break') {
    ctx.fillStyle = '#ffa300';
    ctx.fillRect(px, sy, w, 6);
    ctx.fillStyle = '#c27a00';
    for (let x = 4; x < w; x += 10) ctx.fillRect(px + x, sy, 1, 6);
  } else if (p.type === 'move') {
    ctx.fillStyle = '#29adff'; ctx.fillRect(px, sy, w, 6);
    ctx.fillStyle = '#036'; ctx.fillRect(px, sy + 5, w, 1);
  } else if (p.type === 'spike') {
    ctx.fillStyle = '#5f574f'; ctx.fillRect(px, sy + 4, w, 3);
    ctx.fillStyle = '#ff004d';
    for (let x = 0; x < w; x += 8) {
      ctx.beginPath();
      ctx.moveTo(px + x, sy + 4); ctx.lineTo(px + x + 4, sy - 5); ctx.lineTo(px + x + 8, sy + 4);
      ctx.closePath(); ctx.fill();
    }
  } else {
    ctx.fillStyle = th.normal[0]; ctx.fillRect(px, sy, w, 6);
    ctx.fillStyle = th.normal[1]; ctx.fillRect(px, sy + 5, w, 1);
  }
}

// Decoración de fondo en coordenadas de pantalla, desplazada a 1/4 de la cámara (parallax)
function drawDeco(kind, now) {
  const par = camY * 0.25;
  if (kind === 'clouds') {
    ctx.fillStyle = 'rgba(255,241,232,0.10)';
    for (let i = 0; i < 9; i++) {
      const x = ((i * 137 + now / 200 * (1 + i % 3)) % (W + 80)) - 60;
      const y = (((i * 89 - par) % H) + H) % H;
      ctx.fillRect(Math.round(x), Math.round(y), 40 + (i % 3) * 14, 8);
      ctx.fillRect(Math.round(x) + 8, Math.round(y) - 6, 22, 6);
    }
  } else {
    for (let i = 0; i < 28; i++) {
      const x = (i * 53 + Math.sin(now / 900 + i) * 10) % W;
      const y = (((i * 97 - now / (18 + i % 5) - par) % H) + H) % H;
      ctx.fillStyle = i % 3 ? 'rgba(255,163,0,0.55)' : 'rgba(255,0,77,0.6)';
      ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
    }
  }
}

// Flecha pixel-art de 14 px apuntando en "dir"; antes de dispararse, un "!" parpadeante en el borde
// Jefe 14x12 dibujado a escala 2 (28x24): h cuernos, X cuerpo, w ojo, e pupila,
// m boca, t dientes, o patas
const BOSS_SPRITE = [
  'h............h',
  'hh..........hh',
  '.hXXXXXXXXXXh.',
  '.XXXXXXXXXXXX.',
  'XXXwwXXXXwwXXX',
  'XXXweXXXXewXXX',
  'XXXXXXXXXXXXXX',
  'XXmmmmmmmmmmXX',
  'XXmtmtmtmtmtXX',
  '.XXXXXXXXXXXX.',
  '.XXX.XXXX.XXX.',
  '.oo...oo...oo.',
];
const BOSS_COLORS = { easy: '#7e2553', hard: '#ab5236' };

function drawBoss(now) {
  const bs = curr.bs;
  if (!bs || !bs.al) return;
  if (finishY < camY - 60 || finishY - 40 > camY + H) return;
  const ox = Math.round(bs.x) - 14, oy = finishY - 24;
  const flash = bs.h && Math.floor(now / 70) % 2;          // parpadea al recibir un pisotón
  const bob = bs.h ? 0 : Math.floor(now / 200) % 2;         // pequeño balanceo al andar
  for (let j = 0; j < 12; j++) {
    for (let i = 0; i < 14; i++) {
      const ch = BOSS_SPRITE[j][bs.d < 0 ? 13 - i : i];
      if (ch === '.') continue;
      ctx.fillStyle = flash ? '#fff1e8'
        : ch === 'X' ? (BOSS_COLORS[track] || BOSS_COLORS.easy)
        : ch === 'h' ? '#fff1e8' : ch === 'w' ? '#fff' : ch === 'e' ? '#ff004d'
        : ch === 'm' ? (bs.sh ? '#ffa300' : '#000') : ch === 't' ? '#fff' : '#000';
      ctx.fillRect(ox + i * 2, oy + j * 2 - bob, 2, 2);
    }
  }
  // Vida que me queda por quitarle: 3 corazones menos mis pisotones
  const m = me();
  const left = bs.n - (m && m.ig ? m.bh : 0);
  for (let k = 0; k < bs.n; k++) {
    ctx.fillStyle = k < left ? '#ff004d' : '#5f574f';
    ctx.fillRect(Math.round(bs.x) - bs.n * 4 + k * 8 + 1, oy - 10, 6, 5);
  }
}

// Bolas de fuego con parpadeo, extrapoladas entre snapshots
function drawFireballs(now) {
  if (!curr.fb) return;
  const ticks = (now - currT) / (1000 / 30);
  const flick = Math.floor(now / 90) % 2;
  for (const [fx, fy, vx, vy] of curr.fb) {
    const x = Math.round(fx + vx * ticks), y = Math.round(fy + vy * ticks);
    ctx.fillStyle = '#ff004d'; ctx.fillRect(x - 4, y - 3, 8, 6); ctx.fillRect(x - 3, y - 4, 6, 8);
    ctx.fillStyle = flick ? '#ffa300' : '#ffec27'; ctx.fillRect(x - 2, y - 2, 4, 4);
    ctx.fillStyle = 'rgba(255,163,0,0.5)'; ctx.fillRect(x - Math.sign(vx) * 7 - 1, y - Math.sign(vy) * 5 - 1, 3, 3);
  }
}

function drawArrows(now) {
  if (!curr.ar) return;
  const ticks = (now - currT) / (1000 / 30);
  for (const [ax, ay, dir, fired, speed] of curr.ar) {
    if (ay < camY - 20 || ay > camY + H + 20) continue;
    if (!fired) {
      if (Math.floor(now / 120) % 2) continue;
      const ex = dir === 1 ? 6 : worldW - 6;
      ctx.fillStyle = '#ff004d';
      ctx.fillRect(ex - 4, ay - 6, 8, 12);
      text('!', ex, ay, 8, '#fff1e8');
      continue;
    }
    const x = Math.round(ax + dir * speed * ticks), y = Math.round(ay);
    ctx.fillStyle = '#c2c3c7';                       // astil
    ctx.fillRect(x - 7, y, 14, 1);
    ctx.fillStyle = '#fff1e8';                       // punta
    const tip = x + dir * 7;
    ctx.fillRect(tip, y - 1, 1, 3);
    ctx.fillRect(tip + dir, y, 1, 1);
    ctx.fillStyle = '#ff004d';                       // plumas
    const tail = x - dir * 7;
    ctx.fillRect(tail, y - 2, 2, 1);
    ctx.fillRect(tail, y + 2, 2, 1);
  }
}

function lerpPlayers() {
  if (!curr) return [];
  if (!prev) return curr.p;
  const span = Math.max(1, currT - prevT);
  const t = Math.min(1, (performance.now() - currT) / span);
  return curr.p.map(p => {
    const o = byId(prev, p.id);
    if (!o || !p.ig || !p.al) return p;
    return { ...p, x: o.x + (p.x - o.x) * t, y: o.y + (p.y - o.y) * t };
  });
}

function targetCamY() {
  const m = me();
  if (m && m.ig) return m.y - H * 0.55;
  if (curr) {
    const racers = curr.p.filter(p => p.ig && p.al);
    if (racers.length) return Math.min(...racers.map(p => p.y)) - H * 0.55;
  }
  return groundY - H;
}

function render() {
  requestAnimationFrame(render);

  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.imageSmoothingEnabled = false;

  // Fondo según la pista (cielo que cambia con la altura + decoración con parallax)
  const th = THEMES[curr && curr.ph !== 'lobby' ? track : 'easy'] || THEMES.easy;
  const skyT = curr ? Math.max(0, Math.min(1, 1 - camY / groundY)) : 0;
  ctx.fillStyle = th.sky(skyT);
  ctx.fillRect(0, 0, W, H);
  drawDeco(th.deco, performance.now());

  if (!curr) return;

  camY += (targetCamY() - camY) * 0.15;
  const now = performance.now();

  ctx.save();
  if (now < shakeUntil) ctx.translate(Math.round(Math.random() * 4 - 2), Math.round(Math.random() * 4 - 2));
  ctx.translate(0, -camY);

  // Plataformas visibles
  for (const p of platforms) {
    if (p.type === 'break' && brokenSet.has(p.id)) continue;
    if (p.y < camY - 20 || p.y > camY + H + 20) continue;
    drawPlatform(p, p.y);
  }

  // Jugadores
  const players = lerpPlayers();
  for (const p of players) {
    if (!p.ig || !p.al) continue;
    drawSprite(p.x, p.y, p.c);
    text(p.n, p.x, p.y - 12, 5, p.id === myId ? '#ffec27' : '#fff1e8');
    if (p.id === myId) {
      const bob = Math.floor(now / 250) % 2;
      ctx.fillStyle = '#ffec27';
      ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 19 - bob, 5, 1);
      ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 18 - bob, 3, 1);
    }
  }

  // Flechas, jefe y bolas de fuego
  drawArrows(now);
  drawBoss(now);
  drawFireballs(now);

  // Partículas
  particles = particles.filter(pt => {
    pt.x += pt.vx; pt.y += pt.vy; pt.vx *= 0.92; pt.vy *= 0.92;
    ctx.fillStyle = pt.c;
    ctx.fillRect(Math.round(pt.x), Math.round(pt.y), 2, 2);
    return --pt.life > 0;
  });

  // Lava
  if (curr.lv < camY + H + 30) {
    const ly = curr.lv;
    const grad = ctx.createLinearGradient(0, ly, 0, ly + 60);
    grad.addColorStop(0, '#ffec27');
    grad.addColorStop(0.3, '#ffa300');
    grad.addColorStop(1, '#ff004d');
    ctx.fillStyle = grad;
    ctx.fillRect(0, ly, worldW, groundY + 200 - ly);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let x = 0; x < worldW; x += 10) {
      const wobble = Math.sin(now / 150 + x) * 3;
      ctx.fillRect(x, ly + wobble, 6, 2);
    }
  }

  ctx.restore();
  drawOverlay(me());
}

function drawOverlay(m) {
  const ph = curr.ph;
  const dim = () => { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H); };
  const blink = Math.floor(performance.now() / 500) % 2 === 0;

  if (ph === 'lobby') {
    dim();
    text('8 BITS BATTLE', W / 2, 80, 22, '#ffec27');
    text('CARRERA VERTICAL', W / 2, 110, 10, '#29adff');
    text(`${curr.p.length} JUGADOR${curr.p.length === 1 ? '' : 'ES'} CONECTADO${curr.p.length === 1 ? '' : 'S'}`, W / 2, 140, 8, '#29adff');
    const vt = curr.vt || { easy: 0, hard: 0 };
    text(`VOTOS  FÁCIL ${vt.easy}`, W / 2 - 8, 162, 9, TRACK_COLORS.easy, 'right');
    text(`DIFÍCIL ${vt.hard}`, W / 2 + 8, 162, 9, TRACK_COLORS.hard, 'left');
    if (curr.p.length === 1) {
      text('VOTA UNA PISTA Y PULSA "JUGAR SOLO"', W / 2, 185, 8, '#00e436');
      if (blink) text('O ESPERA A QUE ENTREN MÁS JUGADORES', W / 2, 200, 7, '#29adff');
    } else {
      text('VOTA LA PISTA Y PULSA "EMPEZAR PARTIDA"', W / 2, 190, 8, '#00e436');
    }
    text('SUBE LA TORRE Y DERROTA AL JEFE: ¡SÁLTALE ENCIMA 3 VECES!', W / 2, 230, 6, '#83769c');
    text(`HASTA ${maxPlayers} JUGADORES · LA LAVA SUBE · SI TE CAES, PIERDES`, W / 2, 245, 6, '#83769c');
    text('¡CUIDADO CON LAS FLECHAS QUE SALEN DE LOS LADOS!', W / 2, 260, 6, '#83769c');
  } else if (ph === 'countdown') {
    dim();
    text(String(curr.cd), W / 2, H / 2 - 10, 48, '#ffec27');
    text('¡PREPÁRATE!', W / 2, H / 2 + 40, 10, '#fff1e8');
    text(`PISTA ${TRACK_NAMES[curr.tr] || ''}`, W / 2, H / 2 + 60, 8, TRACK_COLORS[curr.tr] || '#fff1e8');
  } else if (ph === 'playing') {
    const racing = curr.p.filter(p => p.ig && p.al && !p.fin).length;
    text(`SUBIENDO: ${racing}`, 8, 12, 8, '#fff1e8', 'left');
    text(`PISTA ${TRACK_NAMES[curr.tr] || ''}`, W - 8, 12, 8, TRACK_COLORS[curr.tr] || '#fff1e8', 'right');
    // Último en pie en una partida de varios: aún tiene que vencer al jefe
    const inGameCount = curr.p.filter(p => p.ig).length;
    if (m && m.ig && m.al && !m.fin && racing === 1 && inGameCount > 1) {
      text('¡ERES EL ÚLTIMO! DERROTA AL JEFE PARA GANAR', W / 2, H - 14, 7, blink ? '#ffec27' : '#fff1e8');
    } else if (m && m.ig && m.al && !m.fin && curr.fm) {
      text('MODO FINAL: SI CAES, VUELVES AL CHECKPOINT · ¡A POR EL JEFE!', W / 2, H - 14, 6, '#29adff');
    }
    // Aviso al llegar cerca del jefe
    if (m && m.ig && m.al && !m.fin && m.y < finishY + 3 * rowH && curr.bs && curr.bs.al) {
      text(`¡SALTA ENCIMA DEL JEFE!  ${m.bh}/${curr.bs.n}`, W / 2, 30, 9, blink ? '#ffec27' : '#ff004d');
      text('ESQUIVA SUS BOLAS DE FUEGO', W / 2, 44, 6, '#fff1e8');
    }
    if (m && m.ig && m.fin) {
      text('¡HAS DERROTADO AL JEFE!', W / 2, H / 2, 14, '#ffec27');
    } else if (m && m.ig && !m.al) {
      text(myDeath === 'fell' ? '¡TE HAS CAÍDO!' : 'TE HA ALCANZADO LA LAVA', W / 2, H / 2 - 10, 14, '#ff004d');
      text('MIRANDO LA PARTIDA...', W / 2, H / 2 + 20, 8, '#fff1e8');
    } else if (m && !m.ig) {
      text('PARTIDA EN CURSO - ENTRAS EN LA SIGUIENTE', W / 2, H - 14, 7, '#ffec27');
    }
  } else if (ph === 'ended') {
    dim();
    if (curr.w) {
      const won = m && m.n === curr.w;
      text(won ? '¡HAS GANADO!' : 'GANADOR', W / 2, 110, won ? 24 : 16, '#ffec27');
      text(curr.w, W / 2, 160, 24, blink ? '#00e436' : '#fff1e8');
    } else if (m && m.ig && curr.p.filter(p => p.ig).length === 1) {
      // Partida en solitario: se muestra hasta dónde llegó
      text('¡HAS PERDIDO!', W / 2, 110, 20, '#ff004d');
      text(`LLEGASTE AL ${m.pct}% DE LA TORRE`, W / 2, 150, 10, '#ffec27');
    } else {
      text('¡NADIE DERROTÓ AL JEFE!', W / 2, 130, 16, '#ffec27');
    }
    text('VOLVIENDO A LA SALA...', W / 2, 240, 8, '#83769c');
  }
}

connect();
render();

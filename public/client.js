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

let ws, myId = null, isHost = false, joined = false;
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
  lava: () => [440, 330, 220, 110].forEach((f, i) => beep(f, 0.12, { delay: i * 0.1, vol: 0.06 })),
  finish: () => [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.14, { delay: i * 0.1, vol: 0.08 })),
  count: () => beep(523, 0.12),
  go: () => beep(1046, 0.3),
  win: () => [523, 659, 784, 1046, 784, 1046].forEach((f, i) => beep(f, 0.14, { delay: i * 0.12 })),
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
  const hostKey = new URLSearchParams(location.search).get('host');
  const qs = hostKey ? `?host=${encodeURIComponent(hostKey)}` : '';
  ws = new WebSocket(`${proto}://${host}${qs}`);
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
  isHost = m.isHost;
  worldW = m.worldW; groundY = m.groundY; finishY = m.finishY; rowH = m.rowH;
  maxPlayers = m.maxPlayers; totalCp = m.totalCp;
  setLevel(m.level);

  $('#hostPanel').hidden = !isHost;
  if (isHost) {
    showScreen('game');
  } else {
    showScreen('join');
    let saved = '';
    try { saved = localStorage.getItem('8bits-name') || ''; } catch {}
    $('#nameInput').value = saved;
    $('#nameInput').focus();
    if (saved && sessionStorage.getItem('8bits-auto')) send({ t: 'join', name: saved });
  }
}

function onLevel(m) {
  setLevel(m.platforms);
  worldW = m.worldW; groundY = m.groundY; finishY = m.finishY; rowH = m.rowH; totalCp = m.totalCp;
}

function onJoined(m) {
  joined = true;
  try {
    localStorage.setItem('8bits-name', m.name);
    sessionStorage.setItem('8bits-auto', '1');
  } catch {}
  $('#hostJoinForm').hidden = true;
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
$('#hostJoinForm').addEventListener('submit', e => {
  e.preventDefault();
  initAudio();
  const n = $('#hostName').value.trim();
  if (n) send({ t: 'join', name: n.toUpperCase() });
});
$('#btnStart').addEventListener('click', () => { initAudio(); send({ t: 'start' }); });
$('#btnStop').addEventListener('click', () => send({ t: 'stop' }));

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
  if (ev.k === 'fall' && ev.id === myId) sfx.fall();
  if (ev.k === 'lava') {
    if (p) burst(p.x, p.y, '#ff004d', 20, 2.5);
    sfx.lava();
    addFeedMsg(`${ev.name} cayó en la lava`);
    if (ev.id === myId) shakeUntil = performance.now() + 300;
  }
  if (ev.k === 'finish') {
    sfx.finish();
    addFeedMsg(`${ev.name} ¡llegó a la cima!`);
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
  $('#hudStatus').textContent = inGame ? (m.fin ? '¡EN LA CIMA!' : (m.al ? '' : 'ELIMINADO')) : '';
}

function updateSide() {
  const ps = [...curr.p].sort((a, b) => (b.fin - a.fin) || (b.al - a.al) || (b.pct - a.pct));
  const key = ps.map(p => `${p.id}|${p.n}|${p.pct}|${p.al}|${p.ig}|${p.fin}`).join(';') + curr.ph;
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
    info.textContent = !playing ? 'LISTO'
      : !p.ig ? 'ESPERA'
      : p.fin ? 'CIMA' : !p.al ? 'LAVA' : `${p.pct}%`;
    li.append(name, info);
    ul.appendChild(li);
  }

  if (isHost) {
    $('#btnStart').disabled = curr.ph !== 'lobby' || curr.p.length < 2;
    $('#btnStart').textContent = curr.ph === 'lobby' && curr.p.length < 2 ? 'FALTAN JUGADORES' : 'EMPEZAR PARTIDA';
    $('#btnStop').disabled = curr.ph === 'lobby';
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
  if (p.type === 'ground') {
    ctx.fillStyle = '#5f574f'; ctx.fillRect(px, sy, w, 10);
    ctx.fillStyle = '#3a332e'; ctx.fillRect(px, sy, w, 3);
  } else if (p.type === 'checkpoint') {
    ctx.fillStyle = '#00b3a4'; ctx.fillRect(px, sy, w, 6);
    ctx.fillStyle = '#00e436'; ctx.fillRect(px, sy, w, 2);
    for (let x = 6; x < w; x += 24) { ctx.fillStyle = '#fff1e8'; ctx.fillRect(px + x, sy - 8, 2, 8); ctx.fillStyle = '#00e436'; ctx.fillRect(px + x + 2, sy - 8, 6, 4); }
  } else if (p.type === 'finish') {
    ctx.fillStyle = '#ffec27'; ctx.fillRect(px, sy, w, 8);
    for (let x = 0; x < w; x += 12) { ctx.fillStyle = (x / 12) % 2 ? '#000' : '#fff1e8'; ctx.fillRect(px + x, sy, 12, 4); }
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
    ctx.fillStyle = '#8f7a5a'; ctx.fillRect(px, sy, w, 6);
    ctx.fillStyle = '#6b5a41'; ctx.fillRect(px, sy + 5, w, 1);
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

  // Fondo (cielo que se oscurece según la altura)
  const skyT = curr ? Math.max(0, Math.min(1, 1 - camY / groundY)) : 0;
  ctx.fillStyle = `rgb(${18 + skyT * 10},${24 + skyT * 30},${74 + skyT * 90})`;
  ctx.fillRect(0, 0, W, H);

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
    text(`${curr.p.length} JUGADOR${curr.p.length === 1 ? '' : 'ES'} CONECTADO${curr.p.length === 1 ? '' : 'S'}`, W / 2, 150, 8, '#29adff');
    if (isHost) {
      text(curr.p.length < 2 ? 'ESPERANDO A LOS ALUMNOS...' : 'PULSA "EMPEZAR PARTIDA"', W / 2, 185, 8, '#00e436');
    } else if (blink) {
      text('ESPERANDO A QUE EMPIECE LA PARTIDA...', W / 2, 185, 8, '#00e436');
    }
    text('SALTA DE PLATAFORMA EN PLATAFORMA · ¡EL PRIMERO EN LLEGAR ARRIBA GANA!', W / 2, 230, 6, '#83769c');
    text(`HASTA ${maxPlayers} JUGADORES · LA LAVA SUBE SI TE QUEDAS ATRÁS`, W / 2, 245, 6, '#83769c');
  } else if (ph === 'countdown') {
    dim();
    text(String(curr.cd), W / 2, H / 2 - 10, 48, '#ffec27');
    text('¡PREPÁRATE!', W / 2, H / 2 + 40, 10, '#fff1e8');
  } else if (ph === 'playing') {
    const racing = curr.p.filter(p => p.ig && p.al && !p.fin).length;
    text(`SUBIENDO: ${racing}`, 8, 12, 8, '#fff1e8', 'left');
    if (m && m.ig && m.fin) {
      text('¡HAS LLEGADO A LA CIMA!', W / 2, H / 2, 14, '#ffec27');
    } else if (m && m.ig && !m.al) {
      text('TE HA ALCANZADO LA LAVA', W / 2, H / 2 - 10, 14, '#ff004d');
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
    } else {
      text('¡NADIE HA LLEGADO!', W / 2, 130, 18, '#ffec27');
    }
    text('VOLVIENDO A LA SALA...', W / 2, 240, 8, '#83769c');
  }
}

connect();
render();

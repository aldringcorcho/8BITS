// ============================================================
//  8 BITS BATTLE - Cliente (navegador de cada alumno)
// ============================================================
const $ = s => document.querySelector(s);
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const SCALE = 2;                       // resolución interna x2 para textos nítidos
const W = canvas.width / SCALE, H = canvas.height / SCALE;
const FONT = '"Press Start 2P", "Courier New", monospace';

// URL pública del servidor WebSocket (Render/Railway/Fly...). Vacío = mismo origen (uso local con INICIAR.bat).
const BACKEND_URL = ''; // ej: 'https://8bits-battle.onrender.com'

let ws, myId = null, isHost = false, joined = false;
let TILE = 16, maxShots = 10, maxHp = 3;
let mapLayer = null;                    // mapa pre-dibujado
let prev = null, curr = null, prevT = 0, currT = 0;
let particles = [];
let shakeUntil = 0;
let muted = false;
let lastListKey = '';

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
  shoot: mine => beep(mine ? 880 : 660, 0.08, { vol: mine ? 0.07 : 0.02, slide: -500 }),
  hit: mine => beep(mine ? 140 : 220, 0.18, { type: 'sawtooth', vol: mine ? 0.12 : 0.04, slide: -100 }),
  death: () => [440, 330, 220, 110].forEach((f, i) => beep(f, 0.12, { delay: i * 0.1, vol: 0.06 })),
  empty: () => beep(90, 0.05, { vol: 0.05 }),
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
  const host = BACKEND_URL ? BACKEND_URL.replace(/^https?:\/\//, '') : location.host;
  const proto = (BACKEND_URL ? BACKEND_URL.startsWith('https') : location.protocol === 'https:') ? 'wss' : 'ws';
  const hostKey = new URLSearchParams(location.search).get('host');
  const qs = hostKey ? `?host=${encodeURIComponent(hostKey)}` : '';
  ws = new WebSocket(`${proto}://${host}${qs}`);
  ws.onopen = () => { $('#offline').hidden = true; };
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') onWelcome(m);
    else if (m.t === 'joined') onJoined(m);
    else if (m.t === 's') onState(m);
  };
  ws.onclose = () => {
    $('#offline').hidden = false;
    joined = false;
    setTimeout(connect, 2000);
  };
}

function onWelcome(m) {
  myId = m.id;
  isHost = m.isHost;
  TILE = m.tile;
  maxShots = m.maxShots;
  maxHp = m.maxHp;
  $('#helpShots').textContent = maxShots;
  buildMap(m.map);

  const list = $('#addrList');
  list.replaceChildren();
  const ips = m.ips.length ? m.ips : [location.hostname];
  for (const ip of ips) {
    const d = document.createElement('div');
    d.textContent = `${ip}:${m.port}`;
    list.appendChild(d);
  }

  $('#hostPanel').hidden = !isHost;
  if (isHost) {
    showScreen('game');
  } else {
    showScreen('join');
    let saved = '';
    try { saved = localStorage.getItem('8bits-name') || ''; } catch {}
    $('#nameInput').value = saved;
    $('#nameInput').focus();
    // Si se ha caído la conexión y ya tenía nombre, vuelve a entrar solo
    if (saved && sessionStorage.getItem('8bits-auto')) send({ t: 'join', name: saved });
  }
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
  prev = curr; prevT = currT;
  curr = s; currT = performance.now();

  // Sonidos de la cuenta atrás
  if (s.ph === 'countdown' && s.cd !== oldCd) sfx.count();
  if (s.ph === 'playing' && oldPhase === 'countdown') sfx.go();

  for (const ev of s.e) handleEvent(ev);
  updateHud();
  updateSide();
}

function handleEvent(ev) {
  const p = byId(curr, ev.id);
  if (ev.k === 'shot') sfx.shoot(ev.id === myId);
  if (ev.k === 'hit' && p) {
    sfx.hit(ev.id === myId);
    burst(p.x, p.y, p.c, 8);
    if (ev.id === myId) shakeUntil = performance.now() + 250;
  }
  if (ev.k === 'wall') burst(ev.x, ev.y, '#c2c3c7', 3, 1);
  if (ev.k === 'kill') {
    if (p) burst(p.x, p.y, p.c, 20, 2.5);
    sfx.death();
    addFeed(ev.killer, ev.victim);
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

function addFeed(killer, victim) {
  const li = document.createElement('li');
  const k = document.createElement('b'); k.textContent = killer;
  const v = document.createElement('b'); v.textContent = victim;
  li.append(k, ' ► ', v);
  const feed = $('#feed');
  feed.prepend(li);
  while (feed.children.length > 6) feed.lastChild.remove();
}

function updateHud() {
  const m = me();
  const inGame = m && m.ig;
  const hp = inGame ? Math.max(0, m.hp) : 0;
  const am = inGame ? m.am : 0;
  $('#hudHp').textContent = inGame ? '♥'.repeat(hp) + '♡'.repeat(maxHp - hp) : '-';
  $('#hudAmmo').textContent = inGame ? '▮'.repeat(am) + '▯'.repeat(maxShots - am) : '-';
  $('#hudAmmoNum').textContent = inGame ? `${am}/${maxShots}` : '';
  $('#hudKills').textContent = inGame ? m.k : 0;
}

function updateSide() {
  const ps = [...curr.p].sort((a, b) => (b.ig && b.al) - (a.ig && a.al) || b.k - a.k);
  const key = ps.map(p => `${p.id}|${p.n}|${p.hp}|${p.al}|${p.ig}|${p.k}`).join(';') + curr.ph;
  if (key === lastListKey) return;
  lastListKey = key;

  const playing = curr.ph !== 'lobby';
  const alive = curr.p.filter(p => p.ig && p.al).length;
  $('#aliveCount').textContent = playing ? `(${alive} VIVOS)` : `(${curr.p.length})`;

  const ul = $('#playerList');
  ul.replaceChildren();
  for (const p of ps) {
    const li = document.createElement('li');
    if (playing && (!p.ig || !p.al)) li.className = 'dead';
    if (p.id === myId) li.classList.add('me');
    const name = document.createElement('span');
    name.className = 'pname';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = p.c;
    name.append(dot, p.n);
    const info = document.createElement('span');
    info.textContent = playing && p.ig ? `${'♥'.repeat(Math.max(0, p.hp))} ${p.k}☠` : (playing ? 'ESPERA' : 'LISTO');
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
const keys = { u: false, d: false, l: false, r: false };
const KEYMAP = {
  KeyW: 'u', ArrowUp: 'u', KeyS: 'd', ArrowDown: 'd',
  KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
};
let aim = 0, mouse = null, inputDirty = false;

function typing() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

addEventListener('keydown', e => {
  if (typing()) return;
  initAudio();
  const k = KEYMAP[e.code];
  if (k) { e.preventDefault(); if (!keys[k]) { keys[k] = true; inputDirty = true; } }
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) shoot(); }
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

canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouse = { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
});
canvas.addEventListener('mouseleave', () => { mouse = null; });
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  if (document.activeElement) document.activeElement.blur();
  initAudio();
  shoot();
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

function shoot() {
  const m = me();
  if (!joined || !m || !m.ig || !m.al || curr.ph !== 'playing') return;
  if (m.am <= 0) { sfx.empty(); return; }
  send({ t: 'shoot', a: aim });
}

// Enviar teclas y ángulo como mucho 20 veces por segundo
setInterval(() => {
  if (joined && inputDirty) {
    send({ t: 'in', ...keys, a: Math.round(aim * 100) / 100 });
    inputDirty = false;
  }
}, 50);

// ------------------------------------------------------------
//  Dibujo
// ------------------------------------------------------------
function buildMap(map) {
  mapLayer = document.createElement('canvas');
  mapLayer.width = map[0].length * TILE;
  mapLayer.height = map.length * TILE;
  const g = mapLayer.getContext('2d');
  for (let y = 0; y < map.length; y++) {
    for (let x = 0; x < map[y].length; x++) {
      const px = x * TILE, py = y * TILE;
      if (map[y][x] === '#') {
        // Muro de ladrillos
        g.fillStyle = '#5f574f'; g.fillRect(px, py, TILE, TILE);
        g.fillStyle = '#000';
        g.fillRect(px, py + 7, TILE, 1);
        g.fillRect(px, py + 15, TILE, 1);
        g.fillRect(px + 7, py, 1, 7);
        g.fillRect(px + 3, py + 8, 1, 7);
        g.fillRect(px + 12, py + 8, 1, 7);
        g.fillStyle = '#c2c3c7';
        g.fillRect(px, py, TILE, 1);
      } else {
        // Suelo a cuadros
        g.fillStyle = (x + y) % 2 ? '#1d2b53' : '#18244a';
        g.fillRect(px, py, TILE, TILE);
        if ((x * 7 + y * 13) % 11 === 0) {
          g.fillStyle = '#2a3a6a';
          g.fillRect(px + 5, py + 9, 2, 1);
          g.fillRect(px + 10, py + 4, 1, 2);
        }
      }
    }
  }
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

function drawSprite(x, y, color, flip, flash) {
  const ox = Math.round(x) - 5, oy = Math.round(y) - 5;
  for (let j = 0; j < 10; j++) {
    for (let i = 0; i < 10; i++) {
      const ch = SPRITE[j][flip ? 9 - i : i];
      if (ch === '.') continue;
      ctx.fillStyle = flash ? '#fff'
        : ch === 'X' ? color : ch === 'w' ? '#fff' : '#000';
      ctx.fillRect(ox + i, oy + j, 1, 1);
    }
  }
}

function text(str, x, y, size = 8, color = '#fff', align = 'center') {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(str, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function lerpPlayers() {
  if (!curr) return [];
  if (!prev) return curr.p;
  const span = Math.max(1, currT - prevT);
  const t = Math.min(1, (performance.now() - currT) / span);
  return curr.p.map(p => {
    const o = byId(prev, p.id);
    if (!o || !o.al || !p.ig) return p;
    return { ...p, x: o.x + (p.x - o.x) * t, y: o.y + (p.y - o.y) * t };
  });
}

let hitFlash = new Map();

function render() {
  requestAnimationFrame(render);
  const now = performance.now();

  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  if (now < shakeUntil) ctx.translate(Math.round(Math.random() * 4 - 2), Math.round(Math.random() * 4 - 2));

  ctx.fillStyle = '#000';
  ctx.fillRect(-4, -4, W + 8, H + 8);
  if (mapLayer) ctx.drawImage(mapLayer, 0, 0);

  if (!curr) { ctx.restore(); return; }

  const players = lerpPlayers();
  const m = players.find(p => p.id === myId);

  // Ángulo de apuntado
  if (m && mouse) {
    const a = Math.atan2(mouse.y - m.y, mouse.x - m.x);
    if (Math.abs(a - aim) > 0.02) { aim = a; inputDirty = true; }
  }

  // Zona peligrosa
  if (curr.ph === 'playing' && curr.z < Math.hypot(W / 2, H / 2) + 10) {
    ctx.fillStyle = 'rgba(255, 0, 77, 0.28)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.arc(W / 2, H / 2, Math.max(0, curr.z), 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#ff004d';
    ctx.setLineDash([4, 4]);
    ctx.lineDashOffset = -now / 60;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, Math.max(0, curr.z), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Jugadores caídos (lápida)
  for (const p of players) {
    if (!p.ig || p.al || curr.ph === 'lobby') continue;
    const x = Math.round(p.x), y = Math.round(p.y);
    ctx.fillStyle = '#5f574f';
    ctx.fillRect(x - 3, y - 5, 6, 9);
    ctx.fillRect(x - 4, y - 3, 8, 7);
    ctx.fillStyle = '#c2c3c7';
    ctx.fillRect(x - 1, y - 3, 2, 5);
    ctx.fillRect(x - 2, y - 2, 4, 1);
  }

  // Balas
  for (const [bx, by] of curr.b) {
    ctx.fillStyle = '#ffa300';
    ctx.fillRect(bx - 2, by - 2, 4, 4);
    ctx.fillStyle = '#fff1e8';
    ctx.fillRect(bx - 1, by - 1, 2, 2);
  }

  // Jugadores vivos
  if (curr.ph !== 'lobby') {
    for (const p of players) {
      if (!p.ig || !p.al) continue;
      if (curr.e.some(e => e.k === 'hit' && e.id === p.id)) hitFlash.set(p.id, now + 120);
      const flash = (hitFlash.get(p.id) || 0) > now;
      const a = p.id === myId ? aim : p.a;

      // Arma
      ctx.strokeStyle = '#c2c3c7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(Math.round(p.x), Math.round(p.y));
      ctx.lineTo(Math.round(p.x + Math.cos(a) * 9), Math.round(p.y + Math.sin(a) * 9));
      ctx.stroke();

      drawSprite(p.x, p.y, p.c, Math.cos(a) < 0, flash);

      // Indicador de "tú"
      if (p.id === myId) {
        ctx.fillStyle = '#ffec27';
        const bob = Math.floor(now / 250) % 2;
        ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 21 - bob, 5, 1);
        ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 20 - bob, 3, 1);
        ctx.fillRect(Math.round(p.x), Math.round(p.y) - 19 - bob, 1, 1);
      }

      // Nombre y vidas
      text(p.n, p.x, p.y - 14, 5, p.id === myId ? '#ffec27' : '#fff1e8');
      for (let i = 0; i < maxHp; i++) {
        ctx.fillStyle = i < p.hp ? '#ff004d' : '#5f574f';
        ctx.fillRect(Math.round(p.x) - maxHp * 2 + i * 4 + 1, Math.round(p.y) + 8, 3, 2);
      }
    }
  }

  // Partículas
  particles = particles.filter(pt => {
    pt.x += pt.vx; pt.y += pt.vy; pt.vx *= 0.92; pt.vy *= 0.92;
    ctx.fillStyle = pt.c;
    ctx.fillRect(Math.round(pt.x), Math.round(pt.y), 2, 2);
    return --pt.life > 0;
  });

  // Mira
  if (m && m.al && mouse && curr.ph === 'playing') {
    const mx = Math.round(mouse.x), my = Math.round(mouse.y);
    ctx.fillStyle = m.am > 0 ? '#ffec27' : '#5f574f';
    ctx.fillRect(mx - 4, my, 3, 1); ctx.fillRect(mx + 2, my, 3, 1);
    ctx.fillRect(mx, my - 4, 1, 3); ctx.fillRect(mx, my + 2, 1, 3);
  }

  ctx.restore();
  drawOverlay(m);
}

function drawOverlay(m) {
  const ph = curr.ph;
  const dim = () => { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H); };
  const blink = Math.floor(performance.now() / 500) % 2 === 0;

  if (ph === 'lobby') {
    dim();
    text('8 BITS BATTLE', W / 2, 90, 24, '#ffec27');
    text(`${curr.p.length} JUGADOR${curr.p.length === 1 ? '' : 'ES'} CONECTADO${curr.p.length === 1 ? '' : 'S'}`, W / 2, 140, 8, '#29adff');
    if (isHost) {
      text(curr.p.length < 2 ? 'ESPERANDO A LOS ALUMNOS...' : 'PULSA "EMPEZAR PARTIDA"', W / 2, 180, 8, '#00e436');
    } else if (blink) {
      text('ESPERANDO A QUE EMPIECE LA PARTIDA...', W / 2, 180, 8, '#00e436');
    }
    text(`${maxShots} TIROS  ·  ${maxHp} VIDAS  ·  SOLO QUEDA UNO`, W / 2, 230, 7, '#83769c');
  } else if (ph === 'countdown') {
    dim();
    text(String(curr.cd), W / 2, H / 2 - 10, 48, '#ffec27');
    text('¡PREPÁRATE!', W / 2, H / 2 + 40, 10, '#fff1e8');
  } else if (ph === 'playing') {
    const alive = curr.p.filter(p => p.ig && p.al).length;
    text(`VIVOS: ${alive}`, 8, 12, 8, '#fff1e8', 'left');
    if (curr.zt > 0) text(`ZONA EN ${curr.zt}s`, W - 8, 12, 8, '#ffa300', 'right');
    else if (curr.z > 0) text('¡LA ZONA SE CIERRA!', W - 8, 12, 8, blink ? '#ff004d' : '#ffa300', 'right');

    if (m && m.ig && !m.al) {
      text('HAS CAÍDO', W / 2, H / 2 - 10, 20, '#ff004d');
      text('MIRANDO LA PARTIDA...', W / 2, H / 2 + 20, 8, '#fff1e8');
    } else if (m && !m.ig) {
      text('PARTIDA EN CURSO - ENTRAS EN LA SIGUIENTE', W / 2, H - 14, 7, '#ffec27');
    } else if (m && m.al && m.am === 0 && blink) {
      text('¡SIN MUNICIÓN! ¡ESCONDETE!', W / 2, H - 14, 8, '#ff004d');
    }
  } else if (ph === 'ended') {
    dim();
    if (curr.w) {
      const won = m && m.n === curr.w;
      text(won ? '¡HAS GANADO!' : 'GANADOR', W / 2, 110, won ? 24 : 16, '#ffec27');
      text(curr.w, W / 2, 160, 24, blink ? '#00e436' : '#fff1e8');
    } else {
      text('¡EMPATE!', W / 2, 130, 24, '#ffec27');
    }
    text('VOLVIENDO A LA SALA...', W / 2, 240, 8, '#83769c');
  }
}

connect();
render();

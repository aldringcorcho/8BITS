// ============================================================
//  8 BITS BATTLE - Servidor (host del profesor)
//  Todos contra todos, solo puede quedar uno.
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dgram = require('dgram');
const { WebSocketServer } = require('ws');

// ---------- Configuración ----------
const PORT = Number(process.env.PORT) || 3000;
const TICK_MS = 1000 / 30;          // 30 actualizaciones por segundo
const TILE = 16;
const MAX_SHOTS = 10;               // 10 tiros como máximo por jugador y partida
const MAX_HP = 3;                   // vidas por jugador
const SPEED = 2.2;                  // px por tick
const BULLET_SPEED = 6;             // px por tick
const BULLET_LIFE = 90;             // ticks (3 s)
const SHOT_COOLDOWN = 350;          // ms entre disparos
const PLAYER_R = 6;                 // radio del jugador (caja 12x12)
const COUNTDOWN_MS = 3000;
const END_SCREEN_MS = 7000;
const ZONE_DELAY = 25000;           // la zona empieza a cerrarse a los 25 s
const ZONE_SHRINK = 60000;          // tarda 60 s en cerrarse del todo
const ZONE_DMG_EVERY = 1500;        // fuera de la zona pierdes 1 vida cada 1,5 s
const NAME_MAX = 12;
const HOST_KEY = process.env.HOST_KEY || 'profe'; // clave secreta para el panel del profesor (cámbiala en producción)

// Paleta tipo 8 bits para los jugadores
const COLORS = [
  '#ff004d', '#29adff', '#00e436', '#ffec27', '#ff77a8', '#ffa300',
  '#83769c', '#ffccaa', '#00b3a4', '#c2c3c7', '#ab5236', '#7e2553',
];

// Mapa 30x20: '#' = muro, '.' = suelo
const MAP = [
  '##############################',
  '#............................#',
  '#..##......#......#......##..#',
  '#..#.......#......#.......#..#',
  '#..........#......#..........#',
  '#....###..............###....#',
  '#............................#',
  '#......##....####....##......#',
  '#..#......................#..#',
  '#..#.....#..........#.....#..#',
  '#..#.....#..........#.....#..#',
  '#..#......................#..#',
  '#......##....####....##......#',
  '#............................#',
  '#....###..............###....#',
  '#..........#......#..........#',
  '#..#.......#......#.......#..#',
  '#..##......#......#......##..#',
  '#............................#',
  '##############################',
];
const ROWS = MAP.length;
const COLS = MAP[0].length;
if (MAP.some(r => r.length !== COLS)) throw new Error('El mapa tiene filas de distinta longitud');
const W = COLS * TILE;
const H = ROWS * TILE;
const ZONE_START_R = Math.hypot(W / 2, H / 2) + 10;

const isWall = (tx, ty) =>
  tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS || MAP[ty][tx] === '#';
const wallAt = (x, y) => isWall(Math.floor(x / TILE), Math.floor(y / TILE));

function boxHitsWall(x, y, r) {
  return wallAt(x - r, y - r) || wallAt(x + r - 0.01, y - r) ||
         wallAt(x - r, y + r - 0.01) || wallAt(x + r - 0.01, y + r - 0.01);
}

// ---------- Utilidades de red ----------
const VIRTUAL_IF = /vmware|virtualbox|vbox|vethernet|hyper-v|wsl|docker|loopback|tailscale|zerotier/i;
let mainIP = null;           // IP de la tarjeta que sale a la red del aula

// Averigua qué IP usa el sistema para salir a la red (no envía ningún paquete)
function detectMainIP() {
  const sock = dgram.createSocket('udp4');
  sock.on('error', () => sock.close());
  sock.connect(53, '8.8.8.8', () => {
    try { mainIP = sock.address().address; } catch {}
    sock.close();
  });
}

function lanIPs() {
  const ips = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_IF.test(name)) continue;
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    }
  }
  if (mainIP && ips.includes(mainIP)) return [mainIP];
  return ips;
}

function cleanName(raw) {
  let n = String(raw || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NAME_MAX);
  if (!n) n = 'Jugador';
  const taken = new Set([...players.values()].map(p => p.name.toLowerCase()));
  let final = n, i = 2;
  while (taken.has(final.toLowerCase())) final = `${n.slice(0, NAME_MAX - 2)}${i++}`;
  return final;
}

// ---------- Estado del juego ----------
const players = new Map();   // id -> jugador
let bullets = [];
let events = [];             // eventos de este tick (disparos, impactos, muertes)
let phase = 'lobby';         // lobby | countdown | playing | ended
let phaseStart = Date.now();
let winner = null;           // nombre del ganador o null (empate)
let nextId = 1;
let colorIdx = 0;

function setPhase(p) { phase = p; phaseStart = Date.now(); }

function zoneRadius() {
  if (phase !== 'playing') return ZONE_START_R;
  const t = Date.now() - phaseStart - ZONE_DELAY;
  if (t <= 0) return ZONE_START_R;
  return Math.max(0, ZONE_START_R * (1 - t / ZONE_SHRINK));
}

function randomSpawn(taken) {
  let best = null, bestDist = -1;
  for (let tries = 0; tries < 60; tries++) {
    const tx = 1 + Math.floor(Math.random() * (COLS - 2));
    const ty = 1 + Math.floor(Math.random() * (ROWS - 2));
    if (isWall(tx, ty)) continue;
    const x = tx * TILE + TILE / 2, y = ty * TILE + TILE / 2;
    const d = taken.length ? Math.min(...taken.map(p => Math.hypot(p.x - x, p.y - y))) : 999;
    if (d > bestDist) { best = { x, y }; bestDist = d; }
    if (d > 120) break;
  }
  return best;
}

function startCountdown() {
  const joined = [...players.values()].filter(p => p.joined);
  if (joined.length < 2 || phase !== 'lobby') return;
  bullets = [];
  const taken = [];
  for (const p of joined) {
    const s = randomSpawn(taken);
    taken.push(s);
    Object.assign(p, {
      x: s.x, y: s.y, hp: MAX_HP, ammo: MAX_SHOTS, alive: true, inGame: true,
      kills: 0, lastShot: 0, lastZoneHit: 0,
      input: { u: false, d: false, l: false, r: false },
    });
  }
  setPhase('countdown');
}

function backToLobby() {
  bullets = [];
  winner = null;
  for (const p of players.values()) { p.inGame = false; p.alive = false; }
  setPhase('lobby');
}

function damage(p, killer) {
  p.hp--;
  events.push({ k: 'hit', id: p.id });
  if (p.hp <= 0) {
    p.alive = false;
    if (killer) killer.kills++;
    events.push({ k: 'kill', killer: killer ? killer.name : 'la zona', victim: p.name, id: p.id });
  }
}

function tryShoot(p, angle) {
  if (phase !== 'playing' || !p.inGame || !p.alive) return;
  const now = Date.now();
  if (p.ammo <= 0 || now - p.lastShot < SHOT_COOLDOWN) return;
  if (typeof angle !== 'number' || !isFinite(angle)) return;
  p.lastShot = now;
  p.ammo--;
  const dx = Math.cos(angle), dy = Math.sin(angle);
  bullets.push({
    x: p.x + dx * (PLAYER_R + 2), y: p.y + dy * (PLAYER_R + 2),
    dx: dx * BULLET_SPEED, dy: dy * BULLET_SPEED, owner: p.id, life: BULLET_LIFE,
  });
  events.push({ k: 'shot', id: p.id });
}

function update() {
  const now = Date.now();

  if (phase === 'countdown' && now - phaseStart >= COUNTDOWN_MS) setPhase('playing');
  if (phase === 'ended' && now - phaseStart >= END_SCREEN_MS) backToLobby();
  if (phase !== 'playing') return;

  const fighters = [...players.values()].filter(p => p.inGame && p.alive);

  // Movimiento (eje a eje para deslizar por las paredes)
  for (const p of fighters) {
    let mx = (p.input.r ? 1 : 0) - (p.input.l ? 1 : 0);
    let my = (p.input.d ? 1 : 0) - (p.input.u ? 1 : 0);
    if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
    const nx = p.x + mx * SPEED;
    if (!boxHitsWall(nx, p.y, PLAYER_R)) p.x = nx;
    const ny = p.y + my * SPEED;
    if (!boxHitsWall(p.x, ny, PLAYER_R)) p.y = ny;
  }

  // Balas (en 2 sub-pasos para no atravesar nada)
  const survivors = [];
  for (const b of bullets) {
    let dead = false;
    for (let s = 0; s < 2 && !dead; s++) {
      b.x += b.dx / 2; b.y += b.dy / 2;
      if (wallAt(b.x, b.y)) { dead = true; events.push({ k: 'wall', x: Math.round(b.x), y: Math.round(b.y) }); break; }
      for (const p of fighters) {
        if (!p.alive || p.id === b.owner) continue;
        if (Math.abs(p.x - b.x) <= PLAYER_R + 1 && Math.abs(p.y - b.y) <= PLAYER_R + 1) {
          damage(p, players.get(b.owner));
          dead = true;
          break;
        }
      }
    }
    if (!dead && --b.life > 0) survivors.push(b);
  }
  bullets = survivors;

  // Zona que se cierra
  const zr = zoneRadius();
  for (const p of fighters) {
    if (!p.alive) continue;
    const out = Math.hypot(p.x - W / 2, p.y - H / 2) > zr;
    if (out && now - p.lastZoneHit >= ZONE_DMG_EVERY) {
      p.lastZoneHit = now;
      damage(p, null);
    }
  }

  // ¿Queda solo uno?
  const alive = fighters.filter(p => p.alive);
  if (alive.length <= 1) {
    winner = alive.length === 1 ? alive[0].name : null;
    bullets = [];
    setPhase('ended');
    events.push({ k: 'end', winner });
  }
}

function snapshot() {
  const now = Date.now();
  return JSON.stringify({
    t: 's',
    ph: phase,
    cd: phase === 'countdown' ? Math.ceil((COUNTDOWN_MS - (now - phaseStart)) / 1000) : 0,
    zt: phase === 'playing' ? Math.max(0, Math.ceil((ZONE_DELAY - (now - phaseStart)) / 1000)) : 0,
    z: Math.round(zoneRadius()),
    w: winner,
    p: [...players.values()].filter(p => p.joined).map(p => ({
      id: p.id, n: p.name, c: p.color,
      x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
      a: Math.round((p.angle || 0) * 100) / 100,
      hp: p.hp, am: p.ammo, al: p.alive, ig: p.inGame, k: p.kills,
    })),
    b: bullets.map(b => [Math.round(b.x), Math.round(b.y)]),
    e: events,
  });
}

// ---------- Servidor HTTP (sirve el cliente) ----------
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/client.js': ['client.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

const server = http.createServer((req, res) => {
  const file = STATIC[req.url.split('?')[0]];
  if (!file) { res.writeHead(404); return res.end('No encontrado'); }
  fs.readFile(path.join(__dirname, 'public', file[0]), (err, data) => {
    if (err) { res.writeHead(500); return res.end('Error'); }
    res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------- WebSockets ----------
const wss = new WebSocketServer({ server, maxPayload: 1024 });

// Render (y otros PaaS) ponen la app detrás de un proxy interno: remoteAddress deja
// de ser la IP real del cliente y parece "local" para TODO el mundo, así que ahí
// solo vale la clave secreta.
const BEHIND_PROXY = !!process.env.RENDER;

wss.on('connection', (ws, req) => {
  const addr = req.socket.remoteAddress || '';
  const reqUrl = new URL(req.url, 'http://x');
  const localAddr = !BEHIND_PROXY && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr);
  const isHost = localAddr || reqUrl.searchParams.get('host') === HOST_KEY;
  const p = {
    id: nextId++, ws, name: '', joined: false, isHost,
    color: COLORS[colorIdx++ % COLORS.length],
    x: 0, y: 0, angle: 0, hp: 0, ammo: 0, alive: false, inGame: false, kills: 0,
    lastShot: 0, lastZoneHit: 0, input: { u: false, d: false, l: false, r: false },
  };
  players.set(p.id, p);

  ws.send(JSON.stringify({
    t: 'welcome', id: p.id, isHost, ips: lanIPs(), port: PORT,
    map: MAP, tile: TILE, maxShots: MAX_SHOTS, maxHp: MAX_HP,
  }));

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    switch (m.t) {
      case 'join':
        if (p.joined) return;
        p.name = cleanName(m.name);
        p.joined = true;
        ws.send(JSON.stringify({ t: 'joined', name: p.name }));
        console.log(`  + ${p.name} se ha unido (${addr.replace('::ffff:', '')})`);
        break;
      case 'in':
        p.input = { u: !!m.u, d: !!m.d, l: !!m.l, r: !!m.r };
        if (typeof m.a === 'number' && isFinite(m.a)) p.angle = m.a;
        break;
      case 'shoot':
        if (typeof m.a === 'number' && isFinite(m.a)) p.angle = m.a;
        tryShoot(p, m.a);
        break;
      case 'start':
        if (p.isHost) startCountdown();
        break;
      case 'stop':
        if (p.isHost && phase !== 'lobby') backToLobby();
        break;
    }
  });

  ws.on('close', () => {
    if (p.joined) console.log(`  - ${p.name} se ha desconectado`);
    if (p.inGame && p.alive && phase === 'playing') {
      events.push({ k: 'kill', killer: 'desconexión', victim: p.name, id: p.id });
    }
    players.delete(p.id);
  });
});

// ---------- Bucle principal ----------
setInterval(() => {
  update();
  const msg = snapshot();
  events = [];
  for (const p of players.values()) {
    if (p.ws.readyState === 1) p.ws.send(msg);
  }
}, TICK_MS);

detectMainIP();
setInterval(detectMainIP, 30000);

server.listen(PORT, '0.0.0.0', async () => {
  await new Promise(r => setTimeout(r, 300));   // da tiempo a detectar la IP principal
  const ips = lanIPs();
  console.log('\n  ==========================================');
  console.log('        8 BITS BATTLE  -  servidor listo');
  console.log('  ==========================================\n');
  console.log('  PROFESOR (host) abre en este equipo:');
  console.log(`     http://localhost:${PORT}\n`);
  console.log('  ALUMNOS abren en su navegador:');
  if (ips.length) ips.forEach(ip => console.log(`     http://${ip}:${PORT}`));
  else console.log('     (no se ha encontrado ninguna IP de red)');
  console.log('\n  Pulsa Ctrl+C para cerrar el servidor.\n');
});

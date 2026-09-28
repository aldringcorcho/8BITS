// ============================================================
//  8 BITS BATTLE - Servidor
//  Carrera de obstáculos vertical: todos suben, solo puede llegar
//  el primero a la cima. La lava persigue por abajo.
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// ---------- Configuración ----------
const PORT = Number(process.env.PORT) || 3000;
const TICK_MS = 1000 / 30;           // física
const SEND_MS = 1000 / 20;           // envío por red
const MAX_PLAYERS = 20;
const NAME_MAX = 12;
const COUNTDOWN_MS = 3000;
const END_SCREEN_MS = 8000;

// ---------- Mundo / torre ----------
const WORLD_W = 480;
const ROW_H = 46;
const NUM_ROWS = 80;                 // filas a escalar
const GROUND_Y = NUM_ROWS * ROW_H;   // suelo (salida)
const FINISH_Y = 0;                  // cima (meta)
const PLAYER_R = 5;                  // caja de colisión (coincide con el sprite 10x10)
const MAX_JUMP_DX = 90;             // desplazamiento horizontal máx. garantizado entre filas

// ---------- Física ----------
const GRAVITY = 0.6;
const JUMP_VY = -11.5;
const MOVE_ACCEL = 0.7;
const MAX_VX = 3.0;
const FRICTION = 0.85;
const FALL_LOSE = ROW_H * 1.5;       // caer más de fila y media por debajo de la última plataforma = eliminado
const RESPAWN_INVULN = 800;          // ms de invulnerabilidad tras reaparecer

// ---------- Flechas (salen de los lados) ----------
const ARROW_SPEED = 4;               // px por tick
const ARROW_KNOCK_VX = 6;            // empujón horizontal al recibir una flecha
const ARROW_KNOCK_VY = -4;
const ARROW_KNOCK_TICKS = 12;        // ticks sin control tras el impacto

// ---------- Pistas (se eligen por votación en la sala de espera) ----------
const TRACKS = {
  easy: {
    name: 'FÁCIL',
    checkpointEvery: 10,             // una plataforma segura de ancho completo cada N filas
    mainW: [32, 20],                 // ancho de la plataforma del camino: mínimo + aleatorio
    mainPool: ['normal', 'normal', 'move', 'move', 'break', 'break'],
    afterBreakPool: ['normal', 'normal', 'break'],
    moveAmp: [22, 24], moveFreq: [0.002, 0.002],
    extraChance: 0.8, secondExtraChance: 0.45, thirdExtraChance: 0,
    extraPool: ['normal', 'move', 'break', 'spike', 'spike'],
    breakDelay: 280,                 // ms hasta que una plataforma "break" se desmorona
    arrowStart: 3000,                // ms tras "¡YA!" antes de la primera flecha
    arrowEveryMax: 1600,             // ms entre flechas al principio...
    arrowEveryMin: 650,              // ...y al final (cada vez más seguidas)
    arrowWarn: 700,                  // ms de aviso "!" en el borde antes de disparar
    lavaDelay: 4000,                 // la lava empieza a subir 4s después de "¡YA!"
    lavaSpeed: 16,                   // px/s
    lavaAccel: 0.2,                  // px/s² (para que la partida siempre acabe)
  },
  hard: {
    name: 'DIFÍCIL',
    checkpointEvery: 16,
    mainW: [26, 14],
    mainPool: ['normal', 'move', 'move', 'break', 'break', 'break'],
    afterBreakPool: ['normal', 'break', 'break'],
    moveAmp: [24, 28], moveFreq: [0.0025, 0.0025],
    extraChance: 1, secondExtraChance: 0.7, thirdExtraChance: 0.4,
    extraPool: ['normal', 'move', 'break', 'spike', 'spike', 'spike'],
    breakDelay: 200,
    arrowStart: 2000,
    arrowEveryMax: 900,
    arrowEveryMin: 350,
    arrowWarn: 550,
    lavaDelay: 3000,
    lavaSpeed: 18,
    lavaAccel: 0.25,
  },
};

// Paleta 8 bits para hasta 20 jugadores
const COLORS = [
  '#ff004d', '#29adff', '#00e436', '#ffec27', '#ff77a8', '#ffa300',
  '#83769c', '#ffccaa', '#00b3a4', '#c2c3c7', '#ab5236', '#7e2553',
  '#36c5f0', '#ecb800', '#e64980', '#4dabf7', '#69db7c', '#f783ac',
  '#fab005', '#845ef7',
];

function cleanName(raw) {
  let n = String(raw || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NAME_MAX);
  if (!n) n = 'Jugador';
  const taken = new Set([...players.values()].map(p => p.name.toLowerCase()));
  let final = n, i = 2;
  while (taken.has(final.toLowerCase())) final = `${n.slice(0, NAME_MAX - 2)}${i++}`;
  return final;
}

// ---------- Generación procedural de la torre (semilla por partida) ----------
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];

function buildLevel(seed, track) {
  const rnd = mulberry32(seed);
  const cfg = TRACKS[track];
  const between = ([min, extra]) => min + rnd() * extra;
  const platforms = [];
  let nextId = 0;
  const add = (x, y, w, type, extra) => {
    const p = { id: nextId++, x, y, w, type, ...extra };
    platforms.push(p);
    return p;
  };

  add(0, GROUND_Y, WORLD_W, 'ground');
  let cursorX = WORLD_W / 2;
  let prevMainType = 'ground';

  for (let row = 1; row < NUM_ROWS; row++) {
    const y = GROUND_Y - row * ROW_H;

    if (row % cfg.checkpointEvery === 0) {
      add(0, y, WORLD_W, 'checkpoint', { cpIdx: row / cfg.checkpointEvery });
      cursorX = WORLD_W / 2 + (rnd() * 2 - 1) * 40;
      prevMainType = 'checkpoint';
      continue;
    }

    // Plataforma principal: garantiza que siempre hay un camino posible
    const w = between(cfg.mainW);
    cursorX += (rnd() * 2 - 1) * MAX_JUMP_DX;
    cursorX = Math.max(w / 2 + 8, Math.min(WORLD_W - w / 2 - 8, cursorX));
    // Tras una "break" no hay tiempo de esperar a que una "move" se acerque: evitamos esa combinación imposible
    const mainType = pick(rnd, prevMainType === 'break' ? cfg.afterBreakPool : cfg.mainPool);
    add(cursorX - w / 2, y, w, mainType,
      mainType === 'move' ? { baseX: cursorX - w / 2, amp: between(cfg.moveAmp), freq: between(cfg.moveFreq), phase: rnd() * Math.PI * 2 } : {});
    prevMainType = mainType;

    // Plataformas extra (hasta 3): variedad y trampas, nunca son el único camino
    let extras = 0;
    if (rnd() < cfg.extraChance) extras++;
    if (extras && rnd() < cfg.secondExtraChance) extras++;
    if (extras === 2 && rnd() < cfg.thirdExtraChance) extras++;
    for (let k = 0; k < extras; k++) {
      const ew = 30 + rnd() * 24;
      let ex = rnd() * (WORLD_W - ew);
      if (Math.abs((ex + ew / 2) - cursorX) < (ew + w) / 2 + 6) ex = (ex + WORLD_W / 2) % (WORLD_W - ew);
      const extraType = pick(rnd, cfg.extraPool);
      add(ex, y, ew, extraType,
        extraType === 'move' ? { baseX: ex, amp: between(cfg.moveAmp) - 6, freq: between(cfg.moveFreq), phase: rnd() * Math.PI * 2 } : {});
    }
  }

  add(0, FINISH_Y, WORLD_W, 'finish');

  const byId = new Map(platforms.map(p => [p.id, p]));
  return {
    seed, track, cfg, platforms, byId,
    finish: platforms.find(p => p.type === 'finish'),
    totalCp: platforms.filter(p => p.type === 'checkpoint').length,
  };
}

function movingX(plat, elapsedMs) {
  return plat.baseX + Math.sin(elapsedMs * plat.freq + plat.phase) * plat.amp;
}

// ---------- Estado del juego ----------
const players = new Map();   // id -> jugador
let level = null;
let events = [];
let phase = 'lobby';         // lobby | countdown | playing | ended
let phaseStart = Date.now();
let winner = null;
let currentLavaY = GROUND_Y + 40;
let nextId = 1;
let colorIdx = 0;
let arrows = [];
let nextArrowAt = 0;
let arrowSeq = 0;

// Recuento de votos de la sala. Gana la pista más votada; si hay empate (o nadie
// ha votado) se sortea.
function tallyVotes() {
  const votes = { easy: 0, hard: 0 };
  for (const p of players.values()) if (p.joined && votes[p.vote] != null) votes[p.vote]++;
  return votes;
}

function chooseTrack() {
  const votes = tallyVotes();
  const tie = votes.easy === votes.hard;
  const track = tie ? (Math.random() < 0.5 ? 'easy' : 'hard') : (votes.easy > votes.hard ? 'easy' : 'hard');
  return { track, votes, tie };
}

function setPhase(p) { phase = p; phaseStart = Date.now(); }

// El nombre y el color no cambian durante la partida: se mandan solo cuando
// alguien entra o sale, no 30 veces por segundo dentro del snapshot.
function broadcastRoster() {
  const msg = JSON.stringify({
    t: 'roster',
    list: [...players.values()].filter(p => p.joined).map(p => ({ id: p.id, n: p.name, c: p.color })),
  });
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(msg);
}

// Devuelve false si la lava ya se tragó el checkpoint: entonces no hay sitio
// seguro al que volver y el jugador queda eliminado.
function respawnAtCheckpoint(p) {
  if (p.checkpoint.y >= currentLavaY) {
    p.alive = false;
    events.push({ k: 'lava', id: p.id, name: p.name });
    return false;
  }
  p.x = p.checkpoint.x;
  p.y = p.checkpoint.y - PLAYER_R;
  p.vx = 0; p.vy = 0;
  p.grounded = true;
  p.standingOn = null;
  p.lastGroundY = p.checkpoint.y;
  p.knock = 0;
  p.invulnUntil = Date.now() + RESPAWN_INVULN;
  return true;
}

function spawnArrow(fighters, now, elapsed) {
  const targets = fighters.filter(p => p.y + PLAYER_R < currentLavaY - 20);
  if (!targets.length) return;
  const t = pick(Math.random, targets);
  const dir = Math.random() < 0.5 ? 1 : -1;   // 1 = sale por la izquierda hacia la derecha
  arrows.push({
    id: arrowSeq++,
    x: dir === 1 ? 0 : WORLD_W,
    y: t.y + (Math.random() * 30 - 20),
    dir,
    fireAt: now + level.cfg.arrowWarn,
  });
  const { arrowEveryMax, arrowEveryMin } = level.cfg;
  const progress = Math.min(1, elapsed / 120000);
  nextArrowAt = now + arrowEveryMax - (arrowEveryMax - arrowEveryMin) * progress;
}

function startCountdown() {
  const joined = [...players.values()].filter(p => p.joined);
  if (joined.length < 2 || phase !== 'lobby') return;
  // Sin ningún voto no hay pista elegida: no se puede empezar
  const cast = tallyVotes();
  if (cast.easy + cast.hard === 0) return;

  const { track, votes, tie } = chooseTrack();
  level = buildLevel(Date.now() ^ Math.floor(Math.random() * 1e9), track);
  events.push({ k: 'track', v: track, easy: votes.easy, hard: votes.hard, tie });
  winner = null;
  currentLavaY = GROUND_Y + 40;
  arrows = [];
  nextArrowAt = 0;

  joined.forEach((p, i) => {
    const gridX = 40 + (i % 10) * ((WORLD_W - 80) / 9);
    Object.assign(p, {
      x: gridX + (Math.random() * 10 - 5), y: GROUND_Y - PLAYER_R,
      vx: 0, vy: 0, grounded: true, standingOn: null,
      alive: true, inGame: true, finished: false,
      checkpoint: { x: WORLD_W / 2, y: GROUND_Y, row: 0, idx: 0 },
      lastGroundY: GROUND_Y, knock: 0, deathBy: null,
      invulnUntil: 0, input: { l: false, r: false, jump: false }, prevJump: false,
    });
  });

  const payload = JSON.stringify({
    t: 'level', track: level.track,
    platforms: level.platforms.map(({ id, x, y, w, type }) => ({ id, x, y, w, type })),
    worldW: WORLD_W, groundY: GROUND_Y, finishY: FINISH_Y, rowH: ROW_H, totalCp: level.totalCp,
  });
  for (const p of players.values()) if (p.ws.readyState === 1) p.ws.send(payload);

  setPhase('countdown');
}

function backToLobby() {
  winner = null;
  currentLavaY = GROUND_Y + 40;
  arrows = [];
  // Cada ronda empieza con una votación nueva
  for (const p of players.values()) { p.inGame = false; p.alive = true; p.finished = false; p.vote = null; }
  setPhase('lobby');
}

function update() {
  const now = Date.now();

  if (phase === 'countdown' && now - phaseStart >= COUNTDOWN_MS) setPhase('playing');
  if (phase === 'ended' && now - phaseStart >= END_SCREEN_MS) backToLobby();
  if (phase !== 'playing' || !level) return;

  const elapsed = now - phaseStart;

  // Lava: sube tras un retraso, acelerando poco a poco para que la partida siempre termine
  const { lavaDelay, lavaSpeed, lavaAccel } = level.cfg;
  const t = elapsed - lavaDelay;
  if (t > 0) {
    const sec = t / 1000;
    currentLavaY = GROUND_Y + 40 - (lavaSpeed * sec + 0.5 * lavaAccel * sec * sec);
  } else {
    currentLavaY = GROUND_Y + 40;
  }

  const fighters = [...players.values()].filter(p => p.inGame && p.alive && !p.finished);

  // Flechas: aviso en el borde, luego cruzan la pantalla en horizontal
  if (elapsed >= level.cfg.arrowStart && now >= nextArrowAt) spawnArrow(fighters, now, elapsed);
  for (const a of arrows) if (now >= a.fireAt) a.x += a.dir * ARROW_SPEED;
  arrows = arrows.filter(a => a.x >= -20 && a.x <= WORLD_W + 20);

  for (const p of fighters) {
    // Tras un flechazo el jugador sale despedido y pierde el control un momento
    if (p.knock > 0) {
      p.knock--;
    } else {
      const dir = (p.input.r ? 1 : 0) - (p.input.l ? 1 : 0);
      if (dir) p.vx += dir * MOVE_ACCEL; else p.vx *= FRICTION;
      p.vx = Math.max(-MAX_VX, Math.min(MAX_VX, p.vx));
    }

    if (p.input.jump && !p.prevJump && p.grounded) {
      p.vy = JUMP_VY;
      p.grounded = false;
    }
    p.prevJump = p.input.jump;

    const prevPlat = p.standingOn != null ? level.byId.get(p.standingOn) : null;
    const prevPlatX = prevPlat && prevPlat.type === 'move' ? movingX(prevPlat, elapsed) : null;

    p.vy += GRAVITY;
    const prevY = p.y;
    p.x += p.vx;
    p.y += p.vy;
    p.x = Math.max(PLAYER_R, Math.min(WORLD_W - PLAYER_R, p.x));

    if (prevPlat && prevPlatX != null && p.grounded) {
      p.x += movingX(prevPlat, elapsed) - prevPlatX;
    }

    // Aterrizaje (solo desde arriba, plataformas de un solo sentido)
    p.grounded = false;
    p.standingOn = null;
    if (p.vy >= 0) {
      for (const plat of level.platforms) {
        if (plat.broken || plat.type === 'spike' || plat.type === 'finish') continue;
        const px = plat.type === 'move' ? movingX(plat, elapsed) : plat.x;
        if (p.x + PLAYER_R < px || p.x - PLAYER_R > px + plat.w) continue;
        const feetPrev = prevY + PLAYER_R, feetNow = p.y + PLAYER_R;
        if (feetPrev <= plat.y + 1 && feetNow >= plat.y) {
          p.y = plat.y - PLAYER_R;
          p.vy = 0;
          p.grounded = true;
          p.standingOn = plat.id;
          p.lastGroundY = plat.y;
          if (plat.type === 'checkpoint') {
            const row = Math.round((GROUND_Y - plat.y) / ROW_H);
            if (!p.checkpoint || row > p.checkpoint.row) {
              p.checkpoint = { x: plat.x + plat.w / 2, y: plat.y, row, idx: plat.cpIdx };
              events.push({ k: 'cp', id: p.id });
            }
          } else if (plat.type === 'break' && plat.crumbleAt == null) {
            plat.crumbleAt = now + level.cfg.breakDelay;
          }
          break;
        }
      }
    }

    // Pinchos
    if (now >= (p.invulnUntil || 0)) {
      for (const plat of level.platforms) {
        if (plat.type !== 'spike') continue;
        if (p.x + PLAYER_R > plat.x && p.x - PLAYER_R < plat.x + plat.w &&
            p.y + PLAYER_R > plat.y - 4 && p.y - PLAYER_R < plat.y + 8) {
          if (respawnAtCheckpoint(p)) events.push({ k: 'spike', id: p.id });
          break;
        }
      }
    }

    // Flechas
    if (now >= (p.invulnUntil || 0)) {
      for (const a of arrows) {
        if (now < a.fireAt || a.hit) continue;
        if (Math.abs(a.x - p.x) < PLAYER_R + 6 && Math.abs(a.y - p.y) < PLAYER_R + 2) {
          a.hit = true;
          p.vx = a.dir * ARROW_KNOCK_VX;
          p.vy = ARROW_KNOCK_VY;
          p.grounded = false;
          p.standingOn = null;
          p.knock = ARROW_KNOCK_TICKS;
          events.push({ k: 'arrow', id: p.id });
          break;
        }
      }
    }

    // Meta
    if (!p.finished && p.y - PLAYER_R <= level.finish.y + 6) {
      p.finished = true;
      p.grounded = true;
      p.vx = 0; p.vy = 0;
      events.push({ k: 'finish', id: p.id, name: p.name });
      if (!winner) {
        winner = p.name;
        setPhase('ended');
        events.push({ k: 'end', winner });
      }
    }

    // Caerse: quien cae más de fila y media por debajo de la última plataforma pisada queda eliminado
    if (p.alive && !p.grounded && !p.finished && p.y - p.lastGroundY > FALL_LOSE) {
      p.alive = false;
      events.push({ k: 'fell', id: p.id, name: p.name });
    }

    // Lava: elimina a quien se queda atrás
    if (p.alive && p.y + PLAYER_R >= currentLavaY) {
      p.alive = false;
      events.push({ k: 'lava', id: p.id, name: p.name });
    }
  }
  arrows = arrows.filter(a => !a.hit);

  // Plataformas "break" que ya han cumplido su temporizador
  for (const plat of level.platforms) {
    if (plat.type === 'break' && plat.crumbleAt != null && !plat.broken && now >= plat.crumbleAt) {
      plat.broken = true;
      events.push({ k: 'break', x: plat.x + plat.w / 2, y: plat.y });
    }
  }

  // ¿Ya no queda nadie compitiendo?
  if (!winner) {
    const inGame = [...players.values()].filter(p => p.inGame);
    const remaining = inGame.filter(p => p.alive && !p.finished);
    if (remaining.length === 0) {
      winner = null;
      setPhase('ended');
      events.push({ k: 'end', winner });
    } else if (remaining.length === 1 && inGame.length > 1) {
      winner = remaining[0].name;
      setPhase('ended');
      events.push({ k: 'end', winner });
    }
  }
}

function snapshot() {
  const now = Date.now();
  const elapsed = now - phaseStart;
  return JSON.stringify({
    t: 's',
    ph: phase,
    tr: phase === 'lobby' || !level ? null : level.track,
    vt: phase === 'lobby' ? tallyVotes() : null,
    cd: phase === 'countdown' ? Math.ceil((COUNTDOWN_MS - elapsed) / 1000) : 0,
    lv: Math.round(currentLavaY),
    w: winner,
    p: [...players.values()].filter(p => p.joined).map(p => ({
      id: p.id,
      x: Math.round(p.x), y: Math.round(p.y),
      al: p.alive, ig: p.inGame, fin: !!p.finished, vo: p.vote,
      cp: p.checkpoint ? p.checkpoint.idx : 0,
      pct: p.finished ? 100 : (level ? Math.max(0, Math.min(100, Math.round((GROUND_Y - p.y) / (GROUND_Y - FINISH_Y) * 100))) : 0),
    })),
    brk: level ? level.platforms.filter(pl => pl.broken).map(pl => pl.id) : [],
    // Flechas: [x, y, dir, disparada?, velocidad px/tick] — el cliente extrapola entre snapshots
    ar: phase === 'playing'
      ? arrows.map(a => [Math.round(a.x), Math.round(a.y), a.dir, now >= a.fireAt ? 1 : 0, ARROW_SPEED])
      : [],
    mv: level
      ? level.platforms.filter(pl => pl.type === 'move').map(pl => [pl.id, Math.round(movingX(pl, elapsed))])
      : [],
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

wss.on('connection', ws => {
  const p = {
    id: nextId++, ws, name: '', joined: false, vote: null,
    color: COLORS[colorIdx++ % COLORS.length],
    x: 0, y: 0, vx: 0, vy: 0, grounded: true, standingOn: null,
    alive: true, inGame: false, finished: false, checkpoint: null, invulnUntil: 0,
    input: { l: false, r: false, jump: false }, prevJump: false,
  };
  players.set(p.id, p);

  ws.send(JSON.stringify({
    t: 'welcome', id: p.id, maxPlayers: MAX_PLAYERS,
    worldW: WORLD_W, groundY: GROUND_Y, finishY: FINISH_Y, rowH: ROW_H,
    totalCp: level ? level.totalCp : Math.floor((NUM_ROWS - 1) / TRACKS.easy.checkpointEvery),
    level: level ? level.platforms.map(({ id, x, y, w, type }) => ({ id, x, y, w, type })) : null,
    track: level ? level.track : null,
  }));
  broadcastRoster();

  ws.on('message', raw => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    switch (m.t) {
      case 'join': {
        if (p.joined) return;
        const joinedCount = [...players.values()].filter(x => x.joined).length;
        if (joinedCount >= MAX_PLAYERS) { ws.send(JSON.stringify({ t: 'full' })); return; }
        p.name = cleanName(m.name);
        p.joined = true;
        ws.send(JSON.stringify({ t: 'joined', name: p.name }));
        broadcastRoster();
        console.log(`  + ${p.name} se ha unido`);
        break;
      }
      case 'in':
        p.input = { l: !!m.l, r: !!m.r, jump: !!m.jump };
        break;
      // Sin profesor: cualquier jugador que ya haya entrado puede votar y empezar
      case 'start':
        if (p.joined) startCountdown();
        break;
      case 'vote':
        if (p.joined && phase === 'lobby' && TRACKS[m.v]) p.vote = m.v;
        break;
    }
  });

  ws.on('close', () => {
    if (p.joined) console.log(`  - ${p.name} se ha desconectado`);
    players.delete(p.id);
    broadcastRoster();
  });
});

// ---------- Bucles ----------
// La física va a 30 Hz, pero por la red van 20 snapshots/s: el cliente interpola
// entre ellos, así que se ve igual y baja un tercio el tráfico con 20 jugadores.
setInterval(update, TICK_MS);

setInterval(() => {
  const msg = snapshot();
  events = [];
  for (const p of players.values()) {
    if (p.ws.readyState === 1) p.ws.send(msg);
  }
}, SEND_MS);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  ==========================================');
  console.log('        8 BITS BATTLE  -  servidor listo');
  console.log('  ==========================================\n');
  console.log(`  Escuchando en el puerto ${PORT}\n`);
});

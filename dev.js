// ============================================================
//  npm run dev  —  sustituye a INICIAR.bat en cualquier sistema
//  Instala dependencias si faltan, arranca el servidor y abre
//  el navegador en cuanto está escuchando.
// ============================================================
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const URL = `http://localhost:${PORT}`;
process.chdir(__dirname);

if (!fs.existsSync(path.join(__dirname, 'node_modules', 'ws'))) {
  console.log('Instalando dependencias...');
  execSync('npm install --no-audit --no-fund', { stdio: 'inherit' });
}

const server = spawn(process.execPath, ['server.js'], { stdio: 'inherit', env: { ...process.env, PORT: String(PORT) } });
server.on('exit', code => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));

function openBrowser() {
  if (process.env.BROWSER === 'none') return console.log(`  Abre ${URL} en el navegador`);
  const cmd = process.platform === 'win32' ? `start "" "${URL}"`
    : process.platform === 'darwin' ? `open "${URL}"`
    : `xdg-open "${URL}"`;
  try { execSync(cmd, { stdio: 'ignore' }); } catch { console.log(`  Abre ${URL} en el navegador`); }
}

// Espera a que el puerto responda antes de abrir el navegador
(function waitForServer(tries = 50) {
  const sock = net.connect(PORT, '127.0.0.1');
  sock.once('connect', () => { sock.end(); openBrowser(); });
  sock.once('error', () => { if (tries > 0) setTimeout(() => waitForServer(tries - 1), 200); });
})();

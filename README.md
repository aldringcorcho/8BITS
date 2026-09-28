# 8 BITS BATTLE — Carrera vertical

Juego de 8 bits para el aula: hasta **20 alumnos** compiten por escalar una torre saltando de plataforma en plataforma. **Gana el primero que llegue a la cima.** La lava sube desde abajo y elimina a quien se queda atrás.

## 🎮 Jugar ahora: https://bits-ashen.vercel.app

No hay que instalar nada: se abre la URL desde cualquier dispositivo (PC, móvil o tablet) y red, se escribe un nombre y a jugar.

## Cómo cumple los requisitos de la actividad

| Requisito | Solución |
|---|---|
| **Acceder desde la IP de cualquier usuario al juego en Vercel** | La web está en Vercel (`https://bits-ashen.vercel.app`), una URL pública accesible desde cualquier red. Vercel solo sirve archivos estáticos y funciones que no pueden mantener conexiones WebSocket abiertas, así que el servidor del juego (`server.js`) está en **Render** (`https://eightbits-dj6n.onrender.com`). El navegador de cada jugador abre la página de Vercel y se conecta por `wss://` a Render, que sincroniza a todos los jugadores en tiempo real. |
| **Convertir el `.bat` en un `npm run dev` nada más abrir la URL** | En la versión publicada no hace falta ejecutar nada: el servidor ya está en marcha en Render y basta con abrir la URL. Para desarrollo local, `INICIAR.bat` se ha sustituido por **`npm run dev`** (`dev.js`), que hace lo mismo en cualquier sistema operativo: instala dependencias si faltan, arranca el servidor y abre el navegador. `INICIAR.bat` ahora solo llama a `npm run dev`. |

### Arquitectura
```
 Jugador (cualquier IP) ──HTTPS──► Vercel  (index.html, client.js, style.css)
          │
          └──────────WSS (WebSocket)──► Render  (server.js: física, lava, flechas, votos)
```
Cada `git push` a `main` redespliega Vercel y Render automáticamente.

> El plan gratuito de Render duerme el servidor tras un rato sin uso: la primera conexión puede tardar hasta 1 minuto en despertarlo (la página muestra "CONECTANDO CON EL SERVIDOR...").

## Cómo se juega
1. Todos abren `https://bits-ashen.vercel.app` desde cualquier red, escriben su nombre y pulsan **¡A LUCHAR!**
2. En la sala de espera cada jugador **vota la pista**: **FÁCIL** o **DIFÍCIL**. Gana la más votada; si hay empate (o nadie vota), se elige al azar.
3. **Cualquier jugador** puede pulsar **EMPEZAR PARTIDA** cuando haya al menos 2. Al terminar se vuelve a la sala y se vota de nuevo.

## Reglas
- **Mover**: A / D o flechas. **Saltar**: W, flecha arriba o espacio. En móvil y tablet aparecen botones táctiles ◄ ► y ▲.
- Plataformas **naranjas** se rompen al pisarlas, las **azules** se mueven y los **pinchos** te devuelven al último checkpoint.
- Si te **caes** (más de fila y media por debajo de la última plataforma que pisaste), quedas eliminado.
- Desde los lados salen **flechas** (avisadas con un "!" rojo) que te empujan.
- La **lava** empieza a subir a los pocos segundos, acelerando poco a poco. Si te alcanza, quedas eliminado.
- Gana quien llegue arriba del todo; si quedan todos eliminados menos uno, gana el superviviente.

## Ajustes
Están al principio de `server.js`. Cada pista tiene su configuración en `TRACKS` (checkpoints, trampas, flechas, lava). También `NUM_ROWS` (altura de la torre), `MAX_PLAYERS` y la física (`GRAVITY`, `JUMP_VY`, `MAX_VX`).

## Jugar en local (sin internet)
```
npm run dev
```
Instala las dependencias si faltan, arranca el servidor y abre `http://localhost:3000`. (También vale doble clic en `INICIAR.bat`.) En local el cliente se conecta al servidor de tu equipo; los demás de la misma WiFi pueden entrar con `http://<IP-de-tu-PC>:3000`.

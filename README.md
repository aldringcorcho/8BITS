# 8 BITS BATTLE — Carrera vertical

Juego de 8 bits para el aula: hasta **20 alumnos** compiten por escalar una torre saltando de plataforma en plataforma. **Gana el primero que llegue a la cima.** La lava sube desde abajo y elimina a quien se queda atrás.

## Dónde está desplegado
- **Frontend (Vercel)**: https://bits-ashen.vercel.app
- **Backend WebSocket (Render)**: https://eightbits-dj6n.onrender.com

Cada `git push` a `main` redespliega ambos automáticamente.

## Cómo se juega
1. Todos abren `https://bits-ashen.vercel.app` desde cualquier red, escriben su nombre y pulsan **¡A LUCHAR!**
2. En la sala de espera cada jugador **vota la pista**: **FÁCIL** o **DIFÍCIL**. Gana la más votada; si hay empate (o nadie vota), se elige al azar.
3. **Cualquier jugador** puede pulsar **EMPEZAR PARTIDA** cuando haya al menos 2. Al terminar se vuelve a la sala y se vota de nuevo.

## Reglas
- **Mover**: A / D o flechas. **Saltar**: W, flecha arriba o espacio.
- Plataformas **naranjas** se rompen al pisarlas, las **azules** se mueven y los **pinchos** te devuelven al último checkpoint.
- Si te **caes** (más de fila y media por debajo de la última plataforma que pisaste), quedas eliminado.
- Desde los lados salen **flechas** (avisadas con un "!" rojo) que te empujan.
- La **lava** empieza a subir a los pocos segundos, acelerando poco a poco. Si te alcanza, quedas eliminado.
- Gana quien llegue arriba del todo; si quedan todos eliminados menos uno, gana el superviviente.

## Ajustes
Están al principio de `server.js`. Cada pista tiene su configuración en `TRACKS` (checkpoints, trampas, flechas, lava). También `NUM_ROWS` (altura de la torre), `MAX_PLAYERS` y la física (`GRAVITY`, `JUMP_VY`, `MAX_VX`).

## Jugar en local (sin internet)
Doble clic en `INICIAR.bat` (o `npm install` y `npm start`) y abre `http://localhost:3000`. En local el cliente se conecta al servidor de tu equipo.

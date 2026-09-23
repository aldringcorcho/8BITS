# 8 BITS BATTLE — Carrera vertical

Juego de 8 bits para el aula: hasta **20 alumnos** compiten por escalar una torre saltando de plataforma en plataforma. **Gana el primero que llegue a la cima.** La lava sube desde abajo y elimina a quien se queda atrás.

## Dónde está desplegado
- **Frontend (Vercel)**: https://bits-ashen.vercel.app
- **Backend WebSocket (Render)**: https://eightbits-dj6n.onrender.com

Cada `git push` a `main` redespliega ambos automáticamente.

## Cómo se juega
1. El **profesor** abre `https://bits-ashen.vercel.app/?host=TU_CLAVE` (la clave es la variable `HOST_KEY` configurada en Render). Verá el panel del profesor.
2. Los **alumnos** abren `https://bits-ashen.vercel.app` desde cualquier red, escriben su nombre y pulsan **¡A LUCHAR!**
3. Cuando estén todos, el profesor pulsa **EMPEZAR PARTIDA**.

## Reglas
- **Mover**: A / D o flechas. **Saltar**: W, flecha arriba o espacio.
- Plataformas **naranjas** se rompen al pisarlas, las **azules** se mueven y los **pinchos** te devuelven al último checkpoint.
- Las plataformas **verdes de ancho completo** son checkpoints: si caes, reapareces en el último que tocaste.
- A los 30 s empieza a subir la **lava**, acelerando poco a poco. Si te alcanza (o si se traga tu checkpoint), quedas eliminado.
- Gana quien llegue arriba del todo; si la lava elimina a todos menos a uno, gana el superviviente.

## Ajustes
Están al principio de `server.js`: `NUM_ROWS` (altura de la torre), `CHECKPOINT_EVERY`, `LAVA_DELAY`, `LAVA_SPEED`, `LAVA_ACCEL`, `MAX_PLAYERS`, y la física (`GRAVITY`, `JUMP_VY`, `MAX_VX`).

La clave del profesor se cambia en Render → Settings → Environment → `HOST_KEY`.

## Jugar en local (sin internet)
Doble clic en `INICIAR.bat` (o `npm install` y `npm start`) y abre `http://localhost:3000`. En local el cliente se conecta al servidor de tu equipo y quien abre desde `localhost` es automáticamente el profesor.

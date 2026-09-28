@echo off
title 8 BITS BATTLE - Servidor
cd /d "%~dp0"
rem Equivale a "npm run dev": instala dependencias, arranca el servidor y abre el navegador
call npm run dev
pause

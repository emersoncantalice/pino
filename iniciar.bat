@echo off
chcp 65001 >nul
title Pino - quadro colaborativo
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [ERRO] Node.js nao foi encontrado neste computador.
  echo   Instale o Node.js 17 ou mais recente: https://nodejs.org
  echo.
  pause
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) < 17 ? 1 : 0)"
if errorlevel 1 (
  echo.
  echo   [ERRO] O Pino precisa do Node.js 17 ou mais recente.
  node -v
  echo.
  pause
  exit /b 1
)

if not exist ".env" if exist ".env.example" (
  copy ".env.example" ".env" >nul
  echo   Arquivo .env criado. Coloque sua GEMINI_API_KEY nele para ativar a IA.
)

echo.
echo   Iniciando o Pino... o navegador vai abrir sozinho.
echo   Feche esta janela ou pressione Ctrl+C para desligar o servidor.
echo.
node server.js --open

echo.
echo   O servidor foi encerrado.
pause

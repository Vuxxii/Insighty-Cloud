@echo off
setlocal
cd /d "%~dp0"

rem First run: build the production bundle if it doesn't exist yet
if not exist "dist\index.html" (
  echo First run: building Insightyyy, this takes a minute...
  call npm run build
)

rem Start the server only if something isn't already listening on 4173
powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient('localhost',4173)).Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  start "Insightyyy server" /min cmd /c "npm run preview"
  timeout /t 2 /nobreak >nul
)

start "" "http://localhost:4173"
endlocal

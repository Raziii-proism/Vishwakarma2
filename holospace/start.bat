@echo off
echo.
echo  ===========================================
echo   HOLOSPACE - Shared Holographic Reality
echo  ===========================================
echo.

REM Check Node.js
node --version > nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found. Install from https://nodejs.org
  pause
  exit /b 1
)

echo [1/4] Installing server dependencies...
cd /d "%~dp0server"
call npm install --silent
if errorlevel 1 (echo Failed to install server deps & pause & exit /b 1)

echo [2/4] Installing client dependencies...
cd /d "%~dp0client"
call npm install --silent
if errorlevel 1 (echo Failed to install client deps & pause & exit /b 1)

echo [3/4] Starting HOLOSPACE server on port 3001...
cd /d "%~dp0server"
start "HOLOSPACE-Server" cmd /k "node server.js"
timeout /t 2 /nobreak > nul

echo [4/4] Starting HOLOSPACE client on port 5173...
cd /d "%~dp0client"
start "HOLOSPACE-Client" cmd /k "npx vite --host"

echo.
echo  HOLOSPACE is running!
echo.
echo  Local:   http://localhost:5173
echo  Network: Check the client window for your LAN IP
echo.
echo  On Android Chrome: open the network URL for full WebXR AR
echo  On iPhone: open the network URL for camera-passthrough mode
echo.
pause

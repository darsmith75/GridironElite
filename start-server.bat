@echo off
echo Starting Football Platform Server...
echo.
echo The server will run on http://localhost:3000
echo Press Ctrl+C to stop the server
echo.
cd /d "%~dp0"
node server.js
pause

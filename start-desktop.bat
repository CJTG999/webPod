@echo off
REM Runs webPod as a desktop app without building an installer (needs Node.js).
cd /d "%~dp0"
if not exist node_modules call npm install
call npm start

@echo off
REM Builds the webPod Windows installer + portable .exe.  Double-click to run.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
call npm install
if errorlevel 1 goto :fail
call npm run dist
if errorlevel 1 goto :fail
echo.
echo Done! Your installer and portable .exe are in the "dist" folder.
explorer dist
pause
exit /b 0
:fail
echo.
echo Build failed - see the messages above.
pause
exit /b 1

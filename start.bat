@echo off
title Roster Monster Launcher

:: Convert to short (8.3) path to eliminate spaces
for %%I in ("%~dp0.") do set "ROOT=%%~sI"
cd /d "%ROOT%"

set "VENV_PY=%ROOT%\backend\venv\Scripts\python.exe"

echo ========================================
echo   Roster Monster - Starting...
echo   Path: %ROOT%
echo ========================================
echo.

:: Check if venv exists and its python.exe actually works
set "NEED_VENV=0"
if not exist "%VENV_PY%" set "NEED_VENV=1"
if "%NEED_VENV%"=="0" (
    "%VENV_PY%" --version >nul 2>&1
    if errorlevel 1 set "NEED_VENV=1"
)

if "%NEED_VENV%"=="1" (
    echo [!] Backend venv missing or stale. Rebuilding...
    if exist "%ROOT%\backend\venv" rmdir /s /q "%ROOT%\backend\venv"
    py -3.13 -m venv "%ROOT%\backend\venv"
    if errorlevel 1 (
        echo [ERROR] Failed to create venv. Is Python 3.13 installed?
        pause
        exit /b 1
    )
    "%VENV_PY%" -m pip install -r "%ROOT%\backend\requirements.txt"
    echo.
)

:: Check if node_modules exists
if not exist "%ROOT%\frontend\node_modules" (
    echo [!] Frontend dependencies not found. Running npm install...
    cd /d "%ROOT%\frontend"
    npm install
    cd /d "%ROOT%"
)

:: Start backend (use venv python directly — no activate needed)
echo [1/3] Starting backend server...
start /min "Roster Monster - Backend" cmd /k "cd /d %ROOT%\backend && "%VENV_PY%" -m uvicorn app.main:app --host 127.0.0.1 --reload"

:: Start frontend in a minimized window
echo [2/3] Starting frontend server...
start /min "Roster Monster - Frontend" cmd /k "cd /d %ROOT%\frontend && npx --yes vite --host 127.0.0.1"

:: Wait for servers to start, then open browser
echo [3/3] Waiting for servers to start...
timeout /t 5 /nobreak >nul
start http://127.0.0.1:5173

echo.
echo ========================================
echo   Roster Monster is running!
echo   Frontend: http://127.0.0.1:5173
echo   Backend:  http://127.0.0.1:8000
echo   API docs: http://127.0.0.1:8000/docs
echo ========================================
echo.
echo Press any key to STOP both servers and exit.
pause >nul

:: Kill backend and frontend when user presses a key
echo Stopping servers...
taskkill /fi "WINDOWTITLE eq Roster Monster - Backend" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Roster Monster - Frontend" /f >nul 2>&1
echo Done.

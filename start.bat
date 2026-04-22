@echo off
title Roster Monster Launcher

:: Convert to short (8.3) path to eliminate spaces
for %%I in ("%~dp0.") do set "ROOT=%%~sI"
cd /d "%ROOT%"

echo ========================================
echo   Roster Monster - Starting...
echo   Path: %ROOT%
echo ========================================
echo.

:: Check if venv exists
if not exist "%ROOT%\backend\venv\Scripts\activate.bat" (
    echo [!] Backend venv not found. Running first-time setup...
    echo     Creating Python 3.13 virtual environment...
    py -3.13 -m venv "%ROOT%\backend\venv"
    call "%ROOT%\backend\venv\Scripts\activate.bat"
    pip install -r "%ROOT%\backend\requirements.txt"
    echo.
    echo     Seeding database...
    cd /d "%ROOT%\backend"
    python seed_april.py
    cd /d "%ROOT%"
) else (
    call "%ROOT%\backend\venv\Scripts\activate.bat"
)

:: Check if node_modules exists
if not exist "%ROOT%\frontend\node_modules" (
    echo [!] Frontend dependencies not found. Running npm install...
    cd /d "%ROOT%\frontend"
    npm install
    cd /d "%ROOT%"
)

:: Start backend in a hidden window
echo [1/3] Starting backend server...
start /min "Roster Monster - Backend" cmd /c "cd /d %ROOT%\backend && %ROOT%\backend\venv\Scripts\activate.bat && uvicorn app.main:app --host 127.0.0.1 --reload"

:: Start frontend in a hidden window
echo [2/3] Starting frontend server...
start /min "Roster Monster - Frontend" cmd /c "cd /d %ROOT%\frontend && npx --yes vite --host 127.0.0.1"

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

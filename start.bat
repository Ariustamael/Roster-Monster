@echo off
title Roster Monster Launcher
cd /d "%~dp0"

echo ========================================
echo   Roster Monster - Starting...
echo ========================================
echo.

:: Check if venv exists
if not exist "backend\venv\Scripts\activate.bat" (
    echo [!] Backend venv not found. Running first-time setup...
    echo     Creating Python 3.13 virtual environment...
    py -3.13 -m venv backend\venv
    call backend\venv\Scripts\activate.bat
    pip install -r backend\requirements.txt
    echo.
    echo     Seeding database...
    cd backend
    python seed_april.py
    cd ..
) else (
    call backend\venv\Scripts\activate.bat
)

:: Check if node_modules exists
if not exist "frontend\node_modules" (
    echo [!] Frontend dependencies not found. Running npm install...
    cd frontend
    npm install
    cd ..
)

:: Start backend in a new window
echo [1/3] Starting backend server...
start "Roster Monster - Backend" cmd /k "cd /d "%~dp0backend" && ..\backend\venv\Scripts\activate.bat && uvicorn app.main:app --reload"

:: Start frontend in a new window
echo [2/3] Starting frontend server...
start "Roster Monster - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

:: Wait for servers to start, then open browser
echo [3/3] Waiting for servers to start...
timeout /t 4 /nobreak >nul
start http://localhost:5173

echo.
echo ========================================
echo   Roster Monster is running!
echo   Frontend: http://localhost:5173
echo   Backend:  http://localhost:8000
echo   API docs: http://localhost:8000/docs
echo ========================================
echo.
echo Close the Backend and Frontend windows to stop.
pause

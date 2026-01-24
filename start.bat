@echo off
REM Social Graph - Start Script for Windows
REM Starts both backend and frontend servers

echo ============================================================
echo Social Graph - Temporal Twitter Network Atlas
echo ============================================================
echo.

REM Check if .env exists
if not exist backend\.env (
    echo ERROR: backend\.env not found!
    echo Run setup.py first or copy backend\.env.example to backend\.env
    pause
    exit /b 1
)

REM Start backend in new window
echo Starting backend server...
start "Social Graph Backend" cmd /k "cd backend && venv\Scripts\activate && uvicorn social_graph.api:app --reload --port 8000"

REM Wait a moment for backend to start
timeout /t 3 /nobreak >nul

REM Start frontend in new window
echo Starting frontend server...
start "Social Graph Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo Servers starting...
echo - Backend: http://localhost:8000
echo - Frontend: http://localhost:5173
echo.
echo Press any key to open the visualization...
pause >nul

start http://localhost:5173

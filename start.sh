#!/bin/bash
# Social Graph - Start Script for Linux/Mac
# Starts both backend and frontend servers

echo "============================================================"
echo "Social Graph - Temporal Twitter Network Atlas"
echo "============================================================"
echo

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if .env exists
if [ ! -f backend/.env ]; then
    echo "ERROR: backend/.env not found!"
    echo "Run setup.py first or copy backend/.env.example to backend/.env"
    exit 1
fi

# Function to cleanup on exit
cleanup() {
    echo "Stopping servers..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

# Start backend
echo "Starting backend server..."
cd backend
source venv/bin/activate
uvicorn social_graph.api:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 3

# Start frontend
echo "Starting frontend server..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo
echo "Servers running:"
echo "- Backend: http://localhost:8000"
echo "- Frontend: http://localhost:5173"
echo
echo "Press Ctrl+C to stop both servers"

# Wait for either process to exit
wait

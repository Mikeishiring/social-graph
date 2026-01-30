@echo off
cd /d "C:\Users\micha\Projects\Social Graph\backend"

echo Installing dependencies...
"C:\Users\micha\AppData\Local\Python\pythoncore-3.13-64\python.exe" -m pip install fastapi uvicorn httpx sqlalchemy pydantic-settings python-dotenv

echo.
set PYTHONPATH=src
set SOCIAL_GRAPH_TWITTER_BEARER_TOKEN=new1_c2e35f5e8a13439f828b407fd9765184
echo Starting Social Graph API server on 0.0.0.0:8000...
echo.
"C:\Users\micha\AppData\Local\Python\pythoncore-3.13-64\python.exe" -m uvicorn social_graph.api:app --host 0.0.0.0 --port 8000 --reload
pause

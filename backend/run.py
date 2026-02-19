# backend/run.py
import uvicorn
import os
import sys

if __name__ == "__main__":
    # 1. Force the current directory to be the path so imports work
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))

    print("🚀 STARTING BIO-NEXUS BACKEND...")
    print(f"📂 Working Directory: {os.getcwd()}")
    
    # 2. Run Uvicorn via Python (Bypasses "command not found" errors)
    # We point to "main:app" because we are inside the folder
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
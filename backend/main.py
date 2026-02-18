# backend/main.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import json
import hashlib
from datetime import datetime
import aiomqtt  # pip install aiomqtt

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows connections from anywhere (like your frontend)
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods (GET, POST, etc.)
    allow_headers=["*"],
)

# --- 1. THE VAULT (Blockchain Logic) ---
blockchain = []

def create_block(data):
    previous_hash = blockchain[-1]['hash'] if blockchain else "0"
    timestamp = datetime.now().isoformat()
    # Create block content
    block_content = json.dumps(data, sort_keys=True) + previous_hash + timestamp
    block_hash = hashlib.sha256(block_content.encode()).hexdigest()
    
    block = {
        "index": len(blockchain) + 1,
        "timestamp": timestamp,
        "data": data,
        "previous_hash": previous_hash,
        "hash": block_hash
    }
    blockchain.append(block)
    return block

# --- 2. CONNECTION MANAGER (For WebSockets) ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        # Iterate over a copy to avoid modification errors during iteration
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()

# --- 3. MQTT LISTENER (The Bridge) ---
async def mqtt_listener():
    # Retry logic in case MQTT broker isn't ready immediately
    while True:
        try:
            print("[System] Connecting to MQTT Broker...")
            async with aiomqtt.Client("localhost") as client:
                await client.subscribe("bionexus/sensors/#")
                print("[System] MQTT Connected & Listening")
                async for message in client.messages:
                    payload = message.payload.decode()
                    print(f"[MQTT] Received: {payload}")
                    
                    data_dict = json.loads(payload)
                    
                    # 1. Secure it on Blockchain
                    create_block(data_dict)
                    
                    # 2. Forward to Frontend
                    await manager.broadcast(json.dumps({
                        "type": "SENSOR_DATA",
                        "payload": data_dict
                    }))
        except Exception as e:
            print(f"[MQTT Error] {e}. Retrying in 5s...")
            await asyncio.sleep(5)

@app.on_event("startup")
async def startup_event():
    # Start the background listener
    asyncio.create_task(mqtt_listener())

# --- 4. API ENDPOINTS ---
@app.get("/")
def read_root():
    return {"status": "BioNexus Core Online"}

@app.get("/chain")
def get_chain():
    return blockchain

# Endpoint for Hardware-Sim (HTTP Fallback)
@app.post("/ingest")
async def ingest_data(data: dict):
    block = create_block(data)
    # Also broadcast to frontend so it shows up on dashboard
    await manager.broadcast(json.dumps({
        "type": "SENSOR_DATA", 
        "payload": data
    }))
    return {"status": "Data Secured", "block": block}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
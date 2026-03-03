# backend/main.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json
import aiomqtt
from blockchain import BioGridChain  # <-- THE VAULT IMPORT

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Instantiate the Master Ledger
bionexus_chain = BioGridChain()

# --- CONNECTION MANAGER ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections[:]:
            try:
                await connection.send_text(message)
            except Exception:
                self.disconnect(connection)

manager = ConnectionManager()


# --- GLOBAL STATE & PULSAR ---
global_state = {
    "total_hashes": 0 # Maintained for the UI vanity metric
}

async def network_state_broadcaster():
    """Broadcasts network stats AND the current mining job."""
    while True:
        try:
            if manager.active_connections:
                # Ask the Vault if there is data waiting to be mined
                mining_job = bionexus_chain.get_mining_job()
                
                payload = {
                    "type": "NETWORK_STATE",
                    "nodes": len(manager.active_connections),
                    "total_hashes": global_state["total_hashes"],
                    "chain_height": len(bionexus_chain.chain)
                }
                
                # If there is a job, attach it to the broadcast
                if mining_job:
                    payload["mining_job"] = mining_job

                await manager.broadcast(json.dumps(payload))
        except Exception as e:
            print(f"Broadcast error: {e}")
        
        await asyncio.sleep(1)


# --- MQTT LISTENER ---
async def mqtt_listener():
    while True:
        try:
            async with aiomqtt.Client("localhost") as client:
                await client.subscribe("bionexus/sensors/#")
                async for message in client.messages:
                    payload = message.payload.decode()
                    data_dict = json.loads(payload)
                    
                    # Add to mempool instead of instantly minting a fake block
                    bionexus_chain.add_pending_data(data_dict)
                    
                    await manager.broadcast(json.dumps({
                        "type": "SENSOR_DATA",
                        "payload": data_dict
                    }))
        except Exception as e:
            await asyncio.sleep(5)


# --- LIFECYCLE ROUTING ---
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(mqtt_listener())
    asyncio.create_task(network_state_broadcaster())


# --- API ENDPOINTS ---
@app.get("/")
def read_root():
    return {"status": "BioNexus Core Online"}

@app.get("/chain")
def get_chain():
    return bionexus_chain.chain

@app.get("/mempool")
def get_mempool():
    return bionexus_chain.pending_data

@app.post("/ingest")
async def ingest_data(data: dict):
    bionexus_chain.add_pending_data(data)
    return {"status": "Data added to mempool for mining"}


# --- WEBSOCKET ENDPOINT ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    
    try:
        while True:
            data = await websocket.receive_text()
            
            try:
                payload = json.loads(data)
            except json.JSONDecodeError:
                continue
            
            # Action 1: Generic Compute Ticks (The biological physics sim)
            if payload.get("action") == "COMPUTE_TICK":
                raw_hashes = payload.get("hashes", 0)
                try:
                    hashes_to_add = int(raw_hashes)
                    if 0 < hashes_to_add <= 50000000000:
                        global_state["total_hashes"] += hashes_to_add
                except (ValueError, TypeError):
                    pass

            # Action 2: Cryptographic Proof of Work Submitted
            elif payload.get("action") == "SUBMIT_BLOCK":
                block_index = payload.get("index")
                nonce = payload.get("nonce")
                submitted_hash = payload.get("hash")
                
                if block_index and nonce is not None and submitted_hash:
                    # The Vault mathematically verifies the React node didn't cheat
                    success = bionexus_chain.validate_and_add_block(block_index, nonce, submitted_hash)
                    
                    if success:
                        print(f"[CHAIN] Block {block_index} successfully forged by grid!")
                        await manager.broadcast(json.dumps({
                            "type": "BLOCK_MINED",
                            "block": bionexus_chain.chain[-1]
                        }))
                    else:
                        print(f"[CHAIN] Node submitted invalid Proof of Work for block {block_index}.")
                    
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)
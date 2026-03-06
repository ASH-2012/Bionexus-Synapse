# backend/main.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json
import aiomqtt
from blockchain import BioGridChain  # <-- THE VAULT IMPORT
from rdkit import Chem
from rdkit.Chem import AllChem

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
        async def send_to_one(connection: WebSocket):
            try:
                await connection.send_text(message)
            except Exception:
                self.disconnect(connection)

        # Fire all network requests concurrently. 
        # return_exceptions=True prevents one failed send from crashing the gather pool.
        tasks = [send_to_one(conn) for conn in self.active_connections[:]]
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

manager = ConnectionManager()


# --- GLOBAL STATE & PULSAR ---
# --- GLOBAL STATE & REAL ONCOLOGY DATA ---
# This is a curated list of actual FDA-approved cancer drugs and candidates
REAL_SMILES_DB = [
    "CN1CCN(CC1)C2=CC=CC=C2NC(=O)C3=CC=C(C=C3)C4=CN=CC=N4", # Imatinib (Leukemia)
    "COCCOC1=C(C=C2C(=C1)N=CN=C2NC3=CC=CC(=C3)C#C)OCCOC", # Erlotinib (Lung Cancer)
    "CC1=C(C(C(=O)C2=C1C(=O)C3=C(C2=O)C(CC(C3(C)O)(O)C(=O)CO)O)O)OC", # Doxorubicin (Breast Cancer)
    "CC1=C(C=C(C=C1)NC(=O)C2=CCC(=CC2)C3=CC=CC=C3)C4=CN=CN4", # Nilotinib
    "C1=CC=C(C=C1)C2=C(C(=O)C3=C(C2=O)C=CC(=C3)O)O", # Mitoxantrone
    "CS(=O)(=O)CC1=CC2=C(C=C1)N=C(C3=CC=CC=C32)NC4=CC=C(C=C4)F", # Lapatinib
    "CC1=C(C=C(C=C1)NC(=O)C2=CC=C(C=C2)CN3CCN(CC3)C)C4=CN=CC=C4", # Dasatinib
    "COC1=C(C=C2C(=C1)N=CN=C2NC3=CC(=C(C=C3)F)Cl)OCCCN4CCOCC4", # Gefitinib
    "C1=CC=C(C(=C1)C2=C(C(=O)C3=CC=CC=C3C2=O)O)O", # Anthracenedione core
    "C1CC1C2=CC=C(C=C2)C3=NC4=C(N3)C=C(C=C4)C5=CC=CC=C5" # Generic Kinase Inhibitor Motif
] * 100 # Multiply to create a massive 1000-compound dataset for the grid to chew through

def generate_3d_coordinates(smiles: str):
    """Converts a 1D SMILES string into a 3D atomic coordinate matrix."""
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    
    # We must add Hydrogen atoms to calculate accurate spatial collisions
    mol = Chem.AddHs(mol)
    
    # Generate 3D conformation. randomSeed=42 ensures the grid gets deterministic coordinates
    success = AllChem.EmbedMolecule(mol, randomSeed=42) 
    if success == -1:
        return None 
        
    conf = mol.GetConformer()
    atoms = []
    
    for i, atom in enumerate(mol.GetAtoms()):
        pos = conf.GetAtomPosition(i)
        atoms.append({
            "atomic_num": atom.GetAtomicNum(),
            "x": round(pos.x, 4),
            "y": round(pos.y, 4),
            "z": round(pos.z, 4)
        })
    return atoms

global_state = {
    "total_hashes": 0,
    "compute_mode": "PHYSICS", # The grid starts in N-Body mode
    "htvs_cursor": 0           # Tracks which batch of drugs to send next
}

# --- NEW: THE MODE SWITCHER ENDPOINT ---
# This allows your React UI to flip the entire grid's architecture instantly
@app.post("/api/mode")
async def toggle_mode(payload: dict):
    new_mode = payload.get("mode")
    if new_mode in ["PHYSICS", "HTVS"]:
        global_state["compute_mode"] = new_mode
        return {"status": f"Grid execution mode switched to {new_mode}"}
    return {"error": "Invalid execution mode"}

# --- THE DUAL-MODE PULSAR ---
async def network_state_broadcaster():
    """Broadcasts network stats AND the domain-specific mining job."""
    while True:
        try:
            if manager.active_connections:
                mining_job = bionexus_chain.get_mining_job()
                
                # --- THE STARVATION OVERRIDE (UPGRADED) ---
                # A blockchain must never sleep. If the mempool is empty, we mine empty blocks
                # to secure the chain and ensure the UI always receives the execution mode.
                if mining_job is None:
                    last_block = bionexus_chain.chain[-1] if bionexus_chain.chain else {"hash": "00000"}
                    mining_job = {
                        "index": len(bionexus_chain.chain) + 1,
                        "previous_hash": last_block["hash"],
                        # Differentiate the merkle root based on what the grid is doing
                        "merkle_root": "htvs_screening_batch" if global_state["compute_mode"] == "HTVS" else "empty_network_sync",
                        "difficulty": 4 # Standard fallback difficulty
                    }

                payload = {
                    "type": "NETWORK_STATE",
                    "nodes": len(manager.active_connections),
                    "total_hashes": global_state["total_hashes"],
                    "chain_height": len(bionexus_chain.chain),
                    "compute_mode": global_state["compute_mode"] 
                }
                
                if mining_job:
                    mining_job["compute_mode"] = global_state["compute_mode"]
                    
                    if global_state["compute_mode"] == "HTVS":
                        start = global_state["htvs_cursor"]
                        end = start + 2 # REDUCED BATCH SIZE: 3D matrices are heavy
                        
                        if end > len(REAL_SMILES_DB):
                            start = 0
                            end = 2
                            
                        global_state["htvs_cursor"] = end
                        smiles_batch = REAL_SMILES_DB[start:end]
                        
                        payload_3d = []
                        for smiles in smiles_batch:
                            matrix = generate_3d_coordinates(smiles)
                            if matrix:
                                payload_3d.append({"smiles": smiles, "atoms": matrix})
                                
                        mining_job["docking_payload"] = payload_3d

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
            # Action 2: Cryptographic Proof of Work Submitted
            elif payload.get("action") == "SUBMIT_BLOCK":
                block_index = payload.get("index")
                nonce = payload.get("nonce")
                submitted_hash = payload.get("hash")
                bio_payload = payload.get("payload") # Catch the biological drug array
                
                # --- THE BIOLOGICAL BYPASS ---
                # If we receive drugs, bypass the strict PoW check and append directly
                if global_state["compute_mode"] == "HTVS" and bio_payload:
                    import time
                    htvs_block = {
                        "index": len(bionexus_chain.chain) + 1,
                        "timestamp": time.time() * 1000,
                        "data": bio_payload, # The actual SMILES strings and scores
                        "nonce": nonce,
                        "hash": submitted_hash,
                        "merkle_root": "htvs_screening_batch"
                    }
                    bionexus_chain.chain.append(htvs_block)
                    print(f"[CHAIN] Biological HTVS Block {htvs_block['index']} secured!")
                    
                    await manager.broadcast(json.dumps({
                        "type": "BLOCK_MINED",
                        "block": htvs_block
                    }))
                
                # --- STANDARD PHYSICS / CRYPTO VERIFICATION ---
                elif block_index and nonce is not None and submitted_hash:
                    success = await asyncio.to_thread(
                        bionexus_chain.validate_and_add_block, 
                        block_index, 
                        nonce, 
                        submitted_hash
                    )
                    
                    if success:
                        await manager.broadcast(json.dumps({
                            "type": "BLOCK_MINED",
                            "block": bionexus_chain.chain[-1]
                        }))
                    else:
                        # Utilizing the websocket client property to log the specific node that failed
                        client_ip = websocket.client.host if websocket.client else "Unknown"
                        print(f"[CHAIN] REJECTED: Node {client_ip} submitted Proof of Work for a Ghost Root.")
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)
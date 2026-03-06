from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import json
import hashlib # ADDED: Required for verify_htvs_proof
import aiomqtt
from blockchain import BioGridChain, verify_biological_proof  # <-- THE VAULT IMPORT
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


# --- GLOBAL STATE & REAL ONCOLOGY DATA ---
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
] * 100 

def generate_3d_coordinates(smiles: str):
    """Converts a 1D SMILES string into a 3D atomic coordinate matrix."""
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    
    mol = Chem.AddHs(mol)
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

# --- NEW: PRE-CALCULATION OPTIMIZATION ---
PRECOMPUTED_3D_DB = []

async def precompute_drug_matrices():
    print("[INIT] Pre-computing 3D molecular conformations...")
    for smiles in REAL_SMILES_DB:
        matrix = await asyncio.to_thread(generate_3d_coordinates, smiles)
        if matrix:
            PRECOMPUTED_3D_DB.append({"smiles": smiles, "atoms": matrix})
    print(f"[INIT] Success. {len(PRECOMPUTED_3D_DB)} compounds ready for grid distribution.")

global_state = {
    "total_hashes": 0,
    "compute_mode": "PHYSICS", 
    "htvs_cursor": 0           
}

# --- THE MODE SWITCHER ENDPOINT ---
@app.post("/api/mode")
async def toggle_mode(payload: dict):
    new_mode = payload.get("mode")
    if new_mode in ["PHYSICS", "HTVS"]:
        global_state["compute_mode"] = new_mode
        return {"status": f"Grid execution mode switched to {new_mode}"}
    return {"error": "Invalid execution mode"}

# --- THE DUAL-MODE PULSAR ---
async def network_state_broadcaster():
    while True:
        try:
            if manager.active_connections:
                current_chain = bionexus_chain.get_chain()
                chain_height = len(current_chain)
                last_block = current_chain[-1] if current_chain else {"hash": "00000"}

                mining_job = bionexus_chain.get_mining_job()
                
                if mining_job is None:
                    mining_job = {
                        "index": chain_height + 1,
                        "previous_hash": last_block["hash"],
                        "merkle_root": "htvs_screening_batch" if global_state["compute_mode"] == "HTVS" else "empty_network_sync",
                        "difficulty": 4
                    }

                payload = {
                    "type": "NETWORK_STATE",
                    "nodes": len(manager.active_connections),
                    "total_hashes": global_state["total_hashes"],
                    "chain_height": chain_height,
                    "compute_mode": global_state["compute_mode"] 
                }
            
                if mining_job:
                    mining_job["compute_mode"] = global_state["compute_mode"]
                    
                    if global_state["compute_mode"] == "HTVS":
                        # UPDATED: Pull from PRECOMPUTED_3D_DB instead of regenerating
                        start = global_state["htvs_cursor"]
                        end = start + 2 
                        
                        if end > len(PRECOMPUTED_3D_DB):
                            start = 0
                            end = 2
                            
                        global_state["htvs_cursor"] = end
                        mining_job["docking_payload"] = PRECOMPUTED_3D_DB[start:end]

                    payload["mining_job"] = mining_job

                await manager.broadcast(json.dumps(payload))
        except Exception as e:
            print(f"Broadcast error: {e}")
        
        await asyncio.sleep(1)


# --- MQTT LISTENER ---
# UPDATED: Matches Wokwi code
async def mqtt_listener():
    while True:
        try:
            async with aiomqtt.Client("broker.emqx.io") as client:
                await client.subscribe("synapse/ingest/#")
                async for message in client.messages:
                    data_dict = json.loads(message.payload.decode())
                    bionexus_chain.add_pending_data(data_dict)
                    await manager.broadcast(json.dumps({
                        "type": "SENSOR_DATA", "payload": data_dict
                    }))
        except Exception as e:
            await asyncio.sleep(5)


# --- THE HTVS VALIDATOR HELPER ---
def verify_htvs_proof(payload, nonce, submitted_hash):
    # Ensure the hash is a double-SHA256 of the data + nonce
    data_str = json.dumps(payload, sort_keys=True)
    header = f"{data_str}{nonce}"
    # This must match the JS logic in worker.js exactly
    first = hashlib.sha256(header.encode()).digest()
    expected = hashlib.sha256(first).hexdigest()
    return expected == submitted_hash


# --- LIFECYCLE ROUTING ---
@app.on_event("startup")
async def startup_event():
    # Run pre-computation first
    asyncio.create_task(precompute_drug_matrices()) 
    asyncio.create_task(mqtt_listener())
    asyncio.create_task(network_state_broadcaster())


# --- API ENDPOINTS ---
@app.get("/")
def read_root():
    return {"status": "BioNexus Core Online"}

@app.get("/chain")
def get_chain():
    return bionexus_chain.get_chain() # Fetch from Redis

@app.get("/mempool")
def get_mempool():
    return bionexus_chain.get_mempool() # Fetch from Redis

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
            
            # Action 1: Generic Compute Ticks
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
                bio_payload = payload.get("payload") 

                if global_state["compute_mode"] == "HTVS" and bio_payload:
                    # OFF-CHAIN VALIDATION: Ensure the node isn't lying
                    # Note: Need to pass just the function to to_thread, then the args
                    is_valid = await asyncio.to_thread(verify_htvs_proof, bio_payload, nonce, submitted_hash)
                    
                    if is_valid:
                        new_block = bionexus_chain.create_htvs_block(bio_payload, nonce, submitted_hash)
                        await manager.broadcast(json.dumps({"type": "BLOCK_MINED", "block": new_block}))
                    else:
                        print(f"[SECURITY] REJECTED: Node {websocket.client.host if websocket.client else 'Unknown'} failed HTVS verification.")
                
                # STANDARD PHYSICS / CRYPTO VERIFICATION
                elif block_index and nonce is not None and submitted_hash:
                    success = await asyncio.to_thread(
                        bionexus_chain.validate_and_add_block, 
                        block_index, 
                        nonce, 
                        submitted_hash
                    )
                    
                    if success:
                        # YOU MUST DEFINE THE VARIABLE HERE FIRST
                        current_chain = bionexus_chain.get_chain()
                        await manager.broadcast(json.dumps({
                            "type": "BLOCK_MINED",
                            "block": current_chain[-1]
                        }))
                    else:
                        client_ip = websocket.client.host if websocket.client else "Unknown"
                        print(f"[CHAIN] REJECTED: Node {client_ip} submitted Proof of Work for a Ghost Root.")
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)
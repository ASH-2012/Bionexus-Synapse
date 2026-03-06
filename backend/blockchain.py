import os
import requests
import hashlib
import json
from datetime import datetime
import redis

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("WARNING: Supabase credentials missing. Off-chain indexing disabled.")
    
# --- REDIS CLOUD CONNECTION ---
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
r = redis.from_url(REDIS_URL, decode_responses=True)

def double_sha256(data: str) -> str:
    """Industry standard Double-SHA256 to prevent length extension attacks."""
    first_pass = hashlib.sha256(data.encode('utf-8')).digest()
    return hashlib.sha256(first_pass).hexdigest()

def build_merkle_root(leaves: list) -> str:
    """Recursively builds a Merkle root from a list of hashed leaves."""
    if not leaves:
        return "0" * 64
    if len(leaves) == 1:
        return leaves[0]

    new_level = []
    for i in range(0, len(leaves), 2):
        left = leaves[i]
        right = leaves[i + 1] if i + 1 < len(leaves) else left
        combined = left + right
        new_level.append(double_sha256(combined))

    return build_merkle_root(new_level)

def verify_biological_proof(bio_payload, submitted_nonce, submitted_hash):
    """
    Ensures the node didn't just 'make up' a success.
    The hash must be the double-SHA256 of (Data + Nonce).
    """
    # CRITICAL FIX: separators=(',', ':') forces Python to drop whitespace, matching JS JSON.stringify()
    data_string = json.dumps(bio_payload, sort_keys=True, separators=(',', ':'))
    header = f"{data_string}{submitted_nonce}"
    
    expected_hash = double_sha256(header)
    
    return expected_hash == submitted_hash

class BioGridChain:
    def __init__(self):
        self.difficulty = 2    
        
        if not r.exists("bionexus:chain"):
            self.create_genesis_block()

    def create_genesis_block(self):
        genesis_block = {
            "index": 1,
            "timestamp": datetime.now().isoformat(),
            "merkle_root": "0" * 64,
            "previous_hash": "0" * 64,
            "nonce": 0,
            "hash": "0" * 64,
            "data": []
        }
        r.rpush("bionexus:chain", json.dumps(genesis_block))

    def get_chain(self) -> list:
        return [json.loads(b) for b in r.lrange("bionexus:chain", 0, -1)]

    def get_mempool(self) -> list:
        return [json.loads(item) for item in r.lrange("bionexus:mempool", 0, -1)]

    def add_pending_data(self, data: dict):
        serialized_data = json.dumps(data, sort_keys=True, separators=(',', ':'))
        hashed_data = double_sha256(serialized_data)
        
        payload = {
            "raw": data,
            "hash": hashed_data
        }
        r.rpush("bionexus:mempool", json.dumps(payload))

    def get_mining_job(self) -> dict:
        mempool = self.get_mempool()
        if not mempool:
            return None
            
        last_block_json = r.lindex("bionexus:chain", -1)
        previous_block = json.loads(last_block_json)
        
        leaves = [item["hash"] for item in mempool]
        merkle_root = build_merkle_root(leaves)
        
        return {
            "index": previous_block["index"] + 1,
            "previous_hash": previous_block["hash"],
            "merkle_root": merkle_root,
            "difficulty": self.difficulty
        }

    # --- NEW: HTVS BLOCK CREATION ---
    def create_htvs_block(self, bio_payload: list, nonce: int, submitted_hash: str) -> dict:
        """Saves verified drug docking results into the ledger and mirrors to data lake."""
        current_chain = self.get_chain()
        last_block = current_chain[-1] if current_chain else {"hash": "0" * 64}
        
        htvs_block = {
            "index": len(current_chain) + 1,
            "timestamp": datetime.now().isoformat(),
            "data": bio_payload, 
            "nonce": nonce,
            "hash": submitted_hash,
            "merkle_root": "htvs_screening_batch",
            "previous_hash": last_block["hash"]
        }
        
        # Atomically push to Redis
        r.rpush("bionexus:chain", json.dumps(htvs_block))
        
        # Off-chain indexing to Supabase (Do not lose your HTVS data)
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        }
        try:
            requests.post(
                f"{SUPABASE_URL}/rest/v1/blocks", 
                headers=headers, 
                json=htvs_block,
                timeout=3 
            )
            print(f"[ARCHIVE] Biological HTVS Block {htvs_block['index']} archived to Supabase.")
        except Exception as e:
            print(f"Failed to mirror HTVS block to Supabase: {e}")

        return htvs_block

    def validate_and_add_block(self, block_index: int, nonce: int, submitted_hash: str) -> bool:
        job = self.get_mining_job()
        if not job or job["index"] != block_index:
            return False

        header = f"{job['index']}{job['previous_hash']}{job['merkle_root']}{nonce}"
        calculated_hash = double_sha256(header)

        if calculated_hash == submitted_hash and calculated_hash.startswith("0" * self.difficulty):
            mempool = self.get_mempool()
            new_block = {
                "index": job["index"],
                "timestamp": datetime.now().isoformat(),
                "merkle_root": job["merkle_root"],
                "previous_hash": job["previous_hash"],
                "nonce": nonce,
                "hash": calculated_hash,
                "data": [item["raw"] for item in mempool]
            }
            
            pipeline = r.pipeline()
            pipeline.rpush("bionexus:chain", json.dumps(new_block))
            pipeline.delete("bionexus:mempool")
            pipeline.execute()
            
            headers = {
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            }
            try:
                requests.post(
                    f"{SUPABASE_URL}/rest/v1/blocks", 
                    headers=headers, 
                    json=new_block,
                    timeout=3 
                )
                print(f"Block {new_block['index']} archived to Supabase.")
            except Exception as e:
                print(f"Failed to mirror to Supabase: {e}")

            return True
            
        return False
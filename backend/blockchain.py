import hashlib
import json
from datetime import datetime

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

class BioGridChain:
    def __init__(self):
        self.chain = []
        self.pending_data = [] # IoT payloads waiting to be secured
        self.difficulty = 2    # Target: Hash must start with 4 zeros ('0000')
        self.create_genesis_block()

    def create_genesis_block(self):
        """The hardcoded first block of the chain."""
        genesis_block = {
            "index": 1,
            "timestamp": datetime.now().isoformat(),
            "merkle_root": "0" * 64,
            "previous_hash": "0" * 64,
            "nonce": 0,
            "hash": "0" * 64,
            "data": []
        }
        self.chain.append(genesis_block)

    def add_pending_data(self, data: dict):
        """Adds incoming IoT data to the mempool."""
        # Enforce strict key sorting for deterministic hashing
        serialized_data = json.dumps(data, sort_keys=True, separators=(',', ':'))
        hashed_data = double_sha256(serialized_data)
        
        self.pending_data.append({
            "raw": data,
            "hash": hashed_data
        })

    def get_mining_job(self) -> dict:
        """Packages the current pending data for the React nodes to mine."""
        if not self.pending_data:
            return None
            
        previous_block = self.chain[-1]
        leaves = [item["hash"] for item in self.pending_data]
        merkle_root = build_merkle_root(leaves)
        
        return {
            "index": previous_block["index"] + 1,
            "previous_hash": previous_block["hash"],
            "merkle_root": merkle_root,
            "difficulty": self.difficulty
        }

    def validate_and_add_block(self, block_index: int, nonce: int, submitted_hash: str) -> bool:
        """Verifies the Proof-of-Work submitted by a WebGrid node."""
        job = self.get_mining_job()
        if not job or job["index"] != block_index:
            return False

        # Reconstruct the block header exactly as the node should have
        header = f"{job['index']}{job['previous_hash']}{job['merkle_root']}{nonce}"
        calculated_hash = double_sha256(header)

        # 1. Does the hash match what the node claims?
        # 2. Does it meet the difficulty requirement?
        if calculated_hash == submitted_hash and calculated_hash.startswith("0" * self.difficulty):
            # Mint the block
            new_block = {
                "index": job["index"],
                "timestamp": datetime.now().isoformat(),
                "merkle_root": job["merkle_root"],
                "previous_hash": job["previous_hash"],
                "nonce": nonce,
                "hash": calculated_hash,
                "data": [item["raw"] for item in self.pending_data]
            }
            self.chain.append(new_block)
            self.pending_data = [] # Clear the mempool
            return True
            
        return False
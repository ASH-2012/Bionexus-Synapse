// frontend/public/worker.js
import init, { Universe, calculate_binding_energy } from '/wasm/synapse_core.js';

let universe = null;
let memory = null;
let useWasm = false;
let jsParticles = [];
const width = 800;
const height = 600;

// --- TELEMETRY & MINING STATE ---
let hashAccumulator = 0;
let lastReportTime = Date.now();

let currentJob = null; 
let currentNonce = 0;
let isMining = false;
let computeMode = "PHYSICS"; 

// --- CRYPTO UTILS (Double-SHA256) ---
async function double_sha256(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hash1 = await crypto.subtle.digest('SHA-256', msgUint8);
  const hash2 = await crypto.subtle.digest('SHA-256', hash1);
  return Array.from(new Uint8Array(hash2))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// --- JS FALLBACK ENGINE ---
function tickJS() {
    const len = jsParticles.length;
    for (let i=0; i<len; i++) {
        let p1 = jsParticles[i];
        let fx = 0, fy = 0;
        for (let j=0; j<len; j++) {
            if (i === j) continue;
            let p2 = jsParticles[j];
            let dx = p2.x - p1.x;
            let dy = p2.y - p1.y;
            let distSq = dx*dx + dy*dy;
            if (distSq > 25 && distSq < 10000) {
                let f = 2.0 / distSq; 
                let dist = Math.sqrt(distSq);
                fx += f * (dx/dist);
                fy += f * (dy/dist);
            }
        }
        p1.vx += fx; p1.vy += fy;
    }
    for (let p of jsParticles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
    }
    return jsParticles; 
}

// --- WORKER MESSAGE HANDLER ---
self.onmessage = async function(e) {
    
    if (e.data.type === "INIT") {
        try {
            const wasm = await init('/wasm/synapse_core_bg.wasm');
            memory = wasm.memory;
            universe = Universe.new(5000, width, height);
            useWasm = true;
            self.postMessage({ type: "READY", mode: "RUST" });
        } catch (err) {
            useWasm = false;
            self.postMessage({ type: "READY", mode: "JS" });
        }
    }

    if (e.data.type === "MINING_JOB") {
        const job = e.data.job;
        computeMode = job.compute_mode || "PHYSICS"; 

        if (computeMode === "HTVS") {
            // --- BIOLOGICAL MODE: 3D DRUG DOCKING ---
            isMining = false; 
            let successfulHits = [];
            let actualOperations = 0;

            if (job.docking_payload && useWasm) { 
                for (const item of job.docking_payload) {
                    
                    // THE WASM BRIDGE: Execute the 3D calculation
                    const score = calculate_binding_energy(item.atoms);
                    
                    // REALITY-BASED TELEMETRY: Pairwise atom calculations
                    const N = item.atoms.length;
                    const pairwiseComparisons = (N * (N - 1)) / 2;
                    actualOperations += (pairwiseComparisons * 20); // ~20 FLOPs per pair
                    
                    if (score <= -8.0) {
                        // CRITICAL: Keys must be inserted in strict alphabetical order ('m' then 's')
                        // This ensures JS JSON.stringify() matches Python's sort_keys=True
                        successfulHits.push({ 
                            molecule: item.smiles, 
                            score: score.toFixed(2) 
                        });
                    }
                }
            }

            // Report the mathematically accurate operational load
            self.postMessage({ type: 'COMPUTE_TICK', hashes: actualOperations });

            // Submit the valid molecules to the Master Ledger
            if (successfulHits.length > 0) {
                const nonce = Math.floor(Math.random() * 1000000);
                
                // JavaScript stringifies without spaces by default
                const dataStr = JSON.stringify(successfulHits);
                const header = `${dataStr}${nonce}`;
                const validHash = await double_sha256(header);

                self.postMessage({
                    type: "BLOCK_SOLVED",
                    solution: {
                        index: job.index,
                        nonce: nonce,
                        hash: validHash,
                        payload: successfulHits 
                    }
                });
            }

        } else {
            // --- PHYSICS MODE: STANDARD CRYPTO MINING ---
            if(!currentJob || currentJob.merkle_root !== job.merkle_root) {
                currentJob = job;
                currentNonce = Math.floor(Math.random() * 1000000); 
                isMining = true;
            }
        }
    }

    if (e.data.type === "STEP") {
        if (computeMode === "HTVS") {
            self.postMessage({ type: "UPDATE", particles: new Float32Array(0) });
            return; 
        }

        let particles = null;
        let operationsThisStep = 0;
        
        if (useWasm && universe) {
            const particlesPtr = universe.tick();
            const wasmMemoryView = new Float32Array(memory.buffer, particlesPtr, 5000 * 2);
            particles = wasmMemoryView.slice();
            operationsThisStep = 5000 * 5000; 
        } else {
            const raw = tickJS();
            particles = new Float32Array(raw.length * 2);
            for (let i = 0; i < raw.length; i++) {
                particles[i*2] = raw[i].x;
                particles[i*2+1] = raw[i].y;
            }
            operationsThisStep = raw.length * raw.length;
        }

        if (isMining && currentJob) {
            for (let i = 0; i < 100; i++) {
                currentNonce++;
                const header = `${currentJob.index}${currentJob.previous_hash}${currentJob.merkle_root}${currentNonce}`;
                const hash = await double_sha256(header);
                
                if (hash.startsWith("0".repeat(currentJob.difficulty))) {
                    self.postMessage({
                        type: "BLOCK_SOLVED",
                        solution: {
                            index: currentJob.index,
                            nonce: currentNonce,
                            hash: hash
                        }
                    });
                    isMining = false; 
                    break;
                }
                operationsThisStep += 1; 
            }
        }

        hashAccumulator += operationsThisStep;
        const now = Date.now();
        if (now - lastReportTime >= 1000) {
            self.postMessage({ type: 'COMPUTE_TICK', hashes: hashAccumulator });
            hashAccumulator = 0; 
            lastReportTime = now;
        }

        self.postMessage({ type: "UPDATE", particles: particles }, [particles.buffer]);
    }
};
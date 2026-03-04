// frontend/public/worker.js
import init, { Universe } from '/wasm/synapse_core.js';

let universe = null;
let memory = null;
let useWasm = false;
let jsParticles = [];
const width = 800;
const height = 600;

// --- TELEMETRY & MINING STATE ---
let hashAccumulator = 0;
let lastReportTime = Date.now();

let currentJob = null; // Stores { index, merkle_root, difficulty, previous_hash }
let currentNonce = 0;
let isMining = false;

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

    // NEW: Receiving a mining job from the Python Ledger
    if (e.data.type === "MINING_JOB") {
        if(!currentJob || currentJob.merkle_root !== e.data.job.merkle_root) {
        currentJob = e.data.job;
        currentNonce = Math.floor(Math.random() * 1000000); // Random start to avoid collision with other nodes
        isMining = true;
        }
    }

    if (e.data.type === "STEP") {
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

        // --- THE MINING TASK (Interleaved) ---
        if (isMining && currentJob) {
            // Run exactly 100 hashing attempts per physics frame
            // This prevents the UI from lagging while keeping the hashrate high
            for (let i = 0; i < 100; i++) {
                currentNonce++;
                const header = `${currentJob.index}${currentJob.previous_hash}${currentJob.merkle_root}${currentNonce}`;
                
                // Note: crypto.subtle is async, but we wait for it to maintain order
                const hash = await double_sha256(header);
                
                // Check if we solved the puzzle (e.g., hash starts with '0000')
                if (hash.startsWith("0".repeat(currentJob.difficulty))) {
                    self.postMessage({
                        type: "BLOCK_SOLVED",
                        solution: {
                            index: currentJob.index,
                            nonce: currentNonce,
                            hash: hash
                        }
                    });
                    isMining = false; // Stop mining until next job
                    break;
                }
                operationsThisStep += 1; // Add hashes to the telemetry
            }
        }

        // --- TELEMETRY ---
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
// frontend/public/worker.js
import init, { Universe } from '/wasm/synapse_core.js';

let universe = null;
let memory = null;
let useWasm = false;
let jsParticles = [];
const width = 800;
const height = 600;

// --- JS FALLBACK ENGINE (The "Slow" Mode) ---
function initJS(count) {
    jsParticles = [];
    for(let i=0; i<count; i++) {
        jsParticles.push({
            x: Math.random() * width, y: Math.random() * height,
            vx: (Math.random()-0.5)*2, vy: (Math.random()-0.5)*2
        });
    }
}

function tickJS() {
    // O(N^2) Gravity Logic in pure JS
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
                let f = 5.0 / distSq; // Gravity strength
                let dist = Math.sqrt(distSq);
                fx += f * (dx/dist);
                fy += f * (dy/dist);
            }
        }
        p1.vx += fx; p1.vy += fy;
    }
    // Update
    for (let p of jsParticles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
    }
    return jsParticles; // Returns array of objects
}

// --- WORKER MESSAGE HANDLER ---
self.onmessage = async function(e) {
    if (e.data.type === "INIT") {
        try {
            // 1. Initialize WASM
            const wasm = await init('/wasm/synapse_core_bg.wasm');
            memory = wasm.memory;
            
            // 2. Create Universe in Rust (500 particles)
            universe = Universe.new(500, width, height);
            useWasm = true;
            console.log("🚀 [WORKER] Rust/WASM Engine Loaded & Active");
            
            // 3. Send "Ready" signal
            self.postMessage({ type: "READY", mode: "RUST" });
        } catch (err) {
            console.error("❌ [WORKER] WASM Failed, using JS Fallback", err);
            initJS(200); // Fewer particles for JS because it's slower
            useWasm = false;
            self.postMessage({ type: "READY", mode: "JS" });
        }
    }

    if (e.data.type === "STEP") {
        let particles = [];
        
        if (useWasm && universe) {
            // --- RUST PATH (Fast) ---
            const particlesPtr = universe.tick();
            // Read directly from WASM memory (Zero Copy)
            const cells = new Float64Array(memory.buffer, particlesPtr, 500 * 4);
            
            // Convert to simple array for sending to Main Thread
            // (In a real app, we'd transfer the buffer, but this is easier for now)
            particles = new Float32Array(500 * 2); // x, y only for rendering
            for (let i = 0; i < 500; i++) {
                particles[i*2] = cells[i*4];     // x
                particles[i*2+1] = cells[i*4+1]; // y
            }
        } else {
            // --- JS PATH (Slow) ---
            const raw = tickJS();
            particles = new Float32Array(raw.length * 2);
            for (let i = 0; i < raw.length; i++) {
                particles[i*2] = raw[i].x;
                particles[i*2+1] = raw[i].y;
            }
        }

        self.postMessage({ type: "UPDATE", particles: particles }, [particles.buffer]);
    }
};
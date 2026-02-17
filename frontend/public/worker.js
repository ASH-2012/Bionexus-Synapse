// public/worker.js
// A Real N-Body Gravity Simulation
// This runs 0(N^2) physics calculations to prove compute power.

let particles = [];
const G = 0.5; // Gravitational constant (tweaked for visuals)

self.onmessage = function(e) {
    if (e.data.type === "INIT") {
        // Create 200 random particles
        for(let i=0; i<200; i++) {
            particles.push({
                x: Math.random() * 800,
                y: Math.random() * 600,
                vx: (Math.random() - 0.5) * 2,
                vy: (Math.random() - 0.5) * 2,
                mass: Math.random() * 5 + 1
            });
        }
    }

    if (e.data.type === "STEP") {
        // 1. Calculate Forces (The heavy math part)
        for (let i = 0; i < particles.length; i++) {
            let p1 = particles[i];
            for (let j = 0; j < particles.length; j++) {
                if (i === j) continue;
                let p2 = particles[j];

                let dx = p2.x - p1.x;
                let dy = p2.y - p1.y;
                let dist = Math.sqrt(dx*dx + dy*dy);
                
                if (dist > 5 && dist < 300) { // Softening
                    let force = (G * p1.mass * p2.mass) / (dist * dist);
                    let fx = force * (dx / dist);
                    let fy = force * (dy / dist);

                    p1.vx += fx / p1.mass;
                    p1.vy += fy / p1.mass;
                }
            }
        }

        // 2. Update Positions
        for (let p of particles) {
            p.x += p.vx;
            p.y += p.vy;

            // Bounce off walls (optional)
            if (p.x < 0 || p.x > 800) p.vx *= -1;
            if (p.y < 0 || p.y > 600) p.vy *= -1;
        }

        // 3. Send data back to Main Thread to render
        self.postMessage({ type: "UPDATE", particles: particles });
    }
};
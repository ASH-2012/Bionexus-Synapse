'use client';
import { useEffect, useRef, useState } from 'react';

export default function SimulationCanvas({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const [fps, setFps] = useState(0);
  const [mode, setMode] = useState("INITIALIZING...");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // IMPORTANT: type: "module" is needed to import the WASM glue code
    workerRef.current = new Worker('/worker.js', { type: "module" });
    
    workerRef.current.postMessage({ type: "INIT" });

    let lastTime = performance.now();
    let frameCount = 0;

    workerRef.current.onmessage = (e) => {
        if (e.data.type === "READY") {
            setMode(e.data.mode); // "RUST" or "JS"
            if (active) workerRef.current?.postMessage({ type: "STEP" });
        }

        if (e.data.type === "UPDATE") {
            const particles = new Float32Array(e.data.particles);
            
            // 1. Clear Screen (Matrix Trail Effect)
            ctx!.fillStyle = 'rgba(0, 0, 0, 0.2)'; 
            ctx!.fillRect(0, 0, 800, 600);
            
            // 2. Draw Particles
            ctx!.beginPath();
            ctx!.fillStyle = mode === "RUST" ? '#00f3ff' : '#00ff41'; // Blue for Rust, Green for JS
            
            // The data is now [x1, y1, x2, y2, ...]
            for (let i = 0; i < particles.length; i += 2) {
                const x = particles[i];
                const y = particles[i+1];
                ctx!.moveTo(x, y);
                ctx!.arc(x, y, 2, 0, Math.PI * 2);
            }
            ctx!.fill();

            // 3. FPS Calculation
            frameCount++;
            const now = performance.now();
            if (now - lastTime >= 1000) {
                setFps(frameCount);
                frameCount = 0;
                lastTime = now;
            }

            // 4. Next Frame
            if (active) {
                workerRef.current?.postMessage({ type: "STEP" });
            }
        }
    };

    return () => workerRef.current?.terminate();
  }, [active]);

  return (
    <div className="relative w-full h-full">
        {/* HUD Overlay */}
        <div className="absolute top-2 right-2 flex gap-2">
            <div className="bg-black/80 border border-green-800 px-2 py-1 text-xs text-green-400 font-mono">
                ENGINE: <span className={mode === "RUST" ? "text-blue-400 font-bold" : "text-yellow-500"}>{mode}</span>
            </div>
            <div className="bg-black/80 border border-green-800 px-2 py-1 text-xs text-green-400 font-mono">
                FPS: {fps}
            </div>
        </div>

        <canvas 
            ref={canvasRef} 
            width={800} 
            height={600} 
            className="w-full h-full bg-black rounded border border-green-900 shadow-[0_0_20px_rgba(0,255,65,0.1)]"
        />
    </div>
  );
}
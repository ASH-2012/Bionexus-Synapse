'use client';
import { useEffect, useRef, useState } from 'react';

// 1. THE FIXED INTERFACE
interface Props {
  active: boolean;
  miningJob: any; // <-- YOU MISSED THIS: The Canvas must receive the job from the Server
  onComputeTick: (hashes: number) => void;
  onBlockSolved: (solution: any) => void;
}

export default function SimulationCanvas({ active, miningJob, onComputeTick, onBlockSolved }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const activeRef = useRef(active); 
  const [fps, setFps] = useState(0);
  const [mode, setMode] = useState("INITIALIZING...");

  useEffect(() => {
      activeRef.current = active;
      if (active && workerRef.current) {
          workerRef.current.postMessage({ type: "STEP" });
      }
  }, [active]);

  // 2. THE MISSING DISPATCHER
  // This tells the Web Worker WHAT to mine when the server sends a new job.
  useEffect(() => {
      if (miningJob && workerRef.current) {
          workerRef.current.postMessage({ 
              type: "MINING_JOB", 
              job: miningJob 
          });
      }
  }, [miningJob]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    workerRef.current = new Worker('/worker.js', { type: "module" });
    workerRef.current.postMessage({ type: "INIT" });

    let lastTime = performance.now();
    let frameCount = 0;

    workerRef.current.onmessage = (e) => {
        if (e.data.type === "READY") {
            setMode(e.data.mode); 
            if (activeRef.current) workerRef.current?.postMessage({ type: "STEP" });
        }

        if (e.data.type === "COMPUTE_TICK") {
            onComputeTick(e.data.hashes);
        }

        if (e.data.type === "UPDATE") {
            const particles = new Float32Array(e.data.particles);
            
            ctx!.fillStyle = 'rgba(0, 0, 0, 0.2)'; 
            ctx!.fillRect(0, 0, 800, 600);
            
            ctx!.beginPath();
            ctx!.fillStyle = mode === "RUST" ? '#00f3ff' : '#00ff41'; 
            
            for (let i = 0; i < particles.length; i += 2) {
                const x = particles[i];
                const y = particles[i+1];
                ctx!.moveTo(x + 2, y);
                ctx!.arc(x, y, 2, 0, Math.PI * 2);
            }
            ctx!.fill();

            frameCount++;
            const now = performance.now();
            if (now - lastTime >= 1000) {
                setFps(frameCount);
                frameCount = 0;
                lastTime = now;
            }

            if (activeRef.current) {
                requestAnimationFrame(() => {
                    workerRef.current?.postMessage({ type: "STEP" });
                });
            }
        } // <--- 3. THE UPDATE BLOCK STRICTLY ENDS HERE

        // THE FIXED BRIDGE: This is now OUTSIDE the update block.
        if (e.data.type === "BLOCK_SOLVED") {
            onBlockSolved(e.data.solution);
        }
    };

    return () => workerRef.current?.terminate();
  }, []); 

  return (
    <div className="relative w-full h-full">
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
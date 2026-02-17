'use client';
import { useEffect, useRef } from 'react';

export default function SimulationCanvas({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Initialize Worker
    workerRef.current = new Worker('/worker.js');
    workerRef.current.postMessage({ type: "INIT" });

    workerRef.current.onmessage = (e) => {
        if (e.data.type === "UPDATE") {
            const particles = e.data.particles;
            
            // Render Frame
            ctx!.fillStyle = 'rgba(0, 0, 0, 0.2)'; // Trails effect
            ctx!.fillRect(0, 0, 800, 600);
            
            particles.forEach((p: any) => {
                const speed = Math.sqrt(p.vx*p.vx + p.vy*p.vy);
                ctx!.beginPath();
                ctx!.arc(p.x, p.y, p.mass, 0, Math.PI * 2);
                // Color based on speed (Heatmap style)
                ctx!.fillStyle = speed > 2 ? '#00ff41' : '#008F11'; 
                ctx!.fill();
            });

            // Request next frame from worker
            if (active) {
                workerRef.current?.postMessage({ type: "STEP" });
            }
        }
    };

    // Kickstart
    if (active) workerRef.current.postMessage({ type: "STEP" });

    return () => workerRef.current?.terminate();
  }, [active]);

  return (
    <canvas 
        ref={canvasRef} 
        width={800} 
        height={600} 
        className="w-full h-full bg-black rounded border border-green-900 shadow-[0_0_20px_rgba(0,255,65,0.2)]"
    />
  );
}
'use client';
import { useState, useEffect, useRef } from 'react';
import { Activity, Cpu, Network, Lock, Zap, Server } from 'lucide-react';
import { motion } from 'framer-motion';
// 1. Import the canvas component
import SimulationCanvas from '../components/SimulationCanvas';

export default function Home() {
  // State
  const [isConnected, setIsConnected] = useState(false);
  const [workerStatus, setWorkerStatus] = useState('IDLE');
  const [hashes, setHashes] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [nodes, setNodes] = useState(1); // Start with 1 node (You)
  
  // Refs
  const workerRef = useRef<Worker | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

// 1. Initialize System
  useEffect(() => {
    // A. Start Web Worker (The "Compute" Layer)
    workerRef.current = new Worker('/worker.js');
    workerRef.current.onmessage = (event) => {
      // 1. Handle Compute Results (from Rust/JS)
      if (event.data.type === 'UPDATE') {
         // If you had a setParticles(event.data.particles) you'd use it here
         // For now, we just count hashes to show "work" is happening
         setHashes((prev) => prev + 1500); 
      }
      if (event.data.type === 'PROGRESS') {
        setHashes((prev) => prev + 5000);
      }
    };

    // B. Connect to Python Backend (The "Network" Layer)
    wsRef.current = new WebSocket('ws://127.0.0.1:8000/ws');
    
    wsRef.current.onopen = () => {
      setIsConnected(true);
      addLog('SYSTEM: Connected to BioNexus Core');
    };
    
    wsRef.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        // --- THIS WAS MISSING ---
        // 2. Handle Sensor Data (From Python/Ghost Hardware)
        if (message.type === 'SENSOR_DATA') {
            const { temp, ph, turbidity } = message.payload;
            addLog(`[IOT] RX: Temp ${temp}°C | pH ${ph} | OD ${turbidity}`);
            
            // Optional: Spike the hash rate when data comes in to make it look active
            setHashes((prev) => prev + 120); 
        }
        // ------------------------

        if (message.live_status) {
           // Heartbeat
        }
      } catch (e) {
        console.error("WS Parse Error", e);
      }
    };

    wsRef.current.onclose = () => setIsConnected(false);

    return () => {
      workerRef.current?.terminate();
      wsRef.current?.close();
    };
  }, []);

  // Helpers
  const addLog = (msg: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 10)]);
  };

  const toggleCompute = () => {
    if (workerStatus === 'IDLE') {
      workerRef.current?.postMessage('START');
      setWorkerStatus('PROCESSING');
      addLog('GRID: Compute Node Activated. Folding Proteins...');
    } else {
      // In a real app we'd stop it, but for demo, let it run or refresh
      alert("Compute job running. Refresh to stop.");
    }
  };

  const simulateNetwork = () => {
    setNodes((prev) => prev + Math.floor(Math.random() * 3) + 1);
    addLog('NETWORK: New Worker Node joined from IISER_LAB_04');
  };

  return (
    <main className="min-h-screen p-8 bg-black text-green-400 selection:bg-green-900">
      {/* Header */}
      <header className="flex justify-between items-center border-b border-green-800 pb-4 mb-8">
        <div>
          <h1 className="text-4xl font-bold tracking-tighter flex items-center gap-3">
            <Network className="w-10 h-10" /> BIONEXUS <span className="text-white">SYNAPSE</span>
          </h1>
          <p className="text-sm text-green-600 mt-1">DISTRIBUTED BIOLOGICAL COMPUTING GRID</p>
        </div>
        <div className="flex gap-4 text-right">
          <div className="flex flex-col">
            <span className="text-xs text-gray-500">SERVER STATUS</span>
            <span className={`font-bold ${isConnected ? 'text-blue-400' : 'text-red-500'}`}>
              {isConnected ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-gray-500">ACTIVE NODES</span>
            <span className="font-bold text-white text-xl">{nodes}</span>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Panel 1: The Compute Engine */}
        <div className="md:col-span-2 space-y-6">
          <div className="border border-green-800 bg-green-900/10 p-6 rounded-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 p-2 opacity-20">
              <Cpu className="w-24 h-24" />
            </div>
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Activity /> LOCAL COMPUTE NODE
            </h2>
            
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-black/50 p-4 rounded border border-green-900">
                <p className="text-xs text-gray-400">HASH RATE</p>
                <p className="text-2xl font-mono text-white">{hashes.toLocaleString()} H/s</p>
              </div>
              <div className="bg-black/50 p-4 rounded border border-green-900">
                <p className="text-xs text-gray-400">JOB STATUS</p>
                <p className={`text-xl font-bold ${workerStatus === 'PROCESSING' ? 'animate-pulse text-yellow-400' : 'text-gray-500'}`}>
                  {workerStatus}
                </p>
              </div>
            </div>

            <button 
              onClick={toggleCompute}
              className="w-full bg-green-600 hover:bg-green-500 text-black font-bold py-3 rounded transition-all flex justify-center items-center gap-2"
            >
              {workerStatus === 'IDLE' ? <><Zap /> CONTRIBUTE CPU POWER</> : 'PROCESSING...'}
            </button>
          </div>

          {/* 2. LIVE SIMULATION CANVAS REPLACEMENT */}
          <div className="border border-green-800 bg-black p-1 rounded-lg h-96 relative overflow-hidden">
              <div className="absolute top-2 left-4 z-10 bg-black/50 px-2 rounded text-xs text-green-400">
                LIVE SIMULATION: PROTEIN FOLDING DYNAMICS (N-BODY)
              </div>
              {/* Passes the 'PROCESSING' status to start/stop the animation */}
              <SimulationCanvas active={workerStatus === 'PROCESSING'} />
          </div>
        </div>

        {/* Panel 2: The Vault / Logs */}
        <div className="border border-green-800 bg-green-900/5 p-6 rounded-lg flex flex-col h-[600px]">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Lock /> SYNAPSE VAULT
          </h2>
          <div className="flex-1 overflow-y-auto font-mono text-xs space-y-2 pr-2">
            {logs.map((log, i) => (
              <div key={i} className="border-l-2 border-green-600 pl-2 py-1 bg-black/40">
                {log}
              </div>
            ))}
            {hashes > 0 && (
               <div className="text-yellow-500 mt-2">
                  [CHAIN] Block verified: {Math.random().toString(36).substring(7)}...
               </div>
            )}
          </div>
          
          <div className="mt-4 pt-4 border-t border-green-900">
             <div className="flex items-center gap-2 text-sm">
                <Server className="w-4 h-4" />
                <span>Blockchain Height: {Math.floor(hashes / 1000)}</span>
             </div>
          </div>
        </div>

      </div>
    </main>
  );
}
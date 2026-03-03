'use client';
import { useState, useEffect, useRef } from 'react';
import { Activity, Cpu, Network, Lock, Zap, Server } from 'lucide-react';
import SimulationCanvas from '../components/SimulationCanvas';

export default function Home() {
  const [isConnected, setIsConnected] = useState(false);
  const [workerStatus, setWorkerStatus] = useState<'IDLE' | 'PROCESSING'>('IDLE');
  
  const [localHashes, setLocalHashes] = useState(0);
  const [networkHashes, setNetworkHashes] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [nodes, setNodes] = useState(1); 
  const [chainHeight, setChainHeight] = useState(0);
  const [currentMiningJob, setCurrentMiningJob] = useState<any>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const offlineBufferRef = useRef<number>(0); 

  // 1. Fault-Tolerant Network Layer
  useEffect(() => {
    const connectWebSocket = () => {
      const host = window.location.hostname;
      wsRef.current = new WebSocket(`ws://${host}:8000/ws`);
      
      wsRef.current.onopen = () => {
        setIsConnected(true);
        addLog('SYSTEM: Connected to BioNexus Core');
        if (offlineBufferRef.current > 0) {
          wsRef.current?.send(JSON.stringify({
            action: "COMPUTE_TICK",
            hashes: offlineBufferRef.current
          }));
          addLog(`[SYNC] Flushed ${offlineBufferRef.current.toLocaleString()} buffered ops.`);
          offlineBufferRef.current = 0;
        }
      };
      
      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          switch (message.type) {
            case 'NETWORK_STATE':
              setNodes(message.nodes);
              setNetworkHashes(message.total_hashes || 0);
              setChainHeight(message.chain_height || 0);

              // THE RELAY: Save the job so it flows down to the canvas
              if (message.mining_job) {
                setCurrentMiningJob(message.mining_job);
              }
              break;
            case 'BLOCK_MINED':
              addLog(`[GRID] Block ${message.block.index} forged! Hash: ${message.block.hash.substring(0, 8)}...`);
              break;
            case 'SENSOR_DATA':
              addLog(`[IOT] RX: Temp ${message.payload.temp}°C | pH ${message.payload.ph}`);
              break;
          }
        } catch (e) { console.error("WS Parse Error", e); }
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        addLog('SYSTEM: Connection Lost. Retrying in 3s...');
        reconnectTimeoutRef.current = setTimeout(connectWebSocket, 3000);
      };
    };

    connectWebSocket();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, []);

  const addLog = (msg: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 10)]);
  };

  // --- THE NEW BLOCKCHAIN BRIDGES ---

  const handleComputeTick = (hashes: number) => {
    setLocalHashes((prev) => prev + hashes);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "COMPUTE_TICK", hashes }));
    } else {
      offlineBufferRef.current += hashes;
    }
  };

  const handleBlockSolved = (solution: any) => {
    addLog(`[MINER] Solution Found! Nonce: ${solution.nonce}`);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        action: "SUBMIT_BLOCK",
        ...solution
      }));
    }
  };

  return (
    <main className="min-h-screen p-8 bg-black text-green-400 selection:bg-green-900">
      <header className="flex justify-between items-center border-b border-green-800 pb-4 mb-8">
        <div>
          <h1 className="text-4xl font-bold tracking-tighter flex items-center gap-3">
            <Network className="w-10 h-10" /> BIONEXUS <span className="text-white">SYNAPSE</span>
          </h1>
          <p className="text-sm text-green-600 mt-1">DISTRIBUTED BIOLOGICAL COMPUTING GRID</p>
        </div>
        <div className="flex gap-4">
          <div className="text-right">
            <span className="text-xs text-gray-500 block">STATUS</span>
            <span className={`font-bold ${isConnected ? 'text-blue-400' : 'text-red-500'}`}>
              {isConnected ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          <div className="text-right">
            <span className="text-xs text-gray-500 block">NODES</span>
            <span className="font-bold text-white text-xl">{nodes}</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="border border-green-800 bg-green-900/10 p-6 rounded-lg relative overflow-hidden">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Activity /> LOCAL COMPUTE NODE</h2>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-black/50 p-4 rounded border border-green-900">
                <p className="text-xs text-gray-400">LOCAL HASHRATE</p>
                <p className="text-2xl font-mono text-white">{localHashes.toLocaleString()} Ops</p>
              </div>
              <div className="bg-black/50 p-4 rounded border border-blue-900">
                <p className="text-xs text-blue-400">GLOBAL GRID POWER</p>
                <p className="text-2xl font-mono text-blue-300">{networkHashes.toLocaleString()} Ops</p>
              </div>
            </div>
            <button 
              onClick={() => setWorkerStatus(prev => prev === 'IDLE' ? 'PROCESSING' : 'IDLE')}
              className={`w-full font-bold py-3 rounded transition-all flex justify-center items-center gap-2 ${
                workerStatus === 'IDLE' ? 'bg-green-600 text-black' : 'bg-red-900 text-white'
              }`}
            >
              {workerStatus === 'IDLE' ? <><Zap /> CONTRIBUTE CPU POWER</> : 'STOP COMPUTATION'}
            </button>
          </div>

          <div className="border border-green-800 bg-black rounded-lg h-96 relative overflow-hidden">
            <SimulationCanvas 
              active={workerStatus === 'PROCESSING'} 
              miningJob={currentMiningJob}
              onComputeTick={handleComputeTick}
              onBlockSolved={handleBlockSolved}
            />
          </div>
        </div>

        <div className="border border-green-800 bg-green-900/5 p-6 rounded-lg flex flex-col h-[600px]">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Lock /> SYNAPSE VAULT</h2>
          <div className="flex-1 overflow-y-auto font-mono text-xs space-y-2">
            {logs.map((log, i) => (
              <div key={i} className="border-l-2 border-green-600 pl-2 py-1 bg-black/40">{log}</div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-green-900">
            <div className="flex items-center gap-2 text-sm">
              <Server className="w-4 h-4" />
              <span>Blockchain Height: {chainHeight} Blocks</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
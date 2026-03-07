'use client';
import { useState, useEffect, useRef } from 'react';
import { Activity, Cpu, Network, Lock, Zap, Server, X, Database, Code } from 'lucide-react';
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
  
  // --- EXPLORER STATE ---
  const [blocks, setBlocks] = useState<any[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<any | null>(null);
  const [viewRaw, setViewRaw] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const offlineBufferRef = useRef<number>(0); 

  useEffect(() => {
    setViewRaw(false);
  }, [selectedBlock]);

  // --- FIX 2: THE 502 HTML TRAP ---
  useEffect(() => {
    fetch(`https://bionexus-synapse-production.up.railway.app/chain`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          throw new TypeError("Received non-JSON response from server");
        }
        return res.json();
      })
      .then(data => setBlocks(data))
      .catch(err => {
        console.error("Failed to fetch chain. Backend may be sleeping:", err);
      });
  }, []);

  useEffect(() => {
    const connectWebSocket = () => {
      wsRef.current = new WebSocket(`wss://bionexus-synapse-production.up.railway.app/ws`);
      
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
              if (message.mining_job) setCurrentMiningJob(message.mining_job);
              break;
            case 'BLOCK_MINED':
              addLog(`[GRID] Block ${message.block.index} forged! Hash: ${message.block.hash.substring(0, 8)}...`);
              setBlocks(prev => [...prev, message.block]);
              break;
            case 'SENSOR_DATA':
              addLog(`[IOT] RX: Temp ${message.payload.temp}°C | Turbidity ${message.payload.turbidity}`);
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
    
    // --- FIX 3: THE RECONNECTION MEMORY LEAK ---
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, []);

  const switchComputeMode = async (newMode: string) => {
    try {
      addLog(`SYSTEM: Instructing Master Node to switch to ${newMode} mode...`);
      await fetch(`https://bionexus-synapse-production.up.railway.app/api/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });
    } catch (error) {
      console.error("Failed to switch mode", error);
      addLog(`SYSTEM ERROR: Failed to contact Master Node.`);
    }
  };

  const addLog = (msg: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 10)]);
  };

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
      wsRef.current.send(JSON.stringify({ action: "SUBMIT_BLOCK", ...solution }));
    }
  };

  return (
    <main className="min-h-screen p-8 bg-black text-green-400 selection:bg-green-900 relative">
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
                workerStatus === 'IDLE' ? 'bg-green-600 hover:bg-green-500 text-black' : 'bg-red-900 hover:bg-red-800 text-white'
              }`}
            >
              {workerStatus === 'IDLE' ? <><Zap /> CONTRIBUTE CPU POWER</> : 'STOP COMPUTATION'}
            </button>
          </div>

          <div className="flex gap-4 mt-4">
            <button
              onClick={() => switchComputeMode("PHYSICS")}
              className="w-full bg-blue-900/50 hover:bg-blue-800 text-blue-400 border border-blue-700/50 font-mono text-sm py-2 px-4 rounded transition-colors"
            >
              [ ENABLE N-BODY PHYSICS ]
            </button>
            <button
              onClick={() => switchComputeMode("HTVS")}
              className="w-full bg-purple-900/50 hover:bg-purple-800 text-purple-400 border border-purple-700/50 font-mono text-sm py-2 px-4 rounded transition-colors"
            >
              [ ENABLE HTVS DRUG DOCKING ]
            </button>
          </div>

          <div className="border border-green-800 bg-black rounded-lg h-[400px] relative overflow-hidden">
            <SimulationCanvas 
              active={workerStatus === 'PROCESSING'} 
              miningJob={currentMiningJob}
              onComputeTick={handleComputeTick}
              onBlockSolved={handleBlockSolved}
            />
          </div>
        </div>

        {/* --- THE VISUAL LEDGER --- */}
        <div className="border border-green-800 bg-green-900/5 p-6 rounded-lg flex flex-col h-[700px]">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2"><Lock /> SYNAPSE VAULT</h2>
          
          <div className="h-48 overflow-y-auto font-mono text-xs space-y-2 mb-4 border-b border-green-900 pb-4">
            {logs.map((log, i) => (
              <div key={i} className="border-l-2 border-green-600 pl-2 py-1 bg-black/40">{log}</div>
            ))}
          </div>

          <h3 className="text-sm font-bold mb-2 flex items-center gap-2 text-blue-400"><Database className="w-4 h-4"/> VERIFIED LEDGER</h3>
          <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
            {blocks.slice().reverse().map((block) => (
              <div 
                key={block.index} 
                onClick={() => setSelectedBlock(block)}
                className="bg-black border border-green-800 hover:border-blue-500 p-3 rounded cursor-pointer transition-colors group relative"
              >
                <div className="absolute top-0 right-0 bg-green-900 text-black text-[10px] font-bold px-2 py-1 rounded-bl group-hover:bg-blue-500 transition-colors">
                  BLK #{block.index}
                </div>
                <p className="text-xs text-gray-500 mb-1">HASH</p>
                <p className="text-xs font-mono text-green-400 truncate">{block.hash}</p>
                <div className="flex justify-between mt-2 pt-2 border-t border-green-900/50">
                   <span className="text-[10px] text-gray-500">NONCE: {block.nonce}</span>
                   <span className="text-[10px] text-gray-500">{new Date(block.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
            {blocks.length === 0 && (
                <div className="text-xs text-gray-600 text-center italic mt-10">Awaiting Genesis Sync...</div>
            )}
          </div>
        </div>
      </div>

      {/* --- BLOCK INSPECTOR MODAL --- */}
      {selectedBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0a0f0d] border border-blue-500 p-6 rounded-lg w-full max-w-3xl shadow-[0_0_30px_rgba(59,130,246,0.15)] max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-6 border-b border-blue-900 pb-4">
              <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                <Lock className="text-blue-500" /> BLOCK #{selectedBlock.index} INSPECTOR
              </h2>
              <button onClick={() => setSelectedBlock(null)} className="text-gray-500 hover:text-red-500 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mb-6 text-sm font-mono flex-shrink-0">
              <div className="bg-black p-3 rounded border border-green-900">
                <span className="text-gray-500 block text-xs mb-1">TIMESTAMP</span>
                <span className="text-white">{new Date(selectedBlock.timestamp).toLocaleString()}</span>
              </div>
              <div className="bg-black p-3 rounded border border-green-900">
                <span className="text-gray-500 block text-xs mb-1">NONCE (PROOF OF WORK)</span>
                <span className="text-yellow-400">{selectedBlock.nonce.toLocaleString()}</span>
              </div>
              <div className="bg-black p-3 rounded border border-green-900 col-span-2">
                <span className="text-gray-500 block text-xs mb-1">CRYPTOGRAPHIC HASH</span>
                <span className="text-green-400 break-all">{selectedBlock.hash}</span>
              </div>
              <div className="bg-black p-3 rounded border border-green-900 col-span-2">
                <span className="text-gray-500 block text-xs mb-1">MERKLE ROOT</span>
                <span className="text-blue-400 break-all">{selectedBlock.merkle_root}</span>
              </div>
            </div>

            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-bold text-gray-400">
                {selectedBlock.merkle_root === "htvs_screening_batch" ? "VERIFIED BIOLOGICAL HITS" : "SENSOR PAYLOAD"}
              </h3>
              {selectedBlock.merkle_root === "htvs_screening_batch" && (
                <button 
                  onClick={() => setViewRaw(!viewRaw)}
                  className="flex items-center gap-1 text-[10px] font-mono bg-blue-900/30 hover:bg-blue-900/60 text-blue-400 px-2 py-1 rounded border border-blue-900/50 transition-colors"
                >
                  <Code className="w-3 h-3" />
                  {viewRaw ? "[ SHOW UI FORMAT ]" : "[ SHOW RAW JSON ]"}
                </button>
              )}
            </div>

            <div className="bg-black border border-green-800 rounded-lg flex-1 overflow-y-auto">
              {selectedBlock.merkle_root === "htvs_screening_batch" && !viewRaw ? (
                <div className="bg-black/50 p-4 rounded font-mono text-[10px] text-gray-400 border border-purple-900/20">
                  {/* --- FIX 1: THE ARRAY FALLBACK --- */}
                  {(Array.isArray(selectedBlock.data) ? selectedBlock.data : []).map((hit: any, idx: number) => (
                    <div key={idx} className="border-b border-purple-900/30 pb-4 mb-4 last:border-0 last:mb-0 last:pb-0">
                      <div className="flex justify-between text-xs mb-3">
                        <span className="text-purple-400 font-bold">CANDIDATE #{idx + 1}</span>
                        <span className="text-white font-mono bg-purple-900/50 px-2 py-1 rounded">
                          ENERGY: {hit.score} kcal/mol
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-6">
                        <div className="bg-white/10 p-2 rounded flex-shrink-0">
                          <img 
                            src={`https://cactus.nci.nih.gov/chemical/structure/${encodeURIComponent(hit.molecule)}/image?width=150&height=150`}
                            alt="Molecular Structure"
                            className="w-24 h-24 object-contain invert" 
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="red">API ERROR</text></svg>';
                            }}
                          />
                        </div>
                        
                        <div className="break-all text-[9px] text-gray-500 leading-relaxed">
                          <span className="text-gray-400 block mb-1">SMILES SEQUENCE:</span>
                          {hit.molecule}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <pre className="p-4 font-mono text-xs text-green-300 whitespace-pre-wrap break-all">
                  {JSON.stringify(selectedBlock.data, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
import React, { useState } from 'react';
import { motion } from 'framer-motion';

const ConfigSimulator = () => {
    const [config, setConfig] = useState({
        "agent.mode": "autonomous",
        "memory.ltm_enabled": true,
        "voice.transcription": true,
        "rag.max_context_tokens": 8192,
        "tools.allow_unsafe": false
    });

    const updateConfig = (key, value) => {
        setConfig(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div className="w-full max-w-4xl mx-auto rounded-3xl glass-panel border border-white/10 overflow-hidden grid grid-cols-1 md:grid-cols-2 shadow-2xl">
            {/* Left: Controls */}
            <div className="p-8 bg-[#0a0f16]/80 flex flex-col gap-6 border-b md:border-b-0 md:border-r border-white/5">
                <div>
                    <h3 className="text-xl font-bold text-white mb-2">Runtime Configuration</h3>
                    <p className="text-sm text-slate-400">Tweak Sage's core behavior directly. See the payload update in real-time.</p>
                </div>

                <div className="space-y-5">
                    {/* Toggle: LTM Enabled */}
                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-white text-sm font-medium block">Long-Term Memory</span>
                            <span className="text-slate-500 text-xs">GraphRAG summary injection</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => updateConfig("memory.ltm_enabled", !config["memory.ltm_enabled"])}
                            role="switch"
                            aria-checked={config["memory.ltm_enabled"]}
                            aria-label="Toggle long-term memory"
                            className={`w-12 h-6 rounded-full p-1 transition-colors ${config["memory.ltm_enabled"] ? 'bg-[#78b846]' : 'bg-slate-700'}`}
                        >
                            <motion.div
                                layout
                                className="w-4 h-4 bg-white rounded-full shadow-md"
                                animate={{ x: config["memory.ltm_enabled"] ? 24 : 0 }}
                            />
                        </button>
                    </div>

                    {/* Toggle: Voice Transcription */}
                    <div className="flex items-center justify-between">
                        <div>
                            <span className="text-white text-sm font-medium block">Voice Transcription</span>
                            <span className="text-slate-500 text-xs">Active audio stream processing</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => updateConfig("voice.transcription", !config["voice.transcription"])}
                            role="switch"
                            aria-checked={config["voice.transcription"]}
                            aria-label="Toggle voice transcription"
                            className={`w-12 h-6 rounded-full p-1 transition-colors ${config["voice.transcription"] ? 'bg-[#78b846]' : 'bg-slate-700'}`}
                        >
                            <motion.div
                                layout
                                className="w-4 h-4 bg-white rounded-full shadow-md"
                                animate={{ x: config["voice.transcription"] ? 24 : 0 }}
                            />
                        </button>
                    </div>

                    {/* Slider: Context Tokens */}
                    <div>
                        <div className="flex justify-between mb-2">
                            <span className="text-white text-sm font-medium">Max Context Tokens</span>
                            <span className="text-[#a9df7c] text-xs font-mono">{config["rag.max_context_tokens"]}</span>
                        </div>
                        <input
                            type="range"
                            min="4096"
                            max="32768"
                            step="1024"
                            value={config["rag.max_context_tokens"]}
                            onChange={(e) => updateConfig("rag.max_context_tokens", parseInt(e.target.value, 10))}
                            aria-label="Adjust max context tokens"
                            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-[#78b846]"
                        />
                    </div>

                    {/* Select: Mode */}
                    <div>
                        <span className="text-white text-sm font-medium block mb-2">Agent Mode</span>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => updateConfig("agent.mode", "autonomous")}
                                aria-pressed={config["agent.mode"] === "autonomous"}
                                className={`py-2 text-xs font-medium rounded-lg border transition-all ${config["agent.mode"] === "autonomous" ? 'bg-[#78b846]/20 border-[#78b846] text-[#a9df7c]' : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10'}`}
                            >
                                Autonomous
                            </button>
                            <button
                                type="button"
                                onClick={() => updateConfig("agent.mode", "copilot")}
                                aria-pressed={config["agent.mode"] === "copilot"}
                                className={`py-2 text-xs font-medium rounded-lg border transition-all ${config["agent.mode"] === "copilot" ? 'bg-[#78b846]/20 border-[#78b846] text-[#a9df7c]' : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10'}`}
                            >
                                Copilot Only
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right: The "Nerve Center" Visualizer */}
            {/* Right: The "Nerve Center" Visualizer */}
            <div className="p-0 bg-[#06080c] relative flex flex-col items-center justify-center overflow-hidden min-h-[500px]">
                {/* Background Textures */}
                <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+CjxwYXRoIGQ9Ik0gMjAgMCBMIDAgMCAwIDIwIiBmaWxsPSJub25lIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiIHN0cm9rZS13aWR0aD0iMSIvPgo8L3N2Zz4=')] opacity-30"></div>
                <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] rounded-full blur-[100px] transition-colors duration-1000 ${config["agent.mode"] === "autonomous" ? 'bg-[#78b846]/10' : 'bg-[#e0af68]/10'}`}></div>

                {/* Connecting Lines (Responsive) */}
                <svg className="absolute top-0 left-0 w-full h-full pointer-events-none z-10">
                    {/* LTM to Brain */}
                    <line x1="30%" y1="35%" x2="50%" y2="55%" stroke="rgba(255,255,255,0.05)" strokeWidth="2" />
                    {config["memory.ltm_enabled"] && (
                        <motion.line
                            x1="30%" y1="35%" x2="50%" y2="55%"
                            stroke="rgba(187,154,247,0.4)"
                            strokeWidth="2"
                            strokeDasharray="6 6"
                            animate={{ strokeDashoffset: [0, -12] }}
                            transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                        />
                    )}
                    {/* Audio to Brain */}
                    <line x1="70%" y1="35%" x2="50%" y2="55%" stroke="rgba(255,255,255,0.05)" strokeWidth="2" />
                    {config["voice.transcription"] && (
                        <motion.line
                            x1="70%" y1="35%" x2="50%" y2="55%"
                            stroke="rgba(122,162,247,0.4)"
                            strokeWidth="2"
                            strokeDasharray="6 6"
                            animate={{ strokeDashoffset: [0, -12] }}
                            transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                        />
                    )}
                </svg>

                <div className="relative z-20 w-full h-full p-6 md:p-8 flex flex-col items-center justify-between gap-6 md:gap-8 my-auto">

                    {/* Top Tier: System Online Badge & Input Nodes */}
                    <div className="w-full flex flex-col gap-6 shrink-0">
                        <div className="w-full flex justify-end">
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 border border-white/10 backdrop-blur-md z-30 shadow-lg">
                                <span className="w-2 h-2 rounded-full bg-[#78b846] animate-pulse shadow-[0_0_8px_#78b846]"></span>
                                <span className="text-[9px] text-white font-mono uppercase tracking-wider">System Online</span>
                            </div>
                        </div>

                        <div className="flex w-full justify-around items-center px-4 md:px-12">
                            {/* LTM Database Node */}
                            <div className="flex flex-col items-center gap-4">
                                <motion.div
                                    className={`w-14 h-14 md:w-16 md:h-16 rounded-2xl border flex items-center justify-center relative backdrop-blur-md transition-all duration-500 z-20 ${config["memory.ltm_enabled"] ? 'border-[#BB9AF7] bg-[#BB9AF7]/20 shadow-[0_0_30px_rgba(187,154,247,0.3)]' : 'border-white/10 bg-[#0a0f16]/80 shadow-none'}`}
                                    animate={{ y: config["memory.ltm_enabled"] ? [0, -5, 0] : 0 }}
                                    transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                                >
                                    <span className={`text-xl md:text-2xl transition-opacity duration-500 ${config["memory.ltm_enabled"] ? 'opacity-100' : 'opacity-40 grayscale'}`}>💾</span>
                                </motion.div>
                                <span className={`text-[10px] md:text-[11px] uppercase font-mono tracking-[0.2em] relative z-20 bg-[#06080c] px-2 rounded ${config["memory.ltm_enabled"] ? 'text-[#BB9AF7]' : 'text-slate-600'}`}>Memgraph</span>
                            </div>

                            {/* Voice Input Node */}
                            <div className="flex flex-col items-center gap-4">
                                <motion.div
                                    className={`w-14 h-14 md:w-16 md:h-16 rounded-full border flex items-center justify-center relative backdrop-blur-md transition-all duration-500 z-20 ${config["voice.transcription"] ? 'border-[#7AA2F7] bg-[#7AA2F7]/20 shadow-[0_0_30px_rgba(122,162,247,0.3)]' : 'border-white/10 bg-[#0a0f16]/80 shadow-none'}`}
                                    animate={{ y: config["voice.transcription"] ? [0, -5, 0] : 0 }}
                                    transition={{ repeat: Infinity, duration: 4, ease: "easeInOut", delay: 1 }}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-all duration-500 md:w-6 md:h-6 ${config["voice.transcription"] ? 'text-[#7AA2F7]' : 'text-slate-600'}`}><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>

                                    {/* Audio Waves */}
                                    {config["voice.transcription"] && (
                                        <div className="absolute -bottom-10 md:-bottom-12 w-[50px] md:w-[60px] h-[30px] flex items-start justify-center gap-1 overflow-hidden z-10 pointer-events-none">
                                            {[1, 2, 3, 4, 5].map((i) => (
                                                <motion.div
                                                    key={i}
                                                    className="w-1 bg-[#7AA2F7] rounded-full shadow-[0_0_8px_#7AA2F7]"
                                                    animate={{ height: [4, 10 + Math.random() * 20, 4] }}
                                                    transition={{ repeat: Infinity, duration: 0.4 + Math.random() * 0.4 }}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </motion.div>
                                <span className={`text-[10px] md:text-[11px] uppercase font-mono tracking-[0.2em] relative z-20 bg-[#06080c] px-2 rounded ${config["voice.transcription"] ? 'text-[#7AA2F7]' : 'text-slate-600'}`}>Audio Rx</span>
                            </div>
                        </div>
                    </div>

                    {/* Middle Tier: The Core Engine */}
                    <div className="relative z-20 shrink-0 pt-4">
                        <motion.div
                            className={`w-28 h-28 md:w-32 md:h-32 mx-auto rounded-full bg-[#0a0f16] border-[3px] flex flex-col items-center justify-center relative backdrop-blur-xl transition-colors duration-1000 z-20 ${config["agent.mode"] === "autonomous" ? 'border-[#78b846] shadow-[0_0_50px_rgba(120,184,70,0.4)]' : 'border-[#e0af68] shadow-[0_0_40px_rgba(224,175,104,0.3)]'}`}
                        >
                            {/* Inner rotating dashed ring */}
                            <motion.div
                                className={`absolute inset-3 border-2 border-dashed rounded-full pointer-events-none transition-colors duration-1000 ${config["agent.mode"] === "autonomous" ? 'border-[#78b846]/40' : 'border-[#e0af68]/40'}`}
                                animate={{ rotate: 360 }}
                                transition={{ repeat: Infinity, duration: config["agent.mode"] === "autonomous" ? 10 : 20, ease: "linear" }}
                            />

                            {/* Inner rotating dotted ring (counter) */}
                            <motion.div
                                className={`absolute inset-6 border-[3px] border-dotted rounded-full pointer-events-none transition-colors duration-1000 ${config["agent.mode"] === "autonomous" ? 'border-[#78b846]/30' : 'border-[#e0af68]/30'}`}
                                animate={{ rotate: -360 }}
                                transition={{ repeat: Infinity, duration: config["agent.mode"] === "autonomous" ? 15 : 30, ease: "linear" }}
                            />

                            <span className="text-3xl md:text-4xl relative z-20 drop-shadow-2xl">
                                🧠
                            </span>
                        </motion.div>

                        <div className="text-center mt-4 md:mt-6 relative z-20">
                            <div className={`px-4 py-1.5 rounded-full inline-flex flex-col items-center backdrop-blur-md border transition-colors duration-1000 bg-[#06080c]/80 ${config["agent.mode"] === "autonomous" ? 'border-[#78b846]/30 shadow-[0_0_15px_rgba(120,184,70,0.15)]' : 'border-[#e0af68]/30 shadow-[0_0_15px_rgba(224,175,104,0.15)]'}`}>
                                <span className={`text-[10px] md:text-[11px] font-bold uppercase tracking-[0.2em] ${config["agent.mode"] === "autonomous" ? 'text-[#78b846]' : 'text-[#e0af68]'}`}>
                                    {config["agent.mode"]} Engine
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Bottom Tier: Token Capacity Ring (Visualizing max_context) */}
                    <div className="w-full flex justify-center relative z-20 shrink-0 pt-4">
                        <div className="relative w-48 md:w-56 h-auto flex flex-col items-center justify-end">
                            {/* Simple arc representing capacity */}
                            <svg className="w-full h-12 md:h-16 pointer-events-none" viewBox="0 0 200 60">
                                <path d="M 20 50 Q 100 -20 180 50" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" strokeLinecap="round" />
                                <motion.path
                                    d="M 20 50 Q 100 -20 180 50"
                                    fill="none"
                                    stroke="#a9df7c"
                                    strokeWidth="12"
                                    strokeLinecap="round"
                                    strokeDasharray="210"
                                    initial={{ strokeDashoffset: 210 }}
                                    animate={{ strokeDashoffset: 210 - (config["rag.max_context_tokens"] / 32768) * 210 }}
                                    transition={{ type: "spring", stiffness: 50 }}
                                    className="drop-shadow-[0_0_8px_rgba(169,223,124,0.5)]"
                                />
                            </svg>
                            <div className="bg-[#0a0f16]/90 backdrop-blur-md border border-white/10 rounded-2xl px-4 md:px-6 py-2 md:py-3 flex flex-col items-center shadow-2xl mt-0 md:mt-2 relative z-10">
                                <span className="text-white font-mono text-xl md:text-2xl font-bold">{config["rag.max_context_tokens"]}</span>
                                <span className="text-[8px] md:text-[9px] text-slate-500 uppercase tracking-widest mt-1">Context Tokens</span>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default ConfigSimulator;

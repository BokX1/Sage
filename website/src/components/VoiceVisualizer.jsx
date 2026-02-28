import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const VoiceVisualizer = () => {
    const [isListening, setIsListening] = useState(true);
    const bars = 16;

    // Animate audio bars
    const [volumes, setVolumes] = useState(Array(bars).fill(0.2));

    useEffect(() => {
        if (!isListening) {
            setVolumes(Array(bars).fill(0.1));
            return;
        }

        const interval = setInterval(() => {
            setVolumes(prev => prev.map(() => 0.2 + Math.random() * 0.8));
        }, 150);

        return () => clearInterval(interval);
    }, [isListening]);

    return (
        <div className="relative w-full max-w-sm mx-auto flex flex-col items-center justify-center p-8 rounded-3xl glass-panel border border-white/5 overflow-hidden group">
            {/* Soft background glow */}
            <div className={`absolute inset-0 bg-gradient-to-tr from-[#78b846]/10 to-[#2d4530]/20 opacity-0 group-hover:opacity-100 transition-opacity duration-1000 ${isListening ? 'animate-pulse' : ''}`}></div>

            <div className="z-10 text-[#a9df7c] font-mono text-xs mb-6 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${isListening ? 'bg-[#78b846] animate-pulse' : 'bg-slate-500'}`}></span>
                {isListening ? 'SAGE_VOICE: ACTIVE' : 'SAGE_VOICE: STANDBY'}
            </div>

            <div className="relative flex items-center justify-center h-24 mb-4 gap-1.5 z-10 w-full px-4">
                {volumes.map((v, i) => (
                    <motion.div
                        key={i}
                        className="w-1.5 bg-gradient-to-t from-[#78b846] to-[#a9df7c] rounded-full"
                        initial={{ height: 4 }}
                        animate={{ height: isListening ? v * 64 : 4 }}
                        transition={{ duration: 0.15, ease: "easeInOut" }}
                        style={{ opacity: 0.4 + v * 0.6, boxShadow: "0 0 10px rgba(120, 184, 70, 0.4)" }}
                    />
                ))}
            </div>

            <button
                type="button"
                onClick={() => setIsListening(!isListening)}
                className="z-10 px-6 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-sm font-medium transition-all"
            >
                {isListening ? 'Toggle Standby' : 'Wake Sage'}
            </button>
        </div>
    );
};

export default VoiceVisualizer;

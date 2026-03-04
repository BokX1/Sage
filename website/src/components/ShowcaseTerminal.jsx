import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const scenarios = [
    {
        label: 'Debug_Nextjs_Hydration.exe',
        desc: 'Trace web search and error resolution',
        userMsg: 'Sage, I keep getting a hydration mismatch error in my Next.js app. Can you help?',
        trace: [
            { tool: 'system_plan', status: 'ok', text: 'Analyzing: hydration mismatch → likely SSR/CSR discrepancy' },
            { tool: 'stack_overflow_search', status: 'ok', text: 'query: "Next.js hydration mismatch error"' },
            { tool: 'web', status: 'ok', text: 'action=extract → Extracting top answer from stackoverflow.com/q/71706...' },
            { tool: 'web', status: 'fallback', text: 'action=search → tavily ✗ → exa ✗ → searxng ✓ "Next.js 15 hydration fix"' },
            { tool: 'web', status: 'ok', text: 'action=read → Reading nextjs.org/docs/messages/react-hydration-error' },
        ],
    },
    {
        label: 'Voice_Context_Recovery.sh',
        desc: 'Extracting temporal conversational data',
        userMsg: "Sage, what did we discuss in voice chat yesterday?",
        trace: [
            { tool: 'system_plan', status: 'ok', text: 'User wants voice session context from yesterday' },
            { tool: 'discord', status: 'ok', text: 'action=analytics.get_voice_analytics → Found 2 sessions: #general-voice (45min), #dev-talk (20min)' },
            { tool: 'discord', status: 'ok', text: 'action=memory.get_channel → Loading rolling summary for #general around session timestamp' },
            { tool: 'discord', status: 'ok', text: 'action=messages.search_history → Semantic search: messages near voice session window' },
        ],
    },
    {
        label: 'Analyze_Architecture.bin',
        desc: 'Static analysis of external git repository',
        userMsg: 'Sage, can you look at the BokX1/Sage repo and explain the architecture?',
        trace: [
            { tool: 'system_plan', status: 'ok', text: 'User wants repo architecture breakdown' },
            { tool: 'github', status: 'ok', text: 'action=repo.get → Fetching BokX1/Sage metadata: 14 dirs, TypeScript, MIT' },
            { tool: 'github', status: 'ok', text: 'action=code.search → query: "agentRuntime" → 3 files found' },
            { tool: 'github', status: 'ok', text: 'action=file.page → Reading src/core/agentRuntime/agentRuntime.ts (paged)' },
            { tool: 'github', status: 'ok', text: 'action=file.page → Reading src/core/agentRuntime/defaultTools.ts (paged)' },
        ],
    },
];

const toolIcons = {
    system_plan: '🧠',
    stack_overflow_search: '📚',
    web: '🌐',
    discord: '💬',
    github: '📦',
};

export default function ShowcaseTerminal() {
    const [activeScenario, setActiveScenario] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [visibleLines, setVisibleLines] = useState(0);
    const [packetFired, setPacketFired] = useState(false);
    const terminalRef = useRef(null);
    const packetTimerRef = useRef(null);
    const lineTimerRef = useRef(null);
    const traceDurations = useMemo(
        () => scenarios.map(({ trace }) => trace.map(() => Math.floor(Math.random() * 80 + 20))),
        []
    );

    const scenario = scenarios[activeScenario];

    const play = (idx) => {
        if (isPlaying && idx === activeScenario) return;
        if (packetTimerRef.current) {
            clearTimeout(packetTimerRef.current);
            packetTimerRef.current = null;
        }
        if (lineTimerRef.current) {
            clearTimeout(lineTimerRef.current);
            lineTimerRef.current = null;
        }
        setActiveScenario(idx);
        setIsPlaying(true);
        setVisibleLines(0);
        setPacketFired(true);

        // Reset packet animation after it completes
        packetTimerRef.current = setTimeout(() => {
            setPacketFired(false);
            packetTimerRef.current = null;
        }, 800);
    };

    useEffect(() => {
        if (!isPlaying) return;
        if (visibleLines >= scenario.trace.length) {
            setIsPlaying(false);
            return;
        }

        const delay = visibleLines === 0 ? 800 : Math.random() * 400 + 300;
        lineTimerRef.current = setTimeout(() => {
            setVisibleLines(v => v + 1);
            lineTimerRef.current = null;
        }, delay);

        return () => {
            if (lineTimerRef.current) {
                clearTimeout(lineTimerRef.current);
                lineTimerRef.current = null;
            }
        };
    }, [activeScenario, isPlaying, visibleLines, scenario.trace.length]);

    useEffect(() => {
        return () => {
            if (packetTimerRef.current) {
                clearTimeout(packetTimerRef.current);
            }
            if (lineTimerRef.current) {
                clearTimeout(lineTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [visibleLines]);

    return (
        <section className="relative max-w-7xl mx-auto px-6 py-28 overflow-hidden">
            {/* Background elements */}
            <div className="absolute top-1/2 left-1/4 w-[600px] h-[600px] bg-[#78b846]/5 blur-[120px] rounded-full pointer-events-none -z-10" />

            <motion.div
                className="text-center mb-16"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
            >
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141a23] border border-[#2d4530] text-[#a9df7c] text-xs font-mono mb-6 shadow-[0_0_15px_rgba(120,184,70,0.2)]">
                    <span className="w-2 h-2 rounded-full bg-[#78b846] animate-pulse" />
                    Agentic execution trace
                </div>
                <h2 className="text-4xl lg:text-5xl font-extrabold text-white mb-4">
                    Watch Sage <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#78b846] to-[#a9df7c]">Execute</span>
                </h2>
                <p className="text-lg text-slate-400 max-w-2xl mx-auto font-light">
                    Select a payload. Watch the agentic cognitive loop chain tools in real-time.
                </p>
            </motion.div>

            <motion.div
                className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-6 lg:gap-12 relative"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >
                {/* Horizontal connection line for desktop */}
                <div className="hidden lg:block absolute top-[40%] left-[33%] right-[66%] h-px bg-white/10 z-0">
                    <AnimatePresence>
                        {packetFired && (
                            <motion.div
                                className="absolute top-[-1px] left-0 h-[3px] w-24 bg-gradient-to-r from-transparent via-[#78b846] to-transparent shadow-[0_0_10px_#78b846]"
                                initial={{ x: '-100%', opacity: 1 }}
                                animate={{ x: '300%', opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.8, ease: "easeInOut" }}
                            />
                        )}
                    </AnimatePresence>
                </div>

                {/* Left: Payload Injector HUD */}
                <div className="flex flex-col gap-4 relative z-10">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-mono text-slate-500 tracking-widest uppercase">Select Payload</span>
                        <span className="text-xs font-mono text-[#78b846] animate-pulse">System Ready</span>
                    </div>

                    {scenarios.map((s, i) => (
                        <motion.button
                            type="button"
                            key={s.label}
                            onClick={() => play(i)}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className={`relative text-left p-4 rounded-xl border backdrop-blur-sm transition-all overflow-hidden group ${activeScenario === i
                                ? 'bg-[#141a23]/60 border-[#78b846]/40 shadow-[0_0_20px_rgba(120,184,70,0.1)]'
                                : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20'
                                }`}
                        >
                            {/* Background glow on active */}
                            {activeScenario === i && (
                                <div className="absolute top-0 left-0 w-1 h-full bg-[#78b846] shadow-[0_0_10px_#78b846]" />
                            )}

                            <div className="flex items-start justify-between mb-1 pl-2">
                                <span className={`font-mono text-sm font-bold ${activeScenario === i ? 'text-[#a9df7c]' : 'text-slate-300'}`}>
                                    {s.label}
                                </span>
                                <svg viewBox="0 0 24 24" className={`w-4 h-4 transition-transform ${activeScenario === i ? 'text-[#78b846] translate-x-1' : 'text-slate-600 group-hover:text-slate-400 group-hover:translate-x-1'}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                            </div>
                            <div className="text-xs text-slate-500 font-mono pl-2">
                                {s.desc}
                            </div>
                        </motion.button>
                    ))}
                </div>

                {/* Right: Immersive Terminal */}
                <div className="relative group z-10">
                    {/* Decorative ambient terminal glow */}
                    <div className="absolute -inset-1 rounded-2xl bg-gradient-to-tr from-[#78b846]/20 to-[#BB9AF7]/10 opacity-30 blur-2xl z-0 transition-opacity duration-500 group-hover:opacity-50" />

                    <div className="relative w-full h-[460px] bg-[#0a0e16]/90 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col font-mono text-sm ring-1 ring-white/5">

                        {/* Terminal Window Chrome */}
                        <div className="h-12 bg-white/5 border-b border-white/10 flex items-center px-4 justify-between relative z-20">
                            <div className="flex gap-2">
                                <div className="w-3 h-3 rounded-full bg-[#ED4245]/80" />
                                <div className="w-3 h-3 rounded-full bg-[#FEE75C]/80" />
                                <div className="w-3 h-3 rounded-full bg-[#57F287]/80" />
                            </div>
                            <div className="absolute left-1/2 -translate-x-1/2 text-xs text-slate-500 font-bold tracking-wider">
                                root@sage-core: ~
                            </div>
                            <div className="text-[10px] text-slate-600 bg-black/30 px-2 py-1 rounded">
                                bash v4.2
                            </div>
                        </div>

                        {/* Prompt Log Area */}
                        <div
                            ref={terminalRef}
                            className="flex-1 p-5 overflow-y-auto space-y-4 relative scroll-smooth"
                        >
                            {/* User execution request */}
                            <div className="flex items-start gap-3 text-slate-300">
                                <span className="text-[#a9df7c] font-bold shrink-0 mt-0.5">➜</span>
                                <div>
                                    <span className="text-[#BB9AF7]">./sage</span> <span className="text-slate-200">--invoke</span> <span className="text-slate-400">"{scenario.userMsg}"</span>
                                </div>
                            </div>

                            {/* Divider indicating start of trace */}
                            <div className="border-t border-dashed border-white/10 pt-2 pb-1" />

                            {/* Trace Lines */}
                            {scenario.trace.slice(0, visibleLines).map((line, i) => (
                                <motion.div
                                    key={`${activeScenario}-${i}`}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.3 }}
                                    className="flex items-start gap-3 group/line"
                                >
                                    <div className="w-6 shrink-0 text-center opacity-60 group-hover/line:opacity-100 transition-opacity">
                                        {toolIcons[line.tool] || '⚡'}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-[#78b846] text-xs uppercase tracking-widest">[EXEC]</span>
                                            <span className={`font-bold ${line.status === 'fallback' ? 'text-amber-400' : 'text-slate-200'}`}>
                                                {line.tool}
                                            </span>
                                            <div className="h-[1px] flex-1 bg-white/5 ml-2" />
                                            <span className="text-[10px] text-slate-500">{traceDurations[activeScenario][i]}ms</span>
                                        </div>
                                        <div className="text-slate-400 text-xs ml-[4px] border-l-2 border-white/5 pl-3 py-1 bg-white/[0.02] rounded-r">
                                            {line.text}
                                        </div>
                                    </div>
                                </motion.div>
                            ))}

                            {/* Execution state handling */}
                            {(packetFired && visibleLines === 0) && (
                                <div className="flex items-center gap-3 text-amber-400/80 animate-pulse text-xs">
                                    <span className="w-6 text-center">⚙️</span>
                                    <span>Receiving payload matrix...</span>
                                </div>
                            )}

                            {(isPlaying && visibleLines > 0 && visibleLines < scenario.trace.length) && (
                                <div className="flex items-center gap-3 text-[#78b846] text-xs">
                                    <span className="w-6 mt-0.5 text-center shrink-0">
                                        <svg className="animate-spin w-4 h-4 mx-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" strokeWidth="2" strokeDasharray="30 60"></circle></svg>
                                    </span>
                                    <span className="animate-pulse">Awaiting sub-routine...</span>
                                </div>
                            )}

                            {(!isPlaying && visibleLines > 0) && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="pt-2"
                                >
                                    <div className="bg-[#141a23] border border-[#78b846]/30 text-[#a9df7c] px-4 py-3 rounded-lg flex items-center justify-between shadow-[0_0_15px_rgba(120,184,70,0.1)]">
                                        <div className="flex items-center gap-3">
                                            <svg viewBox="0 0 24 24" className="w-5 h-5 text-[#78b846]" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                                            <span className="font-bold">Execution Complete. Response generated.</span>
                                        </div>
                                        <span className="text-xs text-slate-500 font-mono">[{scenario.trace.length} tools / 1.4s]</span>
                                    </div>
                                </motion.div>
                            )}
                        </div>
                    </div>
                </div>
            </motion.div>
        </section>
    );
}

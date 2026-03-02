import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * HeroDemo — Replaces the abstract 3D blob with an interactive
 * Discord-style product demo that shows Sage working in real-time.
 *
 * 2026 best practice: "Show, don't blob."
 */

const demoFlow = [
    { type: 'user', avatar: '👤', name: 'Alex', text: 'Hey Sage, what were we discussing yesterday in voice chat?' },
    { type: 'typing' },
    { type: 'tool', name: 'discord · analytics.get_voice_analytics', status: '✓', color: '#7AA2F7' },
    { type: 'tool', name: 'discord · memory.get_channel', status: '✓', color: '#BB9AF7' },
    { type: 'tool', name: 'discord · messages.search_history', status: '✓', color: '#E0AF68' },
    {
        type: 'sage',
        text: "Yesterday's voice session in #dev-talk (42 min) focused on migrating the auth system to OAuth2. Key decision: use PKCE flow for the mobile app. Sarah volunteered to write the migration guide.",
    },
];

function ToolCallBadge({ name, status, color, delay }) {
    return (
        <motion.div
            initial={{ opacity: 0, x: -10, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: 0.3, delay }}
            className="flex items-center gap-2 text-[11px] font-mono"
        >
            <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md"
                style={{ backgroundColor: color + '15', color, border: `1px solid ${color}25` }}
            >
                ⚡ {name}
            </span>
            <span className="text-[#78b846]">{status}</span>
        </motion.div>
    );
}

function StreamingText({ text, speed = 20 }) {
    const [displayed, setDisplayed] = useState('');

    useEffect(() => {
        setDisplayed('');
        let i = 0;
        const interval = setInterval(() => {
            if (i < text.length) {
                setDisplayed(text.slice(0, i + 1));
                i++;
            } else {
                clearInterval(interval);
            }
        }, speed);
        return () => clearInterval(interval);
    }, [text, speed]);

    return (
        <span>
            {displayed}
            {displayed.length < text.length && (
                <span className="inline-block w-[2px] h-[14px] bg-[#78b846] ml-0.5 align-middle animate-pulse" />
            )}
        </span>
    );
}

export default function HeroDemo() {
    const [step, setStep] = useState(0);
    const [hasStarted, setHasStarted] = useState(false);
    const chatRef = useRef(null);
    const replayTimerRef = useRef(null);

    // Auto-play once visible
    useEffect(() => {
        const timer = setTimeout(() => setHasStarted(true), 800);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (!hasStarted) return;
        if (step >= demoFlow.length) return;

        const delays = {
            user: 600,
            typing: 1000,
            tool: 500,
            sage: 100,
        };

        const currentType = demoFlow[step]?.type;
        const timer = setTimeout(() => setStep(s => s + 1), delays[currentType] || 600);
        return () => clearTimeout(timer);
    }, [step, hasStarted]);

    useEffect(() => {
        if (chatRef.current) {
            chatRef.current.scrollTop = chatRef.current.scrollHeight;
        }
    }, [step]);

    const reset = () => {
        setStep(0);
        setHasStarted(false);
        if (replayTimerRef.current) {
            clearTimeout(replayTimerRef.current);
        }
        replayTimerRef.current = setTimeout(() => setHasStarted(true), 500);
    };

    useEffect(() => {
        return () => {
            if (replayTimerRef.current) {
                clearTimeout(replayTimerRef.current);
            }
        };
    }, []);

    return (
        <div className="w-full h-full flex flex-col">
            {/* Mock Discord Title Bar */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 flex-shrink-0">
                <div className="flex gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]/60" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]/60" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]/60" />
                </div>
                <div className="flex items-center gap-1.5 ml-3">
                    <span className="text-slate-500 text-sm">#</span>
                    <span className="text-white text-xs font-medium">general</span>
                </div>
                <span className="ml-auto text-[10px] text-slate-600 font-mono">
                    {step >= demoFlow.length ? '✓ Complete' : hasStarted ? 'Live' : 'Ready'}
                </span>
                <span
                    className={`w-1.5 h-1.5 rounded-full ${hasStarted && step < demoFlow.length ? 'bg-[#78b846] animate-pulse' : step >= demoFlow.length ? 'bg-[#78b846]' : 'bg-slate-600'}`}
                />
            </div>

            {/* Chat Area */}
            <div
                ref={chatRef}
                className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
                style={{ scrollbarWidth: 'none' }}
            >
                <AnimatePresence>
                    {demoFlow.slice(0, step).map((item, i) => {
                        if (item.type === 'user') {
                            return (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.25 }}
                                    className="flex items-start gap-2.5"
                                >
                                    <div className="w-7 h-7 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-xs flex-shrink-0">
                                        {item.avatar}
                                    </div>
                                    <div>
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-sm font-semibold text-indigo-400">{item.name}</span>
                                            <span className="text-[10px] text-slate-600">Today at 3:42 PM</span>
                                        </div>
                                        <p className="text-sm text-slate-300 mt-0.5 leading-relaxed">{item.text}</p>
                                    </div>
                                </motion.div>
                            );
                        }

                        if (item.type === 'typing') {
                            return (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="flex items-center gap-2.5"
                                >
                                    <div className="w-7 h-7 rounded-full bg-[#78b846]/20 border border-[#78b846]/30 flex items-center justify-center text-xs flex-shrink-0">
                                        🌿
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-[#a9df7c]">Sage</span>
                                        <div className="flex gap-0.5">
                                            {[0, 1, 2].map(d => (
                                                <motion.div
                                                    key={d}
                                                    className="w-1.5 h-1.5 rounded-full bg-[#78b846]"
                                                    animate={{ opacity: [0.3, 1, 0.3] }}
                                                    transition={{ duration: 0.8, repeat: Infinity, delay: d * 0.15 }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </motion.div>
                            );
                        }

                        if (item.type === 'tool') {
                            return (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="ml-9"
                                >
                                    <ToolCallBadge
                                        name={item.name}
                                        status={item.status}
                                        color={item.color}
                                        delay={0}
                                    />
                                </motion.div>
                            );
                        }

                        if (item.type === 'sage') {
                            return (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3 }}
                                    className="flex items-start gap-2.5"
                                >
                                    <div className="w-7 h-7 rounded-full bg-[#78b846]/20 border border-[#78b846]/30 flex items-center justify-center text-xs flex-shrink-0">
                                        🌿
                                    </div>
                                    <div>
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-sm font-semibold text-[#a9df7c]">Sage</span>
                                            <span className="text-[10px] font-mono text-[#78b846]/50">BOT</span>
                                            <span className="text-[10px] text-slate-600">Today at 3:42 PM</span>
                                        </div>
                                        <p className="text-[13px] text-slate-300 mt-0.5 leading-relaxed">
                                            <StreamingText text={item.text} speed={18} />
                                        </p>
                                    </div>
                                </motion.div>
                            );
                        }

                        return null;
                    })}
                </AnimatePresence>
            </div>

            {/* Mock Input Bar */}
            <div className="px-4 py-2.5 border-t border-white/5 flex-shrink-0">
                {step >= demoFlow.length ? (
                    <motion.button
                        type="button"
                        onClick={reset}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="w-full text-center text-[11px] text-slate-500 hover:text-[#a9df7c] font-mono py-1 transition-colors"
                    >
                        ↻ Replay demo
                    </motion.button>
                ) : (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
                        <span className="text-slate-600 text-sm">Message #general</span>
                    </div>
                )}
            </div>
        </div>
    );
}

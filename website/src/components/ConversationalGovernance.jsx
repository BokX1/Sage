import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const chatSteps = [
    { role: 'admin', text: 'Sage, update server memory with our new moderation policy: zero tolerance for spam, all warnings must be logged.' },
    { role: 'thinking', text: null },
    { role: 'sage', text: "I've prepared the server memory update. This will modify the guild memory for all future interactions. Please review and approve:" },
    { role: 'action', text: 'Update Guild Memory: Zero tolerance spam policy + warning logs' },
];

export default function ConversationalGovernance() {
    const [step, setStep] = useState(0);
    const [decision, setDecision] = useState('pending');
    const approved = decision === 'approved';
    const rejected = decision === 'rejected';

    useEffect(() => {
        if (decision !== 'pending') return;
        if (step >= chatSteps.length) return;
        const delay = step === 1 ? 1500 : step === 0 ? 500 : 1000;
        const timer = setTimeout(() => setStep(s => s + 1), delay);
        return () => clearTimeout(timer);
    }, [step, decision]);

    const reset = () => {
        setStep(0);
        setDecision('pending');
    };

    return (
        <section className="relative max-w-7xl mx-auto px-6 py-24">
            <motion.div
                className="text-center mb-12"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
            >
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141a23] border border-[#2d4530] text-[#a9df7c] text-xs font-mono mb-6">
                    <span className="w-2 h-2 rounded-full bg-[#78b846] animate-pulse" />
                    Chat-First Admin
                </div>
                <h2 className="text-4xl lg:text-5xl font-extrabold text-white mb-4">
                    Conversational{' '}
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#78b846] to-[#a9df7c]">
                        Governance
                    </span>
                </h2>
                <p className="text-lg text-slate-400 max-w-2xl mx-auto font-light">
                    No slash commands to memorize. Just talk. Destructive actions always require explicit approval.
                </p>
            </motion.div>

            <motion.div
                className="max-w-2xl mx-auto bento-cell p-6"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >
                {/* Chat header */}
                <div className="flex items-center gap-2 mb-6 pb-3 border-b border-white/5">
                    <div className="w-2 h-2 rounded-full bg-[#78b846]" />
                    <span className="font-mono text-xs text-slate-500">admin-channel</span>
                    <span className="ml-auto text-[10px] text-slate-600 font-mono" aria-live="polite">
                        {approved
                            ? '✓ Approved'
                            : rejected
                                ? '✗ Rejected'
                                : step >= chatSteps.length
                                    ? 'Awaiting approval'
                                    : 'Typing...'}
                    </span>
                </div>

                {/* Chat Messages */}
                <div className="space-y-4 min-h-[250px]">
                    <AnimatePresence>
                        {chatSteps.slice(0, step).map((msg, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                            >
                                {msg.role === 'admin' && (
                                    <div className="flex gap-3">
                                        <div className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/30 flex-shrink-0 flex items-center justify-center text-xs">👑</div>
                                        <div className="bg-white/5 rounded-2xl rounded-tl-md px-4 py-3 text-sm text-slate-300 max-w-md">
                                            {msg.text}
                                        </div>
                                    </div>
                                )}
                                {msg.role === 'thinking' && (
                                    <div className="flex gap-3 items-center">
                                        <div className="w-8 h-8 rounded-full bg-[#78b846]/20 border border-[#78b846]/30 flex-shrink-0 flex items-center justify-center text-xs">🌿</div>
                                        <div className="flex gap-1">
                                            {[0, 1, 2].map(d => (
                                                <motion.div
                                                    key={d}
                                                    className="w-2 h-2 rounded-full bg-[#78b846]"
                                                    animate={{ opacity: [0.3, 1, 0.3] }}
                                                    transition={{ duration: 1, repeat: Infinity, delay: d * 0.2 }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {msg.role === 'sage' && (
                                    <div className="flex gap-3">
                                        <div className="w-8 h-8 rounded-full bg-[#78b846]/20 border border-[#78b846]/30 flex-shrink-0 flex items-center justify-center text-xs">🌿</div>
                                        <div className="bg-[#78b846]/5 border border-[#78b846]/10 rounded-2xl rounded-tl-md px-4 py-3 text-sm text-slate-300 max-w-md">
                                            {msg.text}
                                        </div>
                                    </div>
                                )}
                                {msg.role === 'action' && decision === 'pending' && (
                                    <motion.div
                                        className="ml-11 bg-[#141a23] border border-[#2d4530] rounded-2xl p-4"
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                                    >
                                        <div className="text-xs text-slate-400 mb-3 font-mono">{msg.text}</div>
                                        <div className="flex gap-2">
                                            <motion.button
                                                type="button"
                                                onClick={() => setDecision('approved')}
                                                whileHover={{ scale: 1.05 }}
                                                whileTap={{ scale: 0.95 }}
                                                className="px-4 py-2 rounded-xl bg-[#78b846]/20 text-[#a9df7c] text-sm font-medium border border-[#78b846]/30 hover:bg-[#78b846]/30 transition-colors"
                                            >
                                                ✓ Approve
                                            </motion.button>
                                            <button
                                                type="button"
                                                onClick={() => setDecision('rejected')}
                                                className="px-4 py-2 rounded-xl bg-red-500/10 text-red-400 text-sm font-medium border border-red-500/20 hover:bg-red-500/20 transition-colors"
                                            >
                                                ✗ Reject
                                            </button>
                                        </div>
                                    </motion.div>
                                )}
                                {msg.role === 'action' && approved && (
                                    <motion.div
                                        className="ml-11 flex items-center gap-2 text-[#a9df7c] text-sm font-mono"
                                        initial={{ opacity: 0, scale: 0.5 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                                    >
                                        <motion.span
                                            className="text-2xl"
                                            animate={{ rotate: [0, 360] }}
                                            transition={{ duration: 0.5 }}
                                        >
                                            ✅
                                        </motion.span>
                                        Server memory updated successfully.
                                    </motion.div>
                                )}
                                {msg.role === 'action' && rejected && (
                                    <motion.div
                                        className="ml-11 flex items-center gap-2 text-red-400 text-sm font-mono"
                                        initial={{ opacity: 0, scale: 0.5 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                                    >
                                        <span className="text-2xl">⛔</span>
                                        Server memory update rejected.
                                    </motion.div>
                                )}
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>

                {/* Replay */}
                {(step >= chatSteps.length || decision !== 'pending') && (
                    <motion.div
                        className="text-center mt-4 pt-4 border-t border-white/5"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                    >
                        <button
                            type="button"
                            onClick={reset}
                            className="text-xs text-slate-500 hover:text-[#a9df7c] font-mono transition-colors"
                        >
                            ↻ Replay demo
                        </button>
                    </motion.div>
                )}
            </motion.div>
        </section>
    );
}

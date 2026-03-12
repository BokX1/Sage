import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const REJECTION_REASON = 'Needs legal review before changing server policy.';

export default function ConversationalGovernance() {
    const [step, setStep] = useState(0);
    const [decision, setDecision] = useState('pending');
    const [showDetails, setShowDetails] = useState(false);

    useEffect(() => {
        if (decision !== 'pending') return;
        if (step >= 3) return;
        const delay = step === 0 ? 500 : step === 1 ? 900 : 1100;
        const timer = setTimeout(() => setStep((value) => value + 1), delay);
        return () => clearTimeout(timer);
    }, [decision, step]);

    const approved = decision === 'approved';
    const rejected = decision === 'rejected';

    const reset = () => {
        setStep(0);
        setDecision('pending');
        setShowDetails(false);
    };

    const sourceStatus = approved
        ? 'Executed'
        : rejected
            ? 'Rejected'
            : step >= 2
                ? 'Queued for review'
                : 'Listening';

    const reviewStatus = approved
        ? 'Approved'
        : rejected
            ? 'Rejected'
            : step >= 3
                ? 'Review required'
                : 'Waiting';

    return (
        <section className="relative max-w-7xl mx-auto px-6 py-24">
            <motion.div
                className="text-center mb-12"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
            >
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141a23] border border-[#27495f] text-[#8ed6ff] text-xs font-mono mb-6">
                    <span className="w-2 h-2 rounded-full bg-[#4cc2ff] animate-pulse" />
                    Discord-Native Governance
                </div>
                <h2 className="text-4xl lg:text-5xl font-extrabold text-white mb-4">
                    Premium{' '}
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#4cc2ff] to-[#a9df7c]">
                        Review Flow
                    </span>
                </h2>
                <p className="text-lg text-slate-400 max-w-3xl mx-auto font-light">
                    Compact status where the request starts. Rich review where admins already work. No slash-command queue theater.
                </p>
            </motion.div>

            <motion.div
                className="max-w-5xl mx-auto bento-cell p-6"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >
                <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                    <div className="rounded-3xl border border-white/6 bg-white/[0.03] p-5">
                        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/5">
                            <div className="w-2 h-2 rounded-full bg-[#4cc2ff]" />
                            <span className="font-mono text-xs text-slate-500">#ops-floor</span>
                            <span className="ml-auto text-[10px] text-slate-600 font-mono">{sourceStatus}</span>
                        </div>

                        <AnimatePresence mode="popLayout">
                            {step >= 1 && (
                                <motion.div
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="flex gap-3 mb-4"
                                >
                                    <div className="w-8 h-8 rounded-full bg-red-500/20 border border-red-500/30 flex-shrink-0 flex items-center justify-center text-xs">AD</div>
                                    <div className="bg-white/5 rounded-2xl rounded-tl-md px-4 py-3 text-sm text-slate-300 max-w-md">
                                        Sage, update our Sage Persona so moderation approvals stay concise in-channel and route full reviews to
                                        <span className="text-[#8ed6ff]"> #governance-review</span>.
                                    </div>
                                </motion.div>
                            )}

                            {step >= 2 && (
                                <motion.div
                                    initial={{ opacity: 0, y: 12, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    className="ml-11 rounded-2xl border border-[#294255] bg-[#101821] p-4"
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#8ed6ff]">Requester Status</span>
                                        <span className={`text-[11px] font-mono ${approved ? 'text-[#a9df7c]' : rejected ? 'text-red-400' : 'text-slate-400'}`}>
                                            {sourceStatus}
                                        </span>
                                    </div>
                                    <div className="space-y-2 text-sm text-slate-300">
                                        <div className="font-semibold text-white">
                                            {approved ? 'Executed' : rejected ? 'Rejected' : 'Queued for review'}
                                        </div>
                                        <div>Update the guild Sage Persona for premium governance routing.</div>
                                        <div className="text-slate-400">Review surface: <span className="text-[#8ed6ff]">#governance-review</span></div>
                                        <div className="text-slate-400">
                                            {approved
                                                ? 'Outcome: completed successfully.'
                                                : rejected
                                                    ? `Reason: ${REJECTION_REASON}`
                                                    : 'Expires in 10 minutes.'}
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    <div className="rounded-3xl border border-white/6 bg-white/[0.03] p-5">
                        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/5">
                            <div className={`w-2 h-2 rounded-full ${approved ? 'bg-[#78b846]' : rejected ? 'bg-red-400' : 'bg-[#f5c451]'}`} />
                            <span className="font-mono text-xs text-slate-500">#governance-review</span>
                            <span className="ml-auto text-[10px] text-slate-600 font-mono">{reviewStatus}</span>
                        </div>

                        <AnimatePresence mode="wait">
                            {step < 3 ? (
                                <motion.div
                                    key="waiting"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="min-h-[250px] flex items-center justify-center text-center text-sm text-slate-500"
                                >
                                    Sage routes the detailed reviewer card here when a governance action needs approval.
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="review-card"
                                    initial={{ opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -12 }}
                                    className="rounded-2xl border border-[#325f3d] bg-[#0d1510] p-4 min-h-[250px]"
                                >
                                    <div className="flex items-start justify-between gap-3 mb-3">
                                        <div>
                                            <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-[#a9df7c] mb-2">Governance Review</div>
                                            <div className="text-white font-semibold">
                                                {approved ? 'Approved' : rejected ? 'Rejected' : 'Review required'}
                                            </div>
                                        </div>
                                        <div className={`text-xs font-mono px-2 py-1 rounded-full border ${approved ? 'border-[#78b846]/30 text-[#a9df7c] bg-[#78b846]/10' : rejected ? 'border-red-500/30 text-red-300 bg-red-500/10' : 'border-[#f5c451]/30 text-[#f5c451] bg-[#f5c451]/10'}`}>
                                            {approved ? 'Low drama' : rejected ? 'Blocked' : 'High trust'}
                                        </div>
                                    </div>

                                    <div className="space-y-2 text-sm text-slate-300">
                                        <div>Apply a Sage Persona update for governance routing.</div>
                                        <div className="text-slate-400">Requester: @admin</div>
                                        <div className="text-slate-400">Target: guild-wide behavior and approval presentation</div>
                                        <div className="text-slate-400">Impact: compact requester cards in the source channel, richer review cards for admins</div>
                                    </div>

                                    <div className="mt-4 rounded-2xl border border-white/6 bg-white/[0.03] p-3">
                                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 font-mono mb-2">Preview</div>
                                        <div className="text-sm text-slate-300">
                                            Route reviewer cards to <span className="text-[#8ed6ff]">#governance-review</span> while keeping requester status compact in the source channel.
                                        </div>
                                    </div>

                                    <div className="mt-4 flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            onClick={() => setDecision('approved')}
                                            className="px-4 py-2 rounded-xl bg-[#78b846]/20 text-[#a9df7c] text-sm font-medium border border-[#78b846]/30 hover:bg-[#78b846]/30 transition-colors"
                                        >
                                            Approve
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDecision('rejected')}
                                            className="px-4 py-2 rounded-xl bg-red-500/10 text-red-300 text-sm font-medium border border-red-500/20 hover:bg-red-500/20 transition-colors"
                                        >
                                            Reject
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowDetails((value) => !value)}
                                            className="px-4 py-2 rounded-xl bg-white/5 text-slate-300 text-sm font-medium border border-white/10 hover:bg-white/10 transition-colors"
                                        >
                                            Details
                                        </button>
                                    </div>

                                    <AnimatePresence>
                                        {showDetails && (
                                            <motion.div
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="mt-4 rounded-2xl border border-white/6 bg-[#111827] p-3 text-xs font-mono text-slate-400 space-y-1">
                                                    <div>action_id: action-7f3a</div>
                                                    <div>source_channel: #ops-floor</div>
                                                    <div>review_channel: #governance-review</div>
                                                    <div>expires_in: 10m</div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>

                                    {rejected && (
                                        <motion.div
                                            initial={{ opacity: 0, y: 8 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200"
                                        >
                                            Reject reason captured via modal: {REJECTION_REASON}
                                        </motion.div>
                                    )}
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {(step >= 3 || decision !== 'pending') && (
                    <motion.div
                        className="text-center mt-6 pt-4 border-t border-white/5"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                    >
                        <button
                            type="button"
                            onClick={reset}
                            className="text-xs text-slate-500 hover:text-[#8ed6ff] font-mono transition-colors"
                        >
                            Replay governance flow
                        </button>
                    </motion.div>
                )}
            </motion.div>
        </section>
    );
}

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';

const features = [
    { name: 'Autonomous Tool Execution', sage: true, traditional: false, desc: 'Tools activate without being asked' },
    { name: 'Graph-Native Social Intelligence', sage: true, traditional: false, desc: 'Memgraph-powered relationship tracking' },
    { name: '7-Stage Memory Pipeline', sage: true, traditional: false, desc: 'Contextual recall across conversations' },
    { name: 'OpenAI-Compatible LLM API', sage: true, traditional: false, desc: 'Works with any OpenAI-compatible provider across hosted or self-hosted deployments' },
    { name: 'Voice Channel Transcription', sage: true, traditional: false, desc: 'Auto-transcribe and summarize voice' },
    { name: 'AI Image Generation', sage: true, traditional: false, desc: 'Prompt refinement + generation pipeline' },
    { name: 'Conversational Configuration', sage: true, traditional: false, desc: 'Change settings via natural language' },
    { name: 'Self-Hosted / Sovereign', sage: true, traditional: false, desc: 'Your data never leaves your infra' },
    { name: 'Basic Moderation', sage: true, traditional: true, desc: 'Kick, ban, mute, timeouts' },
    { name: 'Chat-First Triggers', sage: true, traditional: false, desc: 'Mentions, replies, and wake-word entrypoints' },
    { name: 'Role Management', sage: true, traditional: true, desc: 'Auto-roles and reaction roles' },
];

function CheckIcon() {
    return (
        <svg className="w-5 h-5 text-[#78b846]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <motion.path
                initial={{ pathLength: 0 }}
                whileInView={{ pathLength: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
            />
        </svg>
    );
}

function CrossIcon() {
    return (
        <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
    );
}

export default function ComparisonTable() {
    const ref = useRef(null);
    const inView = useInView(ref, { once: true, margin: '-80px' });

    return (
        <section id="comparison" ref={ref} className="relative max-w-5xl mx-auto px-6 py-24">
            <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="text-center mb-12"
            >
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141a23] border border-[#2d4530] text-[#a9df7c] text-xs font-mono mb-6">
                    <span className="w-2 h-2 rounded-full bg-[#78b846]"></span>
                    Feature Comparison
                </div>
                <h2 className="text-4xl lg:text-5xl font-extrabold text-white mb-4">
                    Beyond <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#78b846] to-[#a9df7c]">Traditional</span> Bots
                </h2>
                <p className="text-lg text-slate-400 max-w-2xl mx-auto font-light">
                    Sage isn't a chatbot with a bigger command list. It's a cognitive runtime that reasons, remembers, and acts autonomously.
                </p>
            </motion.div>

            {/* Table */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.2, duration: 0.6 }}
                className="rounded-2xl border border-white/[0.06] overflow-hidden bg-[#0b0e14]/80 backdrop-blur-sm"
            >
                {/* Header */}
                <div className="grid grid-cols-[1fr_100px_100px] sm:grid-cols-[1fr_140px_140px] items-center px-6 py-4 border-b border-white/[0.06] bg-white/[0.02]">
                    <span className="text-sm font-medium text-slate-400">Capability</span>
                    <span className="text-center">
                        <span className="text-sm font-bold text-[#78b846]">Sage</span>
                    </span>
                    <span className="text-center">
                        <span className="text-sm font-medium text-slate-500">Traditional</span>
                    </span>
                </div>

                {/* Rows */}
                {features.map((feat, i) => (
                    <motion.div
                        key={feat.name}
                        initial={{ opacity: 0, x: -10 }}
                        animate={inView ? { opacity: 1, x: 0 } : {}}
                        transition={{ delay: 0.3 + i * 0.03, duration: 0.3 }}
                        className={`grid grid-cols-[1fr_100px_100px] sm:grid-cols-[1fr_140px_140px] items-center px-6 py-3.5 border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors group ${!feat.traditional ? '' : 'opacity-70'
                            }`}
                    >
                        <div className="pr-4">
                            <span className="text-sm text-white font-medium block">{feat.name}</span>
                            <span className="text-xs text-slate-600 group-hover:text-slate-500 transition-colors hidden sm:block">{feat.desc}</span>
                        </div>
                        <div className="flex justify-center">
                            {feat.sage ? <CheckIcon /> : <CrossIcon />}
                        </div>
                        <div className="flex justify-center">
                            {feat.traditional ? <CheckIcon /> : <CrossIcon />}
                        </div>
                    </motion.div>
                ))}
            </motion.div>

            {/* Bottom note */}
            <motion.p
                initial={{ opacity: 0 }}
                animate={inView ? { opacity: 1 } : {}}
                transition={{ delay: 0.8, duration: 0.4 }}
                className="text-center text-xs text-slate-600 mt-4 font-mono"
            >
                Compared against typical Discord bots like MEE6, Dyno, and Carl-bot
            </motion.p>
        </section>
    );
}

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { nativeToolCount } from '../lib/nativeTools.js';

const nativeToolsLabel = `${nativeToolCount}+`;

const pillars = [
    {
        icon: '🧠',
        title: 'Reasons, Not Just Responds',
        desc: 'A 7-stage memory pipeline and graph-native reasoning layer give Sage genuine contextual recall — not keyword matching.',
        accent: '#78b846',
    },
    {
        icon: '⚡',
        title: 'Acts Before You Ask',
        desc: `${nativeToolsLabel} autonomous tools activate proactively. Sage perceives intent, selects tools, and executes — zero-prompt automation.`,
        accent: '#7AA2F7',
    },
    {
        icon: '🔒',
        title: 'Your Infrastructure, Your Data',
        desc: 'Fully self-hosted with a provider-flexible OpenAI-compatible runtime. No vendor lock-in, zero data exfiltration.',
        accent: '#B49CEC',
    },
];

export default function WhySage() {
    const ref = useRef(null);
    const inView = useInView(ref, { once: true, margin: '-60px' });

    return (
        <section ref={ref} className="relative max-w-7xl mx-auto px-6 py-20">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5 }}
                className="text-center mb-12"
            >
                <h2 className="text-3xl lg:text-4xl font-bold text-white mb-3">
                    Why <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#78b846] to-[#a9df7c]">Sage</span>?
                </h2>
                <p className="text-base text-slate-400 max-w-xl mx-auto font-light">
                    Three pillars that make Sage fundamentally different from every other Discord bot.
                </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {pillars.map((pillar, i) => (
                    <motion.div
                        key={pillar.title}
                        initial={{ opacity: 0, y: 30 }}
                        animate={inView ? { opacity: 1, y: 0 } : {}}
                        transition={{ delay: 0.15 + i * 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                        className="group relative rounded-2xl border border-white/[0.05] bg-white/[0.02] p-8 hover:border-white/[0.1] hover:bg-white/[0.03] transition-all"
                    >
                        {/* Glow dot */}
                        <div
                            className="absolute top-6 right-6 w-2 h-2 rounded-full opacity-60"
                            style={{ backgroundColor: pillar.accent, boxShadow: `0 0 12px ${pillar.accent}40` }}
                        ></div>

                        <div className="text-3xl mb-4">{pillar.icon}</div>
                        <h3 className="text-lg font-bold text-white mb-2">{pillar.title}</h3>
                        <p className="text-sm text-slate-400 leading-relaxed font-light">{pillar.desc}</p>
                    </motion.div>
                ))}
            </div>
        </section>
    );
}

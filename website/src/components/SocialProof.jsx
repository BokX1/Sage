import { useState, useEffect, useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { nativeToolCount } from '../lib/nativeTools.js';

const stats = [
    { label: 'Native Tools', value: nativeToolCount, suffix: '+', icon: '⚡' },
    { label: 'Core Technologies', value: 13, suffix: '', icon: '🧬' },
    { label: 'Pipeline Stages', value: 7, suffix: '', icon: '🔗' },
    { label: 'OpenAI Compatible', value: null, suffix: '', icon: '🧠' },
];

function AnimatedCounter({ target, suffix, inView }) {
    const [count, setCount] = useState(0);

    useEffect(() => {
        if (!inView) return;
        let start = 0;
        const duration = 1800;
        const stepTime = 16;
        const steps = duration / stepTime;
        const increment = target / steps;

        const timer = setInterval(() => {
            start += increment;
            if (start >= target) {
                setCount(target);
                clearInterval(timer);
            } else {
                setCount(Math.floor(start));
            }
        }, stepTime);

        return () => clearInterval(timer);
    }, [inView, target]);

    return <span>{count}{suffix}</span>;
}

export default function SocialProof() {
    const ref = useRef(null);
    const inView = useInView(ref, { once: true, margin: '-50px' });

    return (
        <section ref={ref} className="relative max-w-7xl mx-auto px-6 py-12">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-0"
            >
                {/* GitHub Badge */}
                <a
                    href="https://github.com/BokX1/Sage"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-5 py-2.5 rounded-full bg-white/[0.04] border border-white/[0.06] hover:border-[#78b846]/30 hover:bg-white/[0.06] transition-all group"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-slate-400 group-hover:text-white transition-colors">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                    <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors">Star on GitHub</span>
                    <span className="text-xs font-mono text-[#78b846] bg-[#78b846]/10 px-2 py-0.5 rounded-full">OSS</span>
                </a>

                {/* Divider */}
                <div className="hidden sm:block w-px h-8 bg-white/10 mx-6"></div>

                {/* Stat Pills */}
                <div className="flex flex-wrap items-center justify-center gap-3">
                    {stats.map((stat, i) => (
                        <motion.div
                            key={stat.label}
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={inView ? { opacity: 1, scale: 1 } : {}}
                            transition={{ delay: 0.1 + i * 0.08, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.03] border border-white/[0.05]"
                        >
                            <span className="text-base">{stat.icon}</span>
                            {stat.value !== null ? (
                                <>
                                    <span className="font-bold text-white text-sm tabular-nums">
                                        <AnimatedCounter target={stat.value} suffix={stat.suffix} inView={inView} />
                                    </span>
                                    <span className="text-xs text-slate-500">{stat.label}</span>
                                </>
                            ) : (
                                <span className="text-xs font-medium text-white">{stat.label}</span>
                            )}
                        </motion.div>
                    ))}
                </div>
            </motion.div>

            {/* Tagline */}
            <motion.p
                initial={{ opacity: 0 }}
                animate={inView ? { opacity: 1 } : {}}
                transition={{ delay: 0.5, duration: 0.6 }}
                className="text-center text-xs text-slate-600 mt-4 font-mono tracking-wide"
            >
                Open source · Self-hosted · Zero data exfiltration
            </motion.p>
        </section>
    );
}

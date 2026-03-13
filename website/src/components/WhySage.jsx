import { useRef, useState } from 'react';
import { motion, useInView, useMotionValue, useTransform } from 'framer-motion';
import { nativeToolCount } from '../lib/nativeTools.js';

const nativeToolsLabel = `${nativeToolCount}+`;

const pillars = [
    {
        icon: '🧠',
        title: 'Reasons, Not Just Responds',
        desc: 'A 7-stage memory pipeline and graph-native reasoning layer give Sage genuine contextual recall — not keyword matching.',
        accent: '#78b846',
        pattern: 'circuit',
    },
    {
        icon: '⚡',
        title: 'Acts Before You Ask',
        desc: `${nativeToolsLabel} autonomous tools activate proactively. Sage perceives intent, selects tools, and executes — zero-prompt automation.`,
        accent: '#7AA2F7',
        pattern: 'dots',
    },
    {
        icon: '🔒',
        title: 'Your Infrastructure, Your Data',
        desc: 'Fully self-hosted with a provider-flexible OpenAI-compatible runtime. No vendor lock-in, zero data exfiltration.',
        accent: '#B49CEC',
        pattern: 'waves',
    },
];

function PatternBackground({ type, color }) {
    if (type === 'circuit') {
        return (
            <svg className="absolute inset-0 w-full h-full opacity-[0.04] pointer-events-none" xmlns="http://www.w3.org/2000/svg">
                <pattern id="circuit-bg" width="40" height="40" patternUnits="userSpaceOnUse">
                    <path d="M 0 20 L 15 20 L 20 15 L 20 0" fill="none" stroke={color} strokeWidth="1" />
                    <circle cx="20" cy="15" r="2" fill={color} />
                    <path d="M 40 20 L 25 20 L 20 25 L 20 40" fill="none" stroke={color} strokeWidth="1" />
                    <circle cx="20" cy="25" r="2" fill={color} />
                </pattern>
                <rect width="100%" height="100%" fill="url(#circuit-bg)" />
            </svg>
        );
    }
    if (type === 'dots') {
        return (
            <svg className="absolute inset-0 w-full h-full opacity-[0.05] pointer-events-none" xmlns="http://www.w3.org/2000/svg">
                <pattern id="dots-bg" width="20" height="20" patternUnits="userSpaceOnUse">
                    <circle cx="10" cy="10" r="1.5" fill={color} />
                </pattern>
                <rect width="100%" height="100%" fill="url(#dots-bg)" />
            </svg>
        );
    }
    // waves
    return (
        <svg className="absolute inset-0 w-full h-full opacity-[0.04] pointer-events-none" xmlns="http://www.w3.org/2000/svg">
            <pattern id="waves-bg" width="60" height="20" patternUnits="userSpaceOnUse">
                <path d="M 0 10 Q 15 0 30 10 Q 45 20 60 10" fill="none" stroke={color} strokeWidth="1" />
            </pattern>
            <rect width="100%" height="100%" fill="url(#waves-bg)" />
        </svg>
    );
}

function TiltCard({ pillar, index, inView }) {
    const cardRef = useRef(null);
    const [isHovered, setIsHovered] = useState(false);
    const mouseX = useMotionValue(0.5);
    const mouseY = useMotionValue(0.5);

    const rotateX = useTransform(mouseY, [0, 1], [8, -8]);
    const rotateY = useTransform(mouseX, [0, 1], [-8, 8]);

    const handleMouseMove = (e) => {
        if (!cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        mouseX.set((e.clientX - rect.left) / rect.width);
        mouseY.set((e.clientY - rect.top) / rect.height);
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        mouseX.set(0.5);
        mouseY.set(0.5);
    };

    return (
        <motion.div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={handleMouseLeave}
            initial={{ opacity: 0, y: 30 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ delay: 0.15 + index * 0.1, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            style={{
                rotateX: isHovered ? rotateX : 0,
                rotateY: isHovered ? rotateY : 0,
                transformPerspective: 1000,
                transformStyle: 'preserve-3d',
            }}
            className="group relative rounded-2xl border border-white/[0.05] bg-white/[0.02] p-8 hover:border-white/[0.12] hover:bg-white/[0.04] transition-all overflow-hidden"
        >
            {/* Animated pattern background */}
            <PatternBackground type={pillar.pattern} color={pillar.accent} />

            {/* Left accent border that grows on hover */}
            <motion.div
                className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-full"
                style={{ backgroundColor: pillar.accent }}
                initial={{ scaleY: 0, opacity: 0.5 }}
                animate={isHovered ? { scaleY: 1, opacity: 1 } : { scaleY: 0.3, opacity: 0.3 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            />

            {/* Glow dot */}
            <div
                className="absolute top-6 right-6 w-2 h-2 rounded-full opacity-60"
                style={{ backgroundColor: pillar.accent, boxShadow: `0 0 12px ${pillar.accent}40` }}
            ></div>

            {/* Spotlight glow on hover */}
            <motion.div
                className="absolute inset-0 rounded-2xl pointer-events-none"
                style={{
                    background: `radial-gradient(circle at ${mouseX.get() * 100}% ${mouseY.get() * 100}%, ${pillar.accent}15 0%, transparent 60%)`,
                    opacity: isHovered ? 1 : 0,
                }}
                transition={{ duration: 0.2 }}
            />

            <div className="relative z-10">
                <div className="text-3xl mb-4">{pillar.icon}</div>
                <h3 className="text-lg font-bold text-white mb-2">{pillar.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed font-light">{pillar.desc}</p>
            </div>
        </motion.div>
    );
}

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
                    <TiltCard key={pillar.title} pillar={pillar} index={i} inView={inView} />
                ))}
            </div>
        </section>
    );
}

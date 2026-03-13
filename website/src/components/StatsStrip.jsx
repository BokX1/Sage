import { useRef, useEffect, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import { nativeToolCount } from '../lib/nativeTools.js';

const stats = [
    { label: 'Native Tools', value: nativeToolCount, suffix: '+', color: '#78b846', max: 100 },
    { label: 'Prisma Tables', value: 17, suffix: '', color: '#7AA2F7', max: 30 },
    { label: 'Technologies', value: 14, suffix: '', color: '#BB9AF7', max: 20 },
    { label: 'Search Providers', value: 4, suffix: '', color: '#E0AF68', max: 10 },
    { label: 'OpenAI Compatible', value: null, suffix: '', color: '#FF9E64', max: 1 },
];

function AnimatedCounter({ target, suffix, duration = 1.5, isVisible }) {
    const [count, setCount] = useState(0);

    useEffect(() => {
        if (!isVisible) {
            setCount(0);
            return;
        }

        let animationFrameId = null;
        const animationStart = performance.now();

        const animate = (time) => {
            const progress = Math.min((time - animationStart) / (duration * 1000), 1);
            const nextCount = Math.floor(progress * target);

            setCount(progress >= 1 ? target : nextCount);

            if (progress < 1) {
                animationFrameId = window.requestAnimationFrame(animate);
            }
        };

        animationFrameId = window.requestAnimationFrame(animate);
        return () => {
            if (animationFrameId !== null) {
                window.cancelAnimationFrame(animationFrameId);
            }
        };
    }, [isVisible, target, duration]);

    return <>{count}{suffix}</>;
}

function RadialRing({ value, max, color, isVisible }) {
    const radius = 38;
    const circumference = 2 * Math.PI * radius;
    const progress = value !== null ? value / max : 1;
    const dashOffset = circumference - (progress * circumference);

    return (
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 96 96">
            {/* Background track */}
            <circle
                cx="48" cy="48" r={radius}
                fill="none"
                stroke="rgba(255,255,255,0.04)"
                strokeWidth="3"
            />
            {/* Animated progress arc */}
            <motion.circle
                cx="48" cy="48" r={radius}
                fill="none"
                stroke={color}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={circumference}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset: isVisible ? dashOffset : circumference }}
                transition={{ duration: 1.8, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
                style={{
                    filter: `drop-shadow(0 0 6px ${color}60)`,
                }}
            />
        </svg>
    );
}

export default function StatsStrip() {
    const ref = useRef(null);
    const isInView = useInView(ref, { once: true, margin: '-50px' });

    return (
        <motion.section
            ref={ref}
            className="max-w-7xl mx-auto px-6 py-12"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
        >
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-6">
                {stats.map((stat, i) => (
                    <motion.div
                        key={stat.label}
                        className="flex flex-col items-center"
                        initial={{ opacity: 0, y: 15 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.4, delay: i * 0.08 }}
                    >
                        {/* Radial ring container */}
                        <div className="relative w-24 h-24 flex items-center justify-center mb-3">
                            <RadialRing
                                value={stat.value}
                                max={stat.max}
                                color={stat.color}
                                isVisible={isInView}
                            />
                            {/* Glowing dot at top */}
                            <motion.div
                                className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full"
                                style={{
                                    backgroundColor: stat.color,
                                    boxShadow: `0 0 8px ${stat.color}`,
                                }}
                                initial={{ opacity: 0 }}
                                animate={isInView ? { opacity: [0.4, 1, 0.4] } : {}}
                                transition={{ duration: 2, repeat: Infinity, delay: i * 0.3 }}
                            />
                            {/* Center value */}
                            <div
                                className="text-2xl lg:text-3xl font-extrabold font-mono relative z-10"
                                style={{ color: stat.color }}
                            >
                                {stat.value !== null ? (
                                    <AnimatedCounter
                                        target={stat.value}
                                        suffix={stat.suffix}
                                        isVisible={isInView}
                                    />
                                ) : '✓'}
                            </div>
                        </div>
                        <div className="text-xs text-slate-500 uppercase tracking-wider font-medium text-center">
                            {stat.label}
                        </div>
                    </motion.div>
                ))}
            </div>
        </motion.section>
    );
}

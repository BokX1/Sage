import { useRef, useEffect, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import { nativeToolCount } from '../lib/nativeTools.js';

const stats = [
    { label: 'Native Tools', value: nativeToolCount, suffix: '+', color: '#78b846' },
    { label: 'Prisma Tables', value: 17, suffix: '', color: '#7AA2F7' },
    { label: 'Technologies', value: 14, suffix: '', color: '#BB9AF7' },
    { label: 'Search Providers', value: 4, suffix: '', color: '#E0AF68' },
    { label: 'OpenAI Compatible', value: null, suffix: '', color: '#FF9E64' },
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
                        className="text-center"
                        initial={{ opacity: 0, y: 15 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.4, delay: i * 0.08 }}
                    >
                        <div
                            className="text-3xl lg:text-4xl font-extrabold mb-1 font-mono"
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
                        <div className="text-xs text-slate-500 uppercase tracking-wider font-medium">
                            {stat.label}
                        </div>
                    </motion.div>
                ))}
            </div>
        </motion.section>
    );
}

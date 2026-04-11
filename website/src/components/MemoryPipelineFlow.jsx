import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

const stages = [
    { icon: '📩', label: 'Raw Message', desc: 'Discord event received', color: '#7AA2F7' },
    { icon: '📝', label: 'Ring Buffer', desc: 'Last N messages loaded from in-memory transcript', color: '#7AA2F7' },
    { icon: '📊', label: 'Rolling Summary', desc: 'LLM-generated channel summary injected', color: '#E0AF68' },
    { icon: '👤', label: 'User Profile', desc: 'Long-term personalization narrative from PostgreSQL', color: '#BB9AF7' },
    { icon: '🕸️', label: 'Social Graph', desc: 'Dunbar layers + reciprocity from Memgraph GNN', color: '#BB9AF7' },
    { icon: '🔧', label: 'Tool Queries', desc: 'Dynamic tool calls fire: search, files, voice analytics', color: '#E0AF68' },
    { icon: '🤖', label: 'LLM Context', desc: 'Complete context window assembled → sent to model', color: '#78b846' },
];

function PipelineStageCard({ stage, index, totalStages, progress }) {
    const stageThreshold = index / (totalStages - 1);
    const glowOpacity = useTransform(progress, [Math.max(0, stageThreshold - 0.1), stageThreshold], [0, 1]);
    const iconScale = useTransform(progress, [Math.max(0, stageThreshold - 0.05), stageThreshold], [0.8, 1]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.5, delay: index * 0.08 }}
            className="relative group"
        >
            <motion.div
                className="bento-cell p-4 text-center relative overflow-hidden"
                whileHover={{ scale: 1.05, borderColor: stage.color + '55' }}
            >
                <motion.div
                    className="absolute inset-0 rounded-3xl pointer-events-none"
                    style={{
                        background: `radial-gradient(circle at center, ${stage.color}10 0%, transparent 70%)`,
                        opacity: glowOpacity,
                    }}
                />

                <div className="relative z-10">
                    <motion.div
                        className="text-3xl mb-3"
                        style={{ scale: iconScale }}
                    >
                        {stage.icon}
                    </motion.div>
                    <h3 className="font-bold text-white text-xs mb-1">{stage.label}</h3>
                    <p className="text-[10px] text-slate-500 group-hover:text-slate-400 transition-colors leading-relaxed">
                        {stage.desc}
                    </p>
                </div>
            </motion.div>

            {index < totalStages - 1 && (
                <div className="hidden lg:block absolute -right-3 top-1/2 -translate-y-1/2 text-slate-600 text-xs z-20">
                    →
                </div>
            )}
        </motion.div>
    );
}

export default function MemoryPipelineFlow() {
    const containerRef = useRef(null);
    const { scrollYProgress } = useScroll({
        target: containerRef,
        offset: ['start end', 'end start']
    });

    // Map scroll to a progress value 0-1 that drives the pipeline
    const progress = useTransform(scrollYProgress, [0.1, 0.8], [0, 1]);

    return (
        <section ref={containerRef} className="relative max-w-7xl mx-auto px-6 py-24">
            <motion.div
                className="text-center mb-16"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
            >
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141a23] border border-[#2d4530] text-[#a9df7c] text-xs font-mono mb-6">
                    <span className="w-2 h-2 rounded-full bg-[#78b846] animate-pulse" />
                    Memory Pipeline
                </div>
                <h2 className="text-4xl lg:text-5xl font-extrabold text-white mb-4">
                    How Sage Builds{' '}
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#78b846] to-[#a9df7c]">
                        Perfect Context
                    </span>
                </h2>
                <p className="text-lg text-slate-400 max-w-2xl mx-auto font-light">
                    Every message triggers a 7-stage pipeline that assembles the ideal context window. Scroll to watch it flow.
                </p>
            </motion.div>

            {/* Pipeline Flow */}
            <div className="relative">
                {/* Connection Line */}
                <div className="hidden lg:block absolute top-1/2 left-0 right-0 h-px bg-white/5 -translate-y-1/2" />

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-4">
                    {stages.map((stage, index) => (
                        <PipelineStageCard
                            key={stage.label}
                            stage={stage}
                            index={index}
                            totalStages={stages.length}
                            progress={progress}
                        />
                    ))}
                </div>
            </div>
        </section>
    );
}

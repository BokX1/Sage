import { motion } from 'framer-motion';

const rawPrompt = 'draw a cat';
const refinedPrompt = 'A photorealistic ginger tabby cat sitting on a rain-slicked cyberpunk window ledge at dusk, neon reflections in the wet surface, volumetric fog, cinematic lighting, 8K detail, shallow depth of field';

export default function ImageRefinementDemo() {
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
                    Creative Intelligence
                </div>
                <h2 className="text-4xl lg:text-5xl font-extrabold text-white mb-4">
                    Agentic{' '}
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#78b846] to-[#a9df7c]">
                        Prompt Refinement
                    </span>
                </h2>
                <p className="text-lg text-slate-400 max-w-2xl mx-auto font-light">
                    Sage rewrites your image prompt using conversation context before calling the API. "Make it cyberpunk" just works.
                </p>
            </motion.div>

            <motion.div
                className="max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >
                {/* Before */}
                <div className="bento-cell p-6 relative overflow-hidden">
                    <div className="flex items-center gap-2 mb-4">
                        <span className="w-2 h-2 rounded-full bg-slate-500" />
                        <span className="text-xs font-mono text-slate-500">User Prompt</span>
                    </div>
                    <div className="bg-white/5 rounded-2xl p-4 mb-4 font-mono text-sm text-slate-400">
                        "{rawPrompt}"
                    </div>
                    <div className="w-full h-48 rounded-2xl bg-gradient-to-br from-[#141a23] to-[#0a0d14] border border-white/5 overflow-hidden relative">
                        <img src="/Sage/demo-cat-basic.png" alt="Basic cat result" className="w-full h-full object-cover opacity-60" />
                        <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-slate-600 font-mono bg-black/50 px-2 py-0.5 rounded">basic result</span>
                    </div>
                </div>

                {/* After */}
                <div className="bento-cell p-6 relative overflow-hidden" style={{ borderColor: 'rgba(120,184,70,0.2)' }}>
                    <motion.div
                        className="absolute inset-0 rounded-3xl pointer-events-none"
                        style={{ background: 'radial-gradient(circle at center, rgba(120,184,70,0.05) 0%, transparent 70%)' }}
                    />
                    <div className="relative z-10">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="w-2 h-2 rounded-full bg-[#78b846]" />
                            <span className="text-xs font-mono text-[#a9df7c]">Agentic-Refined Prompt</span>
                        </div>
                        <motion.div
                            className="bg-[#78b846]/5 border border-[#78b846]/10 rounded-2xl p-4 mb-4 font-mono text-xs text-[#a9df7c] leading-relaxed"
                            whileHover={{ borderColor: 'rgba(120,184,70,0.3)' }}
                        >
                            "{refinedPrompt}"
                        </motion.div>
                        <div className="w-full h-48 rounded-2xl border border-[#78b846]/10 overflow-hidden relative">
                            <img src="/Sage/demo-cat-cinematic.png" alt="Cinematic cat result" className="w-full h-full object-cover" />
                            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs text-[#a9df7c] font-mono bg-black/60 px-2 py-0.5 rounded">cinematic result</span>
                        </div>
                    </div>
                </div>
            </motion.div>

            {/* Explainer */}
            <motion.div
                className="max-w-2xl mx-auto text-center mt-8"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.5 }}
            >
                <p className="text-xs text-slate-600 font-mono">
                    Sage uses the last ~10 messages of context + reply references to enrich every image prompt automatically
                </p>
            </motion.div>
        </section>
    );
}

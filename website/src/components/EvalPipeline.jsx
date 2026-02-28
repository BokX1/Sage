import { motion } from 'framer-motion';

const judges = [
    { label: 'Primary Judge', icon: '⚖️', color: '#7AA2F7' },
    { label: 'Secondary Judge', icon: '⚖️', color: '#BB9AF7' },
    { label: 'Adjudicator', icon: '🏛️', color: '#E0AF68' },
];

export default function EvalPipeline() {
    return (
        <div className="bento-cell p-8">
            <div className="text-center mb-6">
                <h3 className="font-bold text-white text-lg mb-1">Dual-Judge Evaluation</h3>
                <p className="text-xs text-slate-500">Every response can be quality-scored before release</p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                {judges.map((judge, i) => (
                    <motion.div key={judge.label} className="flex items-center gap-4">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.8 }}
                            whileInView={{ opacity: 1, scale: 1 }}
                            viewport={{ once: true }}
                            transition={{ duration: 0.5, delay: i * 0.2 }}
                            whileHover={{ scale: 1.1 }}
                            className="bento-cell p-4 text-center min-w-[120px]"
                            style={{ borderColor: judge.color + '30' }}
                        >
                            <div className="text-2xl mb-2">{judge.icon}</div>
                            <div className="text-xs font-bold text-white">{judge.label}</div>
                            <motion.div
                                className="text-[10px] font-mono mt-1"
                                style={{ color: judge.color }}
                                initial={{ opacity: 0 }}
                                whileInView={{ opacity: 1 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.2 + 0.5 }}
                            >
                                score: 0.{85 + i * 3}
                            </motion.div>
                        </motion.div>

                        {/* Beam connector */}
                        {i < judges.length - 1 && (
                            <motion.div
                                className="hidden sm:flex items-center"
                                initial={{ opacity: 0, scaleX: 0 }}
                                whileInView={{ opacity: 1, scaleX: 1 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.2 + 0.3, duration: 0.4 }}
                            >
                                <div className="w-8 h-px" style={{ backgroundColor: judge.color + '40' }} />
                                <span className="text-slate-600 text-xs">→</span>
                                <div className="w-8 h-px" style={{ backgroundColor: judges[i + 1].color + '40' }} />
                            </motion.div>
                        )}
                    </motion.div>
                ))}
            </div>

            {/* Verdict */}
            <motion.div
                className="text-center mt-6"
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.8 }}
            >
                <motion.span
                    className="inline-block px-5 py-2 rounded-full bg-[#78b846]/15 text-[#a9df7c] font-mono text-sm font-bold border border-[#78b846]/30"
                    animate={{ scale: [1, 1.05, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                >
                    VERDICT: PASS ✓
                </motion.span>
            </motion.div>
        </div>
    );
}

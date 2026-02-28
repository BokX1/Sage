import { useState } from 'react';
import { motion } from 'framer-motion';

const modes = [
    {
        key: 'invite',
        label: 'Bot Invite',
        badge: 'Hosted',
        icon: '🌸',
        heading: 'Bring Your Own Pollen',
        desc: 'Invite the hosted Sage bot — each server admin provides a Pollinations API key via /sage key set. Zero infrastructure needed.',
        color: '#78b846',
        bg: 'from-[#78b846]/10 to-transparent',
        features: [
            { text: 'Pollinations.ai unified gateway', icon: '☁️' },
            { text: 'Server-wide key via /sage key set', icon: '🔑' },
            { text: 'Free tier available', icon: '🎁' },
            { text: 'Text, vision, image gen, voice', icon: '🎨' },
        ],
    },
    {
        key: 'selfhost',
        label: 'Self-Hosted',
        badge: 'Sovereign',
        icon: '🏛️',
        heading: 'Bring Your Own Provider',
        desc: 'Self-host Sage and choose your LLM backend — Pollinations, OpenAI-compatible endpoints, DeepSeek, Ollama, or any provider.',
        color: '#7AA2F7',
        bg: 'from-[#7AA2F7]/10 to-transparent',
        features: [
            { text: 'Pollinations (default)', icon: '🌸' },
            { text: 'Any OpenAI-compatible API', icon: '⚡' },
            { text: 'DeepSeek (data sovereignty)', icon: '🔒' },
            { text: 'Ollama (fully air-gapped)', icon: '🏠' },
        ],
    },
];

export default function SovereigntyShowcase() {
    const [active, setActive] = useState('invite');
    const mode = modes.find(m => m.key === active) ?? modes[0];

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
                    BYOP Architecture
                </div>
                <h2 className="text-4xl lg:text-5xl font-extrabold text-white mb-4">
                    Your Pollen.{' '}
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#78b846] to-[#a9df7c]">
                        Your Provider.
                    </span>
                </h2>
                <p className="text-lg text-slate-400 max-w-2xl mx-auto font-light">
                    BYOP = <strong className="text-white">Bring Your Own Pollen</strong> (hosted)
                    + <strong className="text-white">Bring Your Own Provider</strong> (self-hosted).
                    Choose how Sage connects to AI.
                </p>
            </motion.div>

            <motion.div
                className="grid grid-cols-1 lg:grid-cols-5 gap-4 max-w-5xl mx-auto"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7 }}
            >
                {/* Mode Toggles */}
                <div className="lg:col-span-2 flex flex-col gap-3">
                    {modes.map(m => (
                        <motion.button
                            type="button"
                            key={m.key}
                            onClick={() => setActive(m.key)}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className={`bento-cell p-5 text-left transition-all duration-300 ${active === m.key ? 'ring-1' : ''
                                }`}
                            style={{
                                borderColor: active === m.key ? m.color + '55' : undefined,
                                boxShadow: active === m.key ? `0 0 25px ${m.color}25` : undefined,
                            }}
                        >
                            <div className="flex items-center gap-3 mb-2">
                                <span className="text-2xl">{m.icon}</span>
                                <div>
                                    <span className="font-bold text-white block">{m.label}</span>
                                    <span className="text-[10px] text-slate-500 font-mono">{m.heading}</span>
                                </div>
                                <span
                                    className="ml-auto text-[10px] font-mono px-2 py-0.5 rounded-full"
                                    style={{ backgroundColor: m.color + '20', color: m.color }}
                                >
                                    {m.badge}
                                </span>
                            </div>
                            <p className="text-xs text-slate-500">{m.desc}</p>
                        </motion.button>
                    ))}
                </div>

                {/* Detail Panel */}
                <div className="lg:col-span-3 bento-cell p-8 flex flex-col justify-center relative overflow-hidden min-h-[300px]">
                    {/* Dynamic background gradient */}
                    <motion.div
                        key={active}
                        className={`absolute inset-0 bg-gradient-to-br ${mode.bg} pointer-events-none`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.5 }}
                    />

                    <motion.div
                        key={active + '-content'}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4 }}
                        className="relative z-10"
                    >
                        <div className="flex items-center gap-3 mb-6">
                            <span className="text-4xl">{mode.icon}</span>
                            <div>
                                <h3 className="text-xl font-bold text-white">{mode.heading}</h3>
                                <span
                                    className="inline-block text-[10px] font-mono px-2.5 py-0.5 rounded-full mt-1"
                                    style={{ backgroundColor: mode.color + '20', color: mode.color, border: `1px solid ${mode.color}30` }}
                                >
                                    {mode.badge}
                                </span>
                            </div>
                        </div>

                        {/* Feature list */}
                        <div className="space-y-3">
                            {mode.features.map((f, i) => (
                                <motion.div
                                    key={f.text}
                                    className="flex items-center gap-3 bg-white/[0.03] rounded-xl px-4 py-3 border border-white/5"
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.08 }}
                                >
                                    <span className="text-lg">{f.icon}</span>
                                    <span className="text-sm text-slate-300">{f.text}</span>
                                    <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ backgroundColor: mode.color }} />
                                </motion.div>
                            ))}
                        </div>

                        {/* Explainer */}
                        <p className="text-xs text-slate-600 font-mono mt-6 leading-relaxed">
                            {active === 'invite'
                                ? 'Admins run /sage key login → sign in via Pollinations (GitHub) → /sage key set sk_... → Sage is active for the whole server.'
                                : 'Set LLM_PROVIDER + LLM_BASE_URL + LLM_API_KEY in your .env to point Sage at any OpenAI-compatible endpoint.'}
                        </p>
                    </motion.div>
                </div>
            </motion.div>
        </section>
    );
}

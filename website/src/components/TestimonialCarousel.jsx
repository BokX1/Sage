import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const testimonials = [
    {
        quote: "Sage pulled the exact deployment decision from our summaries and message history before anyone had to dig through old threads. It's like having a teammate who remembers the entire server.",
        author: 'Community Admin',
        role: 'Discord Server · 500+ members',
        accent: '#78b846',
    },
    {
        quote: "We replaced three different bots with Sage. It handles moderation, summaries, file lookups, and even generates images — all through natural conversation.",
        author: 'Server Moderator',
        role: 'Open Source Community',
        accent: '#7AA2F7',
    },
    {
        quote: "Self-hosting Sage with our own LLM provider took 15 minutes. Full data sovereignty, zero API costs, and it just works with any OpenAI-compatible endpoint.",
        author: 'DevOps Engineer',
        role: 'Self-Hosted Deployment',
        accent: '#B49CEC',
    },
    {
        quote: "The approval flow is the killer feature. Sage can prepare real admin work in chat, but the risky stuff still lands in a review lane instead of going rogue.",
        author: 'Project Lead',
        role: 'Development Team · 40 members',
        accent: '#5CCCB4',
    },
];

export default function TestimonialCarousel() {
    const [current, setCurrent] = useState(0);
    const intervalRef = useRef(null);

    useEffect(() => {
        intervalRef.current = setInterval(() => {
            setCurrent(prev => (prev + 1) % testimonials.length);
        }, 6000);
        return () => clearInterval(intervalRef.current);
    }, []);

    const goTo = (idx) => {
        setCurrent(idx);
        clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => {
            setCurrent(prev => (prev + 1) % testimonials.length);
        }, 6000);
    };

    const t = testimonials[current];

    return (
        <section className="relative max-w-4xl mx-auto px-6 py-20">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
                className="text-center mb-12"
            >
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141a23] border border-[#2d4530] text-[#a9df7c] text-xs font-mono mb-6">
                    <span className="w-2 h-2 rounded-full bg-[#78b846]"></span>
                    Community Voices
                </div>
                <h2 className="text-3xl lg:text-4xl font-bold text-white mb-3">
                    What Teams Are <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#78b846] to-[#a9df7c]">Saying</span>
                </h2>
            </motion.div>

            <div className="relative min-h-[220px]">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={current}
                        initial={{ opacity: 0, y: 20, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -20, scale: 0.97 }}
                        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                        className="relative rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 lg:p-10 backdrop-blur-sm overflow-hidden"
                    >
                        {/* Accent glow */}
                        <div
                            className="absolute top-0 left-0 w-full h-[2px] opacity-60"
                            style={{ background: `linear-gradient(to right, transparent, ${t.accent}, transparent)` }}
                        />
                        <div
                            className="absolute top-0 left-1/2 -translate-x-1/2 w-[200px] h-[80px] blur-[60px] opacity-20 pointer-events-none"
                            style={{ backgroundColor: t.accent }}
                        />

                        {/* Quote icon */}
                        <div className="text-3xl mb-4 opacity-20" style={{ color: t.accent }}>❝</div>

                        {/* Quote text */}
                        <p className="text-lg lg:text-xl text-slate-300 font-light leading-relaxed mb-6 relative z-10">
                            {t.quote}
                        </p>

                        {/* Author */}
                        <div className="flex items-center gap-3 relative z-10">
                            <div
                                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                                style={{ backgroundColor: t.accent + '20', color: t.accent, border: `1px solid ${t.accent}30` }}
                            >
                                {t.author.charAt(0)}
                            </div>
                            <div>
                                <span className="text-sm font-semibold text-white block">{t.author}</span>
                                <span className="text-xs text-slate-500">{t.role}</span>
                            </div>
                        </div>
                    </motion.div>
                </AnimatePresence>
            </div>

            {/* Dots */}
            <div className="flex justify-center gap-2 mt-6">
                {testimonials.map((_, i) => (
                    <button
                        type="button"
                        key={i}
                        onClick={() => goTo(i)}
                        aria-label={`Go to testimonial ${i + 1}`}
                        className={`w-2 h-2 rounded-full transition-all duration-300 ${
                            i === current
                                ? 'w-6 bg-[#78b846] shadow-[0_0_8px_rgba(120,184,70,0.5)]'
                                : 'bg-white/10 hover:bg-white/20'
                        }`}
                    />
                ))}
            </div>

            {/* Subtle CTA */}
            <motion.p
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.3 }}
                className="text-center text-xs text-slate-600 mt-6 font-mono"
            >
                Early-access experiences from the Sage community
            </motion.p>
        </section>
    );
}

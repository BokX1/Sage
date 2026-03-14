import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const navLinks = [
    { href: '#tech-stack', label: 'Stack', icon: '🧬' },
    { href: '#tools', label: 'Tools', icon: '⚡' },
    { href: '#architecture', label: 'Architecture', icon: '🔧' },
    { href: '#comparison', label: 'Compare', icon: '⚖️' },
    { href: '#quickstart', label: 'Quick Start', icon: '🚀' },
];

export default function MobileNav() {
    const [isOpen, setIsOpen] = useState(false);

    // Lock body scroll when open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isOpen]);

    // Close on escape
    useEffect(() => {
        const handler = (e) => { if (e.key === 'Escape') setIsOpen(false); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    return (
        <div className="sm:hidden">
            {/* Hamburger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative z-[60] w-10 h-10 flex items-center justify-center rounded-lg bg-white/[0.06] border border-white/[0.08] hover:bg-white/[0.1] transition-all"
                aria-label={isOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={isOpen}
            >
                <div className="w-5 h-4 flex flex-col justify-between">
                    <motion.span
                        animate={isOpen ? { rotate: 45, y: 6 } : { rotate: 0, y: 0 }}
                        transition={{ duration: 0.2 }}
                        className="block w-full h-0.5 bg-white/80 rounded-full origin-center"
                    />
                    <motion.span
                        animate={isOpen ? { opacity: 0, scaleX: 0 } : { opacity: 1, scaleX: 1 }}
                        transition={{ duration: 0.15 }}
                        className="block w-full h-0.5 bg-white/80 rounded-full"
                    />
                    <motion.span
                        animate={isOpen ? { rotate: -45, y: -6 } : { rotate: 0, y: 0 }}
                        transition={{ duration: 0.2 }}
                        className="block w-full h-0.5 bg-white/80 rounded-full origin-center"
                    />
                </div>
            </button>

            {/* Overlay + Drawer */}
            <AnimatePresence>
                {isOpen && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm"
                            onClick={() => setIsOpen(false)}
                        />

                        {/* Drawer */}
                        <motion.nav
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                            className="fixed top-0 right-0 z-[58] h-full w-72 bg-[#0b0e14]/95 backdrop-blur-xl border-l border-white/[0.06] shadow-2xl flex flex-col"
                        >
                            {/* Header */}
                            <div className="flex items-center gap-3 px-6 pt-6 pb-4 border-b border-white/[0.06]">
                                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#78b846] to-[#2d4530] flex items-center justify-center font-bold text-[#050608] text-sm shadow-[0_0_15px_rgba(120,184,70,0.5)]">S</div>
                                <span className="font-sans font-bold text-lg tracking-tight text-white">Sage</span>
                            </div>

                            {/* Links */}
                            <div className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
                                {navLinks.map((link, i) => (
                                    <motion.a
                                        key={link.href}
                                        href={link.href}
                                        onClick={() => setIsOpen(false)}
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: 0.05 + i * 0.04, duration: 0.3 }}
                                        className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-300 hover:text-white hover:bg-white/[0.06] transition-all text-sm font-medium"
                                    >
                                        <span className="text-base">{link.icon}</span>
                                        {link.label}
                                    </motion.a>
                                ))}
                            </div>

                            {/* CTA */}
                            <div className="px-4 pb-6 space-y-3">
                                <a
                                    href="https://github.com/BokX1/Sage"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => setIsOpen(false)}
                                    className="flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl bg-[#78b846] text-[#050608] font-semibold text-sm hover:bg-[#a9df7c] transition-all shadow-[0_0_20px_rgba(120,184,70,0.3)]"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
                                    View on GitHub
                                </a>
                            </div>
                        </motion.nav>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}

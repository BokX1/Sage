import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import MobileNav from './MobileNav.jsx';

const navLinks = [
    { href: '#tech-stack', label: 'Stack' },
    { href: '#tools', label: 'Tools' },
    { href: '#architecture', label: 'Architecture' },
    { href: '#comparison', label: 'Compare' },
];

export default function NavBar() {
    const [scrolled, setScrolled] = useState(false);
    const [activeSection, setActiveSection] = useState('');

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 60);

            // Determine active section based on scroll position
            const sections = navLinks.map(l => l.href.replace('#', ''));
            let current = '';
            for (const id of sections) {
                const el = document.getElementById(id);
                if (el) {
                    const rect = el.getBoundingClientRect();
                    if (rect.top <= 200) {
                        current = id;
                    }
                }
            }
            setActiveSection(current);
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <nav
            className={`fixed top-0 left-0 right-0 z-50 px-6 border-b border-white/5 nav-compact ${scrolled ? 'scrolled' : 'py-4 glass-panel'}`}
        >
            <div className="max-w-7xl mx-auto flex justify-between items-center">
                <a href="#" className="flex items-center gap-3 group">
                    <motion.div
                        className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#78b846] to-[#2d4530] flex items-center justify-center font-bold text-[#050608] shadow-[0_0_15px_rgba(120,184,70,0.5)]"
                        whileHover={{ scale: 1.1, rotate: 5 }}
                        transition={{ type: 'spring', stiffness: 400 }}
                    >
                        S
                    </motion.div>
                    <span className="font-sans font-bold text-xl tracking-tight text-white">Sage</span>
                </a>
                <div className="flex items-center gap-6 text-sm font-medium">
                    {navLinks.map(link => {
                        const isActive = activeSection === link.href.replace('#', '');
                        return (
                            <a
                                key={link.href}
                                href={link.href}
                                className={`relative hidden sm:inline transition-colors duration-300 ${isActive ? 'text-[#a9df7c]' : 'text-slate-400 hover:text-[#78b846]'}`}
                            >
                                {link.label}
                                {isActive && (
                                    <motion.div
                                        layoutId="nav-indicator"
                                        className="absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-[#78b846]"
                                        style={{ boxShadow: '0 0 8px rgba(120, 184, 70, 0.5)' }}
                                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                    />
                                )}
                            </a>
                        );
                    })}
                    <a
                        href="#quickstart"
                        className="px-5 py-2.5 rounded-full bg-[#78b846] text-[#050608] font-semibold hover:bg-[#a9df7c] transition-all hidden sm:inline-flex border-glow text-sm"
                    >
                        Get Sage
                    </a>
                    <a
                        href="https://github.com/BokX1/Sage"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 transition-all hidden sm:inline-flex items-center justify-center"
                        aria-label="GitHub Repository"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="text-slate-300"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                    </a>
                    <MobileNav />
                </div>
            </div>
        </nav>
    );
}

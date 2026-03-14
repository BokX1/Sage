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
                        href="https://github.com/BokX1/Sage"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 transition-all hidden sm:inline-flex"
                    >
                        View on GitHub
                    </a>
                    <MobileNav />
                </div>
            </div>
        </nav>
    );
}

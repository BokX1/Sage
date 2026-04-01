import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const BASE = "https://github.com/BokX1/Sage/blob/master/docs";

const pages = [
    // ── Guides ──
    { title: "Quickstart Guide", url: `${BASE}/guides/QUICKSTART.md`, icon: "⚡", cat: "guide" },
    { title: "Getting Started", url: `${BASE}/guides/GETTING_STARTED.md`, icon: "🚀", cat: "guide" },
    { title: "Conversation & Controls", url: `${BASE}/guides/COMMANDS.md`, icon: "🎮", cat: "guide" },
    { title: "BYOP Setup", url: `${BASE}/guides/BYOP.md`, icon: "🔑", cat: "guide" },
    { title: "FAQ", url: `${BASE}/guides/FAQ.md`, icon: "❓", cat: "guide" },
    { title: "Troubleshooting", url: `${BASE}/guides/TROUBLESHOOTING.md`, icon: "🔧", cat: "guide" },

    // ── Architecture ──
    { title: "Architecture Overview", url: `${BASE}/architecture/OVERVIEW.md`, icon: "🏗️", cat: "architecture" },
    { title: "Memory Pipeline", url: `${BASE}/architecture/MEMORY.md`, icon: "🧠", cat: "architecture" },
    { title: "Database Schema", url: `${BASE}/architecture/DATABASE.md`, icon: "🗄️", cat: "architecture" },
    { title: "Processing Pipeline", url: `${BASE}/architecture/PIPELINE.md`, icon: "⚙️", cat: "architecture" },
    { title: "Search Architecture", url: `${BASE}/architecture/SEARCH.md`, icon: "🔍", cat: "architecture" },

    // ── Operations ──
    { title: "Deployment Guide", url: `${BASE}/operations/DEPLOYMENT.md`, icon: "📦", cat: "operations" },
    { title: "Runbook", url: `${BASE}/operations/RUNBOOK.md`, icon: "📋", cat: "operations" },
    { title: "Tool Stack", url: `${BASE}/operations/TOOL_STACK.md`, icon: "🛠️", cat: "operations" },

    // ── Reference ──
    { title: "Configuration Reference", url: `${BASE}/reference/CONFIGURATION.md`, icon: "⚙️", cat: "reference" },
    { title: "API Examples", url: `${BASE}/reference/API_EXAMPLES.md`, icon: "📡", cat: "reference" },
    { title: "Models Reference", url: `${BASE}/reference/MODELS.md`, icon: "🤖", cat: "reference" },
    { title: "Hosted Integration", url: `${BASE}/reference/POLLINATIONS.md`, icon: "🐝", cat: "reference" },
    { title: "Release Notes", url: `${BASE}/reference/RELEASE.md`, icon: "📝", cat: "reference" },

    // ── Security ──
    { title: "Security & Privacy", url: `${BASE}/security/SECURITY_PRIVACY.md`, icon: "🔒", cat: "security" },

    // ── Index ──
    { title: "Documentation Index", url: `${BASE}/INDEX.md`, icon: "📚", cat: "index" },
];

const CommandPalette = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState("");
    const inputRef = useRef(null);
    const focusTimerRef = useRef(null);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setIsOpen(prev => !prev);
            }
            if (e.key === 'Escape') {
                setIsOpen(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Focus input on open
    useEffect(() => {
        if (isOpen) {
            focusTimerRef.current = setTimeout(() => inputRef.current?.focus(), 50);
        } else {
            setQuery('');
        }

        return () => {
            if (focusTimerRef.current) {
                clearTimeout(focusTimerRef.current);
                focusTimerRef.current = null;
            }
        };
    }, [isOpen]);

    const q = query.toLowerCase();
    const filteredPages = pages.filter(p => p.title.toLowerCase().includes(q) || p.cat.includes(q));

    return (
        <>
            {/* Global floating button */}
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                aria-expanded={isOpen}
                aria-haspopup="dialog"
                aria-label="Open documentation search (Ctrl or Command plus K)"
                className="fixed bottom-5 right-4 lg:bottom-8 lg:right-8 z-[90] px-4 py-3 rounded-full bg-[#141a23]/80 backdrop-blur border border-white/10 text-slate-300 text-sm font-medium hover:bg-white/10 hover:border-[#78b846]/50 transition-all shadow-lg flex items-center gap-3 group"
            >
                <span className="text-slate-400 group-hover:text-[#a9df7c] transition-colors">Search Docs</span>
                <div className="flex items-center gap-1 font-mono text-[10px] text-slate-500 bg-black/20 px-2 py-1 rounded">
                    <span className="border border-slate-700/50 rounded px-1.5 leading-tight">⌘</span>
                    <span className="border border-slate-700/50 rounded px-1.5 leading-tight">K</span>
                </div>
            </button>

            <AnimatePresence>
                {isOpen && (
                    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[10vh] px-4">
                        {/* Backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-[#06080d]/80 backdrop-blur-sm"
                            onClick={() => setIsOpen(false)}
                        />

                        {/* Modal */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: -20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: -20 }}
                            transition={{ duration: 0.2 }}
                            role="dialog"
                            aria-modal="true"
                            aria-label="Documentation search"
                            className="relative w-full max-w-2xl bg-[#0c1017] rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.8)] border border-white/10 overflow-hidden flex flex-col"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="relative border-b border-white/5 bg-[#141a23]">
                                <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 text-xl">🔍</span>
                                <input
                                    ref={inputRef}
                                    type="text"
                                    placeholder="Search documentation, guides, or controls..."
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    aria-label="Search documentation"
                                    className="w-full bg-transparent border-none text-white text-lg px-14 py-5 focus:outline-none focus:ring-0 placeholder-slate-500"
                                />
                                <div className="absolute right-6 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                    <span className="text-[10px] text-slate-500 font-mono bg-black/30 px-2 py-1 rounded border border-white/5">ESC to close</span>
                                </div>
                            </div>

                            <div className="max-h-[60vh] overflow-y-auto p-4 custom-scrollbar">
                                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 px-3">Documentation</h4>
                                <ul className="flex flex-col gap-1">
                                    {filteredPages.length > 0 ? (
                                        filteredPages.map((page) => (
                                            <li key={page.url}>
                                                <a
                                                    href={page.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-4 px-3 py-3 rounded-xl hover:bg-[#78b846]/10 hover:border hover:border-[#78b846]/20 transition-all group"
                                                >
                                                    <span className="text-xl opacity-80 group-hover:opacity-100">{page.icon}</span>
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-slate-300 font-medium group-hover:text-white">{page.title}</span>
                                                            <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-white/5 text-slate-500">{page.cat}</span>
                                                        </div>
                                                        <span className="text-xs text-slate-500 font-mono mt-0.5 block truncate">{page.url.replace(`${BASE}/`, "")}</span>
                                                    </div>
                                                    <span className="text-slate-600 group-hover:text-[#a9df7c] opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
                                                </a>
                                            </li>
                                        ))
                                    ) : (
                                        <li className="px-3 py-8 text-center text-slate-500 text-sm">
                                            No results found for "{query}". Try checking the <a href="https://github.com/BokX1/Sage/tree/master/docs" target="_blank" rel="noopener noreferrer" className="text-[#a9df7c] hover:underline">docs folder</a> directly.
                                        </li>
                                    )}
                                </ul>
                            </div>

                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    );
};

export default CommandPalette;

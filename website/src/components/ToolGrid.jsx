import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const tools = [
    // Discord (cyan) - Read Only
    { name: 'help', short: 'Help', desc: 'Get usage instructions and command help', cat: 'discord', color: '#7AA2F7' },
    { name: 'memory.get_user', short: 'Get User', desc: 'Retrieve detailed information about a Discord user', cat: 'discord', color: '#7AA2F7' },
    { name: 'memory.get_channel', short: 'Get Channel', desc: 'Retrieve detailed information about a Discord channel', cat: 'discord', color: '#7AA2F7' },
    { name: 'memory.channel_archives', short: 'Search Archives', desc: 'Search deep channel history and archived threads', cat: 'discord', color: '#7AA2F7' },
    { name: 'memory.get_server', short: 'Get Server', desc: 'Retrieve guild and server metadata', cat: 'discord', color: '#7AA2F7' },
    { name: 'files.list_channel', short: 'Channel Files', desc: 'Look up files shared in a specific channel', cat: 'discord', color: '#7AA2F7' },
    { name: 'files.list_server', short: 'Server Files', desc: 'Look up files shared across the entire server', cat: 'discord', color: '#7AA2F7' },
    { name: 'files.find_channel', short: 'Search Ch. Files', desc: 'Search for specific file types or names in a channel', cat: 'discord', color: '#7AA2F7' },
    { name: 'files.find_server', short: 'Search Sv. Files', desc: 'Search for specific file types or names in the server', cat: 'discord', color: '#7AA2F7' },
    { name: 'files.read_attachment', short: 'Read Attachment', desc: 'Read cached attachment text in pages (continuation-friendly)', cat: 'discord', color: '#7AA2F7' },
    { name: 'messages.search_history', short: 'Search History', desc: 'Hybrid semantic/keyword/regex search (time-windowed)', cat: 'discord', color: '#7AA2F7' },
    { name: 'messages.search_with_context', short: 'Search+Context', desc: 'Search + expand surrounding context in one call', cat: 'discord', color: '#7AA2F7' },
    { name: 'messages.get_context', short: 'Get Context', desc: 'Fetch messages before/after a message ID', cat: 'discord', color: '#7AA2F7' },
    { name: 'messages.search_guild', short: 'Search Guild', desc: 'Cross-channel message search across the server (permission-filtered)', cat: 'discord', color: '#7AA2F7' },
    { name: 'messages.user_timeline', short: 'User Timeline', desc: 'Recent messages from a user across the server (permission-filtered)', cat: 'discord', color: '#7AA2F7' },
    { name: 'analytics.get_social_graph', short: 'Social Graph', desc: 'Analyze user interaction graphs and network centrality', cat: 'discord', color: '#7AA2F7' },
    { name: 'analytics.get_voice_analytics', short: 'Voice Analytics', desc: 'Retrieve voice channel participation analytics', cat: 'discord', color: '#7AA2F7' },
    { name: 'analytics.voice_summaries', short: 'Voice Summaries', desc: 'Get summarized transcripts from voice sessions', cat: 'discord', color: '#7AA2F7' },
    { name: 'oauth2.invite_url', short: 'Invite URL', desc: 'Generate a bot installation invite link', cat: 'discord', color: '#7AA2F7' },
    // Discord (cyan) - Writes
    { name: 'messages.send', short: 'Send Message', desc: 'Send a new message or rich embed to a channel', cat: 'discord', color: '#7AA2F7' },
    { name: 'polls.create', short: 'Create Poll', desc: 'Create an interactive Discord poll', cat: 'discord', color: '#7AA2F7' },
    { name: 'threads.create', short: 'Create Thread', desc: 'Start a new conversation thread', cat: 'discord', color: '#7AA2F7' },
    { name: 'reactions.add', short: 'Add Reaction', desc: 'Add emoji reactions to existing messages', cat: 'discord', color: '#7AA2F7' },
    { name: 'reactions.remove_self', short: 'Remove Reaction', desc: 'Remove own emoji reactions from messages', cat: 'discord', color: '#7AA2F7' },
    // Discord (cyan) - Admin Only
    { name: 'memory.update_server', short: 'Sync Server', desc: 'Queue a full background sync of server memory', cat: 'discord', color: '#7AA2F7' },
    { name: 'moderation.submit', short: 'Mod Queue', desc: 'Queue moderation actions based on policy', cat: 'discord', color: '#7AA2F7' },
    { name: 'messages.edit', short: 'Edit Message', desc: 'Modify contents of an existing bot message', cat: 'discord', color: '#7AA2F7' },
    { name: 'messages.delete', short: 'Delete Message', desc: 'Delete an offending message (Admin only)', cat: 'discord', color: '#7AA2F7' },
    { name: 'messages.pin', short: 'Pin Message', desc: 'Pin an important message to the channel', cat: 'discord', color: '#7AA2F7' },
    { name: 'messages.unpin', short: 'Unpin Message', desc: 'Unpin a message from the channel', cat: 'discord', color: '#7AA2F7' },
    { name: 'channels.create', short: 'Create Channel', desc: 'Create a new text or voice channel', cat: 'discord', color: '#7AA2F7' },
    { name: 'channels.edit', short: 'Edit Channel', desc: 'Modify channel settings or permissions', cat: 'discord', color: '#7AA2F7' },
    { name: 'roles.create', short: 'Create Role', desc: 'Create a new server role', cat: 'discord', color: '#7AA2F7' },
    { name: 'roles.edit', short: 'Edit Role', desc: 'Modify existing server role permissions', cat: 'discord', color: '#7AA2F7' },
    { name: 'roles.delete', short: 'Delete Role', desc: 'Delete a server role', cat: 'discord', color: '#7AA2F7' },
    { name: 'members.add_role', short: 'Add Role', desc: 'Assign a role to a server member', cat: 'discord', color: '#7AA2F7' },
    { name: 'members.remove_role', short: 'Remove Role', desc: 'Remove a role from a server member', cat: 'discord', color: '#7AA2F7' },
    { name: 'discord.api', short: 'Discord API', desc: 'Raw Discord REST passthrough (admin-only, guild-scoped)', cat: 'discord', color: '#7AA2F7' },
    // Search (amber)
    { name: 'web', short: 'Web', desc: 'Unified web research (search/read/extract/research) with provider fallback', cat: 'search', color: '#E0AF68' },
    { name: 'wikipedia_search', short: 'Wikipedia', desc: 'Search and extract Wikipedia articles', cat: 'search', color: '#E0AF68' },
    { name: 'stack_overflow_search', short: 'Stack Overflow', desc: 'Search Stack Overflow for code solutions', cat: 'search', color: '#E0AF68' },
    // Dev (purple)
    { name: 'github', short: 'GitHub', desc: 'Unified GitHub (repo/code/file paging+ranges/issues+PRs/commits)', cat: 'dev', color: '#BB9AF7' },
    { name: 'npm_info', short: 'NPM Package', desc: 'Lookup npm package details and versions', cat: 'dev', color: '#BB9AF7' },
    { name: 'workflow', short: 'Workflow', desc: 'Composable one-shot workflows (e.g. npm → GitHub code search)', cat: 'dev', color: '#BB9AF7' },
    // Generation (green)
    { name: 'image_generate', short: 'Image Gen', desc: 'Generate images with agentic prompt refinement', cat: 'gen', color: '#78b846' },
    // System (green)
    { name: 'system_plan', short: 'Reflection', desc: 'Internal reasoning step before complex actions', cat: 'system', color: '#78b846' },
    { name: 'system_time', short: 'DateTime', desc: 'Get current date, time, and UTC offset', cat: 'system', color: '#78b846' },
    { name: 'system_tool_stats', short: 'Tool Stats', desc: 'Inspect in-process tool latency, caching, and failure stats', cat: 'system', color: '#78b846' },
];

const categories = [
    { key: 'all', label: 'All Tools', count: tools.length, color: '#78b846' },
    { key: 'discord', label: 'Discord', count: tools.filter(t => t.cat === 'discord').length, color: '#7AA2F7' },
    { key: 'search', label: 'Search', count: tools.filter(t => t.cat === 'search').length, color: '#E0AF68' },
    { key: 'dev', label: 'Developer', count: tools.filter(t => t.cat === 'dev').length, color: '#BB9AF7' },
    { key: 'gen', label: 'Creative', count: tools.filter(t => t.cat === 'gen').length, color: '#78b846' },
    { key: 'system', label: 'System', count: tools.filter(t => t.cat === 'system').length, color: '#78b846' },
];

// SVG Circuit Background with Dynamic Pattern
function CircuitPaths({ activeColor }) {
    return (
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40 transition-opacity duration-1000" preserveAspectRatio="none">
            <defs>
                <pattern id="grid-pattern" width="40" height="40" patternUnits="userSpaceOnUse">
                    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
                </pattern>
                <linearGradient id="circuit-fade" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="transparent" />
                    <stop offset="20%" stopColor={activeColor} />
                    <stop offset="80%" stopColor={activeColor} />
                    <stop offset="100%" stopColor="transparent" />
                </linearGradient>
            </defs>

            <rect width="100%" height="100%" fill="url(#grid-pattern)" />

            <g stroke="url(#circuit-fade)" strokeWidth="1" fill="none" opacity="0.4">
                <path d="M0,150 L100,150 L120,170 L1000,170" />
                <path d="M0,300 L200,300 L220,280 L1200,280" />
                <path d="M0,450 L50,450 L70,470 L800,470" />
                <path d="M0,600 L150,600 L170,580 L1000,580" />
                <path d="M0,750 L300,750 L320,770 L1200,770" />

                <path d="M120,170 L120,800" />
                <path d="M220,280 L220,800" />
                <path d="M70,470 L70,800" />
                <path d="M170,580 L170,800" />
                <path d="M320,770 L320,800" />
            </g>

            <motion.g
                stroke={activeColor} strokeWidth="2" fill="none" opacity="0.8"
                initial={{ strokeDasharray: "10, 1000", strokeDashoffset: 1000 }}
                animate={{ strokeDashoffset: 0 }}
                transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
            >
                <path d="M0,150 L100,150 L120,170 L120,800" />
                <path d="M0,300 L200,300 L220,280 L220,800" />
                <path d="M0,600 L150,600 L170,580 L170,800" />
            </motion.g>
        </svg>
    )
}

function ToolCard({ tool }) {
    const cardRef = useRef(null);
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
    const [isHovered, setIsHovered] = useState(false);

    const handleMouseMove = (e) => {
        if (!cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        setMousePosition({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        });
    };

    return (
        <motion.div
            ref={cardRef}
            layout
            onMouseMove={handleMouseMove}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -15 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="relative p-5 rounded-xl bg-[#0d1218]/90 backdrop-blur-xl transition-all duration-700 cursor-default overflow-hidden group border border-white/5"
            style={{
                transformStyle: 'preserve-3d',
            }}
        >
            {/* Spotlight Flare Effect tracking mouse */}
            <motion.div
                className="absolute pointer-events-none rounded-full"
                animate={{ x: mousePosition.x - 200, y: mousePosition.y - 200, opacity: isHovered ? 1 : 0 }}
                transition={{ type: 'tween', ease: 'linear', duration: 0.1 }}
                style={{
                    width: '400px', height: '400px',
                    background: `radial-gradient(circle, ${tool.color}15 0%, transparent 60%)`,
                    zIndex: 0
                }}
            />

            {/* Glowing active border on hover */}
            <div
                className="absolute inset-0 rounded-xl transition-opacity duration-500 pointer-events-none z-10"
                style={{
                    opacity: isHovered ? 1 : 0,
                    boxShadow: `inset 0 0 0 1px ${tool.color}50`,
                }}
            />

            {/* Circuit connection pin */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-10 rounded-r-md transition-all duration-500 z-10"
                style={{ backgroundColor: tool.color, opacity: isHovered ? 1 : 0.4 }} />

            <div className="flex items-center justify-between mb-3 relative z-20">
                <span className="font-bold text-white tracking-wide group-hover:text-white transition-colors" style={{ textShadow: isHovered ? `0 0 12px ${tool.color}80` : 'none' }}>
                    {tool.short}
                </span>
                <span className="text-[9px] uppercase font-bold tracking-widest px-2 py-0.5 rounded-sm bg-black/40 border border-white/5" style={{ color: tool.color }}>
                    {tool.cat}
                </span>
            </div>

            <p className="text-xs text-slate-400 group-hover:text-slate-300 transition-colors mb-4 line-clamp-2 h-[34px] relative z-20 leading-relaxed font-light">
                {tool.desc}
            </p>

            <div className="pt-3 border-t border-white/5 relative z-20 overflow-hidden">
                <code className="text-[10px] font-mono block truncate opacity-50 group-hover:opacity-100 transition-all duration-500"
                    style={{
                        color: isHovered ? '#fff' : '#94a3b8',
                        textShadow: isHovered ? `0 0 8px ${tool.color}` : 'none'
                    }}>
                    <span style={{ color: tool.color, opacity: 0.7 }} className="mr-1">function</span>
                    {tool.name}()
                </code>
            </div>
        </motion.div>
    );
}

export default function ToolGrid() {
    const [activeFilter, setActiveFilter] = useState('all');
    const [expandedSections, setExpandedSections] = useState(['discord']); // Open discord by default

    const activeColor = useMemo(() => {
        return categories.find(c => c.key === activeFilter)?.color || '#78b846';
    }, [activeFilter]);

    const handleFilterClick = (key) => {
        setActiveFilter(key);
        if (key === 'all') {
            // Expand all sections if "All" is clicked
            setExpandedSections(categories.filter(c => c.key !== 'all').map(c => c.key));
        } else {
            // Auto-collapse others, open the clicked one
            setExpandedSections([key]);
        }
    };

    const toggleSection = (key) => {
        const isCurrentlyExpanded = expandedSections.includes(key);
        const nextExpanded = isCurrentlyExpanded
            ? expandedSections.filter(section => section !== key)
            : [...expandedSections, key];

        setExpandedSections(nextExpanded);

        if (!isCurrentlyExpanded && activeFilter !== 'all') {
            setActiveFilter(key);
        } else if (isCurrentlyExpanded && nextExpanded.length === 0) {
            setActiveFilter('all');
        }
    };

    return (
        <section className="relative w-full max-w-7xl mx-auto px-6 py-28 min-h-screen overflow-hidden" id="tools">
            {/* Central Radial Glow */}
            <motion.div
                className="absolute inset-0 pointer-events-none -z-10 bg-repeat"
                animate={{ background: `radial-gradient(circle at center, ${activeColor}0c 0%, transparent 65%)` }}
                transition={{ duration: 0.8 }}
            />

            {/* Global Scanning Line effect */}
            <motion.div
                className="absolute left-0 right-0 h-[1px] -z-10 pointer-events-none opacity-20"
                style={{ background: `linear-gradient(to right, transparent, ${activeColor}, transparent)`, boxShadow: `0 0 20px 2px ${activeColor}` }}
                animate={{ top: ['0%', '100%'] }}
                transition={{ duration: 8, ease: "linear", repeat: Infinity }}
            />

            <CircuitPaths activeColor={activeColor} />

            <motion.div
                className="text-center mb-16 relative z-10"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
            >
                <motion.div
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141a23]/60 backdrop-blur-md border border-white/10 text-xs font-mono mb-8 transition-colors shadow-2xl"
                    animate={{ color: activeColor, borderColor: `${activeColor}40` }}
                >
                    <motion.span
                        className="w-2 h-2 rounded-full animate-pulse"
                        animate={{ backgroundColor: activeColor, boxShadow: `0 0 10px ${activeColor}` }}
                    />
                    Live Component Registry
                </motion.div>
                <h2 className="text-4xl lg:text-5xl font-extrabold text-white mb-5 leading-tight tracking-tight drop-shadow-lg">
                    <span className="text-transparent bg-clip-text" style={{ backgroundImage: `linear-gradient(to right, ${activeColor}, #ffffff)` }}>
                        {tools.length} Native Tools.
                    </span>{' '}
                    Zero Plugins.
                </h2>
                <p className="text-lg text-slate-400 max-w-2xl mx-auto font-light leading-relaxed">
                    Every node is an autonomous agentic capability, strongly typed by Zod, and routed dynamically by the engine based on contextual need.
                </p>
            </motion.div>

            {/* Sticky Category Filter */}
            <div className="flex flex-wrap justify-center gap-2 mb-16 relative z-50 sticky top-24 py-4 backdrop-blur-xl bg-[#0b0f13]/80 rounded-2xl border border-white/5 shadow-2xl">
                {categories.map(cat => (
                    <button
                        type="button"
                        key={cat.key}
                        onClick={() => handleFilterClick(cat.key)}
                        className={`
                            px-5 py-2 rounded-full text-sm font-medium transition-all duration-400
                            ${activeFilter === cat.key
                                ? 'text-white scale-[1.03]'
                                : 'bg-transparent text-slate-400 hover:bg-white/5 hover:text-white'
                            }
                        `}
                        style={{
                            backgroundColor: activeFilter === cat.key ? `${cat.color}25` : undefined,
                            borderColor: activeFilter === cat.key ? `${cat.color}80` : undefined,
                            boxShadow: activeFilter === cat.key ? `0 0 30px -5px ${cat.color}60` : undefined,
                            borderWidth: activeFilter === cat.key ? '1px' : '0px'
                        }}
                    >
                        {cat.label}
                        <span className={`ml-2 text-[10px] px-2 py-0.5 rounded-full font-mono transition-colors ${activeFilter === cat.key ? 'bg-black/40 text-white' : 'bg-white/5 text-slate-500'}`}>
                            {cat.count}
                        </span>
                    </button>
                ))}
            </div>

            {/* Collapsible Accordion Grid System */}
            <div className="relative z-10 flex flex-col gap-6">
                {categories.filter(c => c.key !== 'all').map(cat => {
                    const catTools = tools.filter(t => t.cat === cat.key);
                    const isExpanded = expandedSections.includes(cat.key);
                    const isMuted = activeFilter !== 'all' && activeFilter !== cat.key;

                    return (
                        <div
                            key={cat.key}
                            className={`border border-white/5 bg-[#0d1218]/40 rounded-2xl overflow-hidden transition-all duration-500 backdrop-blur-md ${isMuted ? 'opacity-30 grayscale saturate-0' : 'opacity-100 shadow-2xl'}`}
                            style={{ borderColor: isExpanded ? `${cat.color}40` : 'rgba(255,255,255,0.05)' }}
                        >
                            {/* Accordion Header */}
                            <button
                                type="button"
                                onClick={() => toggleSection(cat.key)}
                                className={`w-full flex items-center justify-between p-6 transition-all duration-300 ${isExpanded ? 'bg-white/5' : 'hover:bg-white/5'}`}
                            >
                                <div className="flex items-center gap-4">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color, boxShadow: `0 0 15px ${cat.color}` }} />
                                    <h3 className="text-xl font-bold text-white tracking-wide">{cat.label} Subsystem</h3>
                                    <span className="text-xs font-mono text-slate-400 bg-black/40 px-2 py-1 rounded border border-white/5">{cat.count} Nodes</span>
                                </div>
                                <div className={`transform transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                                    <svg width="14" height="8" viewBox="0 0 14 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M1 1L7 7L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-500" />
                                    </svg>
                                </div>
                            </button>

                            {/* Accordion Body */}
                            <AnimatePresence initial={false}>
                                {isExpanded && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                                    >
                                        <div className="p-6 pt-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 xl:grid-cols-4">
                                            {catTools.map(tool => (
                                                <ToolCard
                                                    key={tool.name}
                                                    tool={tool}
                                                />
                                            ))}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const Icons = {
  Postgres: (props) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12.44 9.17H14v2.73s0 .58-.45.58h-1.11v2.54s-.04.6-.66.6h-2.14v-1.15H7.55s-.55 0-.55-.65V12.5s0-.53.5-.53h2.15v-1.16H8.5V9.17h3.94zm-2.07 10.15c0 .35.28.63.63.63h1.86c.35 0 .63-.28.63-.63v-2.14h-3.12v2.14zm4.27-5.59h2.36c.42 0 .76-.34.76-.76v-1.74c0-.42-.34-.76-.76-.76h-2.36zm-4.27-4.57V6.43h-2v2.73zM5.56 12.5h-2c-.42 0-.76.34-.76.76v1.74c0 .42.34.76.76.76h2zm12.39 3.03l1.82 2.1c.21.24.23.6.05.86l-1.37 1.94c-.16.22-.44.31-.7.22l-2.67-.93c.18-.32.28-.69.28-1.09 0-1.11-.8-2.03-1.86-2.22v-.97c1.64.21 2.91 1.6 2.91 3.28 0 .45-.1.87-.27 1.25l1.6.561 1-1.421-1.37-1.571zm-9.3-5.26L6.82 8.16l-1.11.83.69 1.14zm4.85-6.02L11.75 2.1c-.26-.14-.57-.14-.83 0L8.76 3.39l1 1.73 1.55-.89 1.55.89 1-1.73zM7.55 4.34L6 6.13l1.1.84 1.12-1.29zm8.9 1.79l1.11.84 1.54-1.79-1.55-1.19z" /></svg>,
  Memgraph: (props) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12 21.033A9.033 9.033 0 1 1 21.033 12 9.043 9.043 0 0 1 12 21.033zm0-16.711a7.678 7.678 0 1 0 7.678 7.678A7.687 7.687 0 0 0 12 4.322zm1.536 9.61a2.169 2.169 0 1 1 2.169 2.169 2.172 2.172 0 0 1-2.169-2.169zm-5.071 0a2.169 2.169 0 1 1 2.169 2.169 2.172 2.172 0 0 1-2.169-2.169zM12 9.423a2.169 2.169 0 1 1 2.169 2.169A2.171 2.171 0 0 1 12 9.423z" /></svg>,
  Prisma: (props) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12 2.937l-9.088 17.65L12 22.03l9.088-1.444L12 2.937zm-.26 2.21l6.101 14.155-5.841-3.69V5.147z" /></svg>,
  Redpanda: (props) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M4.646 6.848C2.107 8.356.402 11.23.402 14.498c0 4.156 3.1 7.632 7.15 8.16l2.16-9.82zm14.694.02C21.892 8.368 23.6 11.258 23.6 14.535c0 4.145-3.084 7.614-7.11 8.156L14.332 12.86zm-7.393-.306c-1.353.013-2.637.368-3.774.981-.137.07-.272.16-.406.25l-.264.183LS11.3 23.951h1.362l3.815-15.962c-.172-.112-.346-.22-.524-.316-1.127-.601-2.395-.945-3.729-.955-.091 0-.181 0-.27 0zM12 0c-3.14-.002-6.19 1.137-8.583 3.197h17.14C18.17 1.144 15.127.009 12 0z" /></svg>,
  NodeJs: (props) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12 1.78a2.59 2.59 0 00-1.22.33L3.13 6.47a2.53 2.53 0 00-1.29 2.26v8.54A2.54 2.54 0 003.11 19.5l7.66 4.39a2.57 2.57 0 002.48.01l7.64-4.38a2.55 2.55 0 001.29-2.25V8.73a2.56 2.56 0 00-1.27-2.25l-7.66-4.37A2.58 2.58 0 0012 1.78zM14.93 7.82l-3.23 1.86v3.74l3.24-1.87zM8.88 7.85l3.23 1.84v3.74L8.88 11.6zm6.82 4.02v2.53l-3.26 1.89V13.8zm0-5.11v2.5l-3.26 1.88-3.26-1.88V6.76z" /></svg>,
  Docker: (props) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M13.983 11.078h2.119a.186.186 0 0 0 .186-.185V9.006a.186.186 0 0 0-.186-.186h-2.119a.185.185 0 0 0-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 0 0 .186-.186V3.574a.186.186 0 0 0-.186-.185h-2.118a.185.185 0 0 0-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 0 0 .186-.186V6.29a.186.186 0 0 0-.186-.185h-2.118a.185.185 0 0 0-.185.185v1.887c0 .102.082.185.185.185m-2.93 0h2.12a.186.186 0 0 0 .184-.186V6.29a.185.185 0 0 0-.185-.185h-2.119a.185.185 0 0 0-.185.185v1.887c0 .102.083.185.185.185m2.93 2.715h2.118a.187.187 0 0 0 .186-.185V9.006a.186.186 0 0 0-.186-.186h-2.118a.185.185 0 0 0-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.187.187 0 0 0 .184-.185V9.006a.186.186 0 0 0-.185-.186h-2.119a.185.185 0 0 0-.185.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.186.186 0 0 0 .185-.185V9.006a.185.185 0 0 0-.185-.186h-2.119a.186.186 0 0 0-.186.185v1.888c0 .102.084.185.186.185m-2.928 0h2.119a.185.185 0 0 0 .185-.185V9.006a.185.185 0 0 0-.185-.186H2.207a.185.185 0 0 0-.186.185v1.888c0 .102.082.185.186.185m16.14-5.222a4.93 4.93 0 0 0-.74-1.282c-.244-.306-.516-.296-.7.01a11.166 11.166 0 0 1-2.023 2.378c-1.32.962-2.825 1.543-4.417 1.706V11.23h12.181c.219-.893.424-2.822-.164-4.22-.321-.715-.99-1.246-1.76-1.396a5.553 5.553 0 0 0-2.377.242zm-12.722 8.52c-.412 0-.746.334-.746.746 0 .411.334.745.746.745s.746-.334.746-.745a.748.748 0 0 0-.746-.746" /></svg>,
  Zod: (props) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12 2L2 7l10 5 10-5-10-5zm0 6l-8-4 8-4 8 4-8 4zm0 2L2 9v6l10 5 10-5V9l-10 6z" /></svg>,
  Discord: (props) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" /></svg>,
  Pollinations: (props) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12 2L2 7v10l10 5 10-5V7L12 2zm0 8.5c1.38 0 2.5 1.12 2.5 2.5s-1.12 2.5-2.5 2.5-2.5-1.12-2.5-2.5 1.12-2.5 2.5-2.5z" /></svg>,
  SearXNG: (props) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>,
  Crawl4AI: (props) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1v2h-1v2h-2v-2h-1v-2h1c0-2.76-2.24-5-5-5h-4v2h2v4H9v-4h2V9H6c-2.76 0-5 2.24-5 5h1v2H1v2h-1v-2h2v-2h1a7 7 0 0 1 7-7h1V5.73A2.001 2.001 0 0 1 12 2z" /></svg>,
  HuggingFace: (props) => <svg viewBox="0 0 28 28" fill="currentColor" {...props}><path d="M26.241 12.012c0 6.64-5.385 12.023-12.029 12.023s-12.026-5.383-12.026-12.023C2.186 5.37 7.57 0 14.212 0s12.029 5.37 12.029 12.012zM8.598 12.983A1.914 1.914 0 106.68 11.07a1.914 1.914 0 001.918 1.913zm11.231-1.913a1.919 1.919 0 00-1.921 1.914 1.918 1.918 0 101.921-1.914zm3.87 5.176l.169-.475a4.093 4.093 0 00-6.495-4.212 1.83 1.83 0 00-.77.893 1.623 1.623 0 00-.022 1.139h-4.735a1.642 1.642 0 00-.024-1.127 1.848 1.848 0 00-.773-.895 4.093 4.093 0 00-6.48 4.226l.165.465a11.139 11.139 0 1018.965-.014z" /></svg>,
  Tika: (props) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M1 9.5l3.24-3.23 2-2C7.38 3.12 8.88 2.5 10.5 2.5h11l-3 3h-5l-4.59 4.59A3 3 0 0 0 8 12v3l-5 5-2-2v-8.5zm19.5 9A4.5 4.5 0 0 1 16 23c-1.24 0-2.36-.5-3.18-1.32L9 17.86l2.12-2.12 3.82 3.82 2.12-2.12 1.44 1.44A2.5 2.5 0 0 0 21 16.5V11l2-2v9.5z" /></svg>
};

const techLayers = {
  storage: {
    title: 'Storage & Events',
    color: '#7AA2F7',
    side: 'left',
    nodes: [
      { name: 'PostgreSQL', role: 'Primary data store — 17 tables, pgvector', color: '#7AA2F7', icon: Icons.Postgres },
      { name: 'Memgraph', role: 'Real-time graph DB for social relations', color: '#BB9AF7', icon: Icons.Memgraph },
      { name: 'Prisma', role: 'Type-safe ORM with auto-migrations', color: '#7AA2F7', icon: Icons.Prisma },
      { name: 'Redpanda', role: 'Kafka-compliant event streaming queue', color: '#FF9E64', icon: Icons.Redpanda }
    ]
  },
  engine: {
    title: 'Engine Context',
    color: '#BB9AF7',
    side: 'left',
    nodes: [
      { name: 'Node.js', role: 'Single-agent runtime with TypeScript (v5.9)', color: '#78b846', icon: Icons.NodeJs },
      { name: 'discord.js', role: 'Discord gateway & voice bindings', color: '#BB9AF7', icon: Icons.Discord },
      { name: 'Docker', role: 'Container orchestration & networking', color: '#7AA2F7', icon: Icons.Docker },
      { name: 'Zod', role: 'Strict schema validation for 26 tools', color: '#BB9AF7', icon: Icons.Zod }
    ]
  },
  intelligence: {
    title: 'Intelligence Layer',
    color: '#78b846',
    side: 'right',
    nodes: [
      { name: 'Pollinations.ai', role: 'Unified AI gateway (text/vision/audio)', color: '#78b846', icon: Icons.Pollinations },
      { name: 'SearXNG', role: 'Privacy-first self-hosted meta-search engine', color: '#78b846', icon: Icons.SearXNG },
      { name: 'Crawl4AI', role: 'AI-powered web scraper for deep RAG', color: '#78b846', icon: Icons.Crawl4AI },
      { name: 'HuggingFace', role: 'Local feature extraction & embeddings', color: '#E0AF68', icon: Icons.HuggingFace },
      { name: 'Apache Tika', role: 'Universal document & file text extraction', color: '#E0AF68', icon: Icons.Tika }
    ]
  }
};

function LayerGroup({ layer, activeNode, onHover }) {
  // Use a stable random delay for the connecting line animation to stagger them
  const [delay] = useState(() => Math.random() * 2);

  return (
    <div className="relative bg-[#141a23]/40 border border-[#2d4530]/50 rounded-2xl p-4 backdrop-blur-md shadow-lg group">
      {/* Connecting Line to Center (Desktop Only) */}
      <div className={`hidden lg:block absolute top-[50%] -translate-y-1/2 w-12 xl:w-24 h-[1px] bg-white/5 ${layer.side === 'left' ? '-right-12 xl:-right-24' : '-left-12 xl:-left-24'} overflow-hidden -z-10`}>
        <motion.div
          className="w-full h-full"
          initial={{ x: layer.side === 'left' ? '-100%' : '100%' }}
          animate={{ x: layer.side === 'left' ? '100%' : '-100%' }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "linear", delay }}
          style={{ background: `linear-gradient(to ${layer.side === 'left' ? 'right' : 'left'}, transparent, ${layer.color}, transparent)` }}
        />
      </div>

      <div className="text-xs font-mono tracking-wider mb-4 px-2 flex items-center gap-2" style={{ color: layer.color }}>
        <span className="w-1.5 h-1.5 rounded-full shadow-[0_0_8px_currentColor]" style={{ backgroundColor: layer.color }} />
        {layer.title}
      </div>
      <div className="flex flex-col gap-1.5">
        {layer.nodes.map(node => {
          const isActive = activeNode?.name === node.name;
          const Icon = node.icon;
          return (
            <div
              key={node.name}
              onMouseEnter={() => onHover(node)}
              onMouseLeave={() => onHover(null)}
              className={`relative p-3 rounded-xl border transition-all duration-300 cursor-default overflow-hidden ${isActive ? 'bg-white/10 border-white/20' : 'bg-transparent border-transparent hover:bg-white/5'}`}
            >
              <div className="flex items-center gap-3 relative z-10">
                <div className={`flex items-center justify-center w-8 h-8 rounded-lg shadow-lg border border-white/5 transition-all duration-300`}
                  style={{
                    backgroundColor: isActive ? node.color : `${node.color}15`,
                    color: isActive ? '#0d1218' : node.color,
                    boxShadow: isActive ? `0 0 15px ${node.color}50` : 'none'
                  }}>
                  {Icon && <Icon className="w-4 h-4" />}
                </div>
                <div>
                  <div className={`text-sm font-bold transition-colors ${isActive ? 'text-white' : 'text-slate-300'}`}>{node.name}</div>
                  <div className={`text-[11px] mt-0.5 leading-tight transition-colors ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>{node.role}</div>
                </div>
              </div>

              {/* Background glass shine on active */}
              <AnimatePresence>
                {isActive && (
                  <motion.div
                    layoutId={`glass-${layer.title}`}
                    className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent pointer-events-none"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  />
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function TechStackGrid() {
  const [activeNode, setActiveNode] = useState(null);

  return (
    <section className="relative max-w-7xl mx-auto px-6 py-24 overflow-hidden" id="tech-stack">
      {/* Background radial subtle glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[#7AA2F7]/5 blur-[120px] rounded-full pointer-events-none -z-10" />

      <motion.div
        className="text-center mb-16 relative z-20"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-100px' }}
        transition={{ duration: 0.6 }}
      >
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141a23] border border-[#2d4530] text-[#a9df7c] text-xs font-mono mb-6">
          <span className="w-2 h-2 rounded-full bg-[#78b846] animate-pulse" />
          Neural Core Architecture
        </div>
        <h2 className="text-4xl lg:text-5xl font-extrabold text-white mb-4">
          Bleeding-Edge{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#78b846] to-[#a9df7c]">
            Tech Stack
          </span>
        </h2>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto font-light">
          13 core technologies. Zero compromises. Every layer is connected and purpose-built for autonomous AI orchestration.
        </p>
      </motion.div>

      <div className="relative mt-20 max-w-6xl mx-auto flex flex-col lg:flex-row items-stretch justify-center gap-12 xl:gap-24">

        {/* Left Side */}
        <div className="flex flex-col gap-6 w-full lg:w-80 relative z-10">
          <LayerGroup layer={techLayers.engine} activeNode={activeNode} onHover={setActiveNode} />
          <LayerGroup layer={techLayers.storage} activeNode={activeNode} onHover={setActiveNode} />
        </div>

        {/* Center Core */}
        <div className="flex-shrink-0 flex items-center justify-center relative z-20 my-10 lg:my-0">
          <motion.div
            className="w-56 h-56 rounded-full bg-[#0d1218] border flex items-center justify-center relative transition-colors duration-500"
            animate={{
              borderColor: activeNode ? activeNode.color : '#2d4530',
              boxShadow: activeNode ? `0 0 80px ${activeNode.color}40` : '0 0 50px rgba(120,184,70,0.1)'
            }}
          >
            {/* Orbital SVG paths */}
            <svg className="absolute inset-0 w-full h-full animate-[spin_40s_linear_infinite]" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" strokeDasharray="4 2" />
            </svg>
            <svg className="absolute inset-3 w-[calc(100%-24px)] h-[calc(100%-24px)] animate-[spin_25s_linear_infinite_reverse]" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(169, 223, 124, 0.2)" strokeWidth="1" strokeDasharray="10 5" />
            </svg>
            <svg className="absolute inset-8 w-[calc(100%-64px)] h-[calc(100%-64px)] animate-[spin_15s_linear_infinite]" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" strokeDasharray="2 6" />
            </svg>

            <div className="text-center relative z-10 flex flex-col items-center">
              <div className="w-14 h-14 mb-3 rounded-2xl bg-gradient-to-br from-[#78b846] to-[#2d4530] flex items-center justify-center border border-[#a9df7c]/30 shadow-lg relative overflow-hidden">
                <div className="absolute inset-0 bg-white/20 animate-pulse mix-blend-overlay" />
                <span className="text-white text-3xl font-bold">S</span>
              </div>
              <span className="font-bold text-white tracking-widest text-2xl block">SAGE</span>
              <span className="text-[10px] text-[#a9df7c] font-mono tracking-[0.3em] mt-1 block">RUNTIME</span>
            </div>

            {/* Central data particles/glow injected by hover */}
            <AnimatePresence>
              {activeNode && (
                <motion.div
                  className="absolute inset-0 rounded-full"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.1 }}
                  transition={{ duration: 0.3 }}
                  style={{ background: `radial-gradient(circle, ${activeNode.color}30 0%, transparent 60%)` }}
                />
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* Right Side */}
        <div className="flex flex-col gap-6 w-full lg:w-80 relative z-10">
          <LayerGroup layer={techLayers.intelligence} activeNode={activeNode} onHover={setActiveNode} />
        </div>

      </div>
    </section>
  )
}

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const CdnIcon = ({ src, alt, ...props }) => (
  <img src={src} alt={alt} loading="lazy" {...props} style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'brightness(0) invert(1)', ...props.style }} />
);

const Icons = {
  Postgres: (props) => <CdnIcon src="https://cdn.simpleicons.org/postgresql/white" alt="PostgreSQL" {...props} style={{ filter: 'none' }} />,
  Memgraph: (props) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12 21.033A9.033 9.033 0 1 1 21.033 12 9.043 9.043 0 0 1 12 21.033zm0-16.711a7.678 7.678 0 1 0 7.678 7.678A7.687 7.687 0 0 0 12 4.322zm1.536 9.61a2.169 2.169 0 1 1 2.169 2.169 2.172 2.172 0 0 1-2.169-2.169zm-5.071 0a2.169 2.169 0 1 1 2.169 2.169 2.172 2.172 0 0 1-2.169-2.169zM12 9.423a2.169 2.169 0 1 1 2.169 2.169A2.171 2.171 0 0 1 12 9.423z" /></svg>,
  Prisma: (props) => <CdnIcon src="https://cdn.simpleicons.org/prisma/white" alt="Prisma" {...props} style={{ filter: 'none' }} />,
  Redpanda: (props) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" /></svg>,
  NodeJs: (props) => <CdnIcon src="https://cdn.simpleicons.org/nodedotjs/white" alt="Node.js" {...props} style={{ filter: 'none' }} />,
  Docker: (props) => <CdnIcon src="https://cdn.simpleicons.org/docker/white" alt="Docker" {...props} style={{ filter: 'none' }} />,
  Zod: (props) => <CdnIcon src="https://cdn.simpleicons.org/zod/white" alt="Zod" {...props} style={{ filter: 'none' }} />,
  Discord: (props) => <CdnIcon src="https://cdn.simpleicons.org/discord/white" alt="discord.js" {...props} style={{ filter: 'none' }} />,
  Pollinations: (props) => <CdnIcon src="https://pollinations.ai/favicon.ico" alt="Pollinations.ai" {...props} />,
  SearXNG: (props) => <CdnIcon src="https://cdn.simpleicons.org/searxng/white" alt="SearXNG" {...props} style={{ filter: 'none' }} />,
  Crawl4AI: (props) => <svg viewBox="0 0 24 24" fill="currentColor" {...props}><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1v2h-1v2h-2v-2h-1v-2h1c0-2.76-2.24-5-5-5h-4v2h2v4H9v-4h2V9H6c-2.76 0-5 2.24-5 5h1v2H1v2h-1v-2h2v-2h1a7 7 0 0 1 7-7h1V5.73A2.001 2.001 0 0 1 12 2z" /></svg>,
  HuggingFace: (props) => <CdnIcon src="https://cdn.simpleicons.org/huggingface/white" alt="HuggingFace" {...props} style={{ filter: 'none' }} />,
  Tika: (props) => <CdnIcon src="https://cdn.simpleicons.org/apache/white" alt="Apache Tika" {...props} style={{ filter: 'none' }} />
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
      { name: 'Zod', role: 'Strict schema validation for tool inputs', color: '#BB9AF7', icon: Icons.Zod }
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
          13 core technologies. Zero compromises. Every layer is connected and purpose-built for agentic AI orchestration.
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

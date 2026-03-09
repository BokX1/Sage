import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const steps = [
    {
        num: '01',
        title: 'Invite Sage',
        desc: 'Add the hosted Sage bot to your Discord server — zero infrastructure, one click.',
        command: 'https://discord.com/oauth2/authorize?client_id=1462117382398017667&scope=bot&permissions=8',
        commandDisplay: 'discord.com/oauth2/authorize',
        color: '#7AA2F7',
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
        ),
    },
    {
        num: '02',
        title: 'Activate Your Server',
        desc: 'For the hosted bot, trigger Sage once and use the setup card modal to activate your whole server.',
        command: '@Sage hello',
        commandDisplay: '@Sage hello',
        color: '#78b846',
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
        ),
    },
    {
        num: '03',
        title: 'Start Talking',
        desc: 'Mention @Sage in any channel. It remembers context, calls tools when helpful, and works with the hosted flow or your own OpenAI-compatible setup.',
        command: '@Sage what happened?',
        commandDisplay: '@Sage what happened?',
        color: '#BB9AF7',
        icon: (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        ),
    },
];

function fallbackCopyText(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const didCopy = document.execCommand('copy');
    document.body.removeChild(textarea);
    return didCopy;
}

function CopyButton({ text, color }) {
    const [copied, setCopied] = useState(false);
    const resetTimerRef = useRef(null);

    const markCopied = () => {
        setCopied(true);
        if (resetTimerRef.current) {
            clearTimeout(resetTimerRef.current);
        }
        resetTimerRef.current = setTimeout(() => {
            setCopied(false);
            resetTimerRef.current = null;
        }, 2000);
    };

    useEffect(() => {
        return () => {
            if (resetTimerRef.current) {
                clearTimeout(resetTimerRef.current);
            }
        };
    }, []);

    const handleCopy = async (e) => {
        e.stopPropagation();
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                if (!fallbackCopyText(text)) {
                    return;
                }
            }
            markCopied();
        } catch {
            if (fallbackCopyText(text)) {
                markCopied();
            }
        }
    };
    return (
        <button
            type="button"
            onClick={handleCopy}
            aria-label={`Copy text: ${text}`}
            className="text-[10px] font-mono px-2 py-0.5 rounded-md transition-all cursor-pointer z-10"
            style={{
                backgroundColor: copied ? color + '30' : 'rgba(255,255,255,0.05)',
                color: copied ? color : 'rgba(255,255,255,0.3)',
                border: `1px solid ${copied ? color + '40' : 'rgba(255,255,255,0.08)'}`,
            }}
        >
            {copied ? '✓ Copied' : 'Copy'}
        </button>
    );
}

// Sub-components for the Mock Discord UI
const UserAvatar = ({ isBot, color = '#5865F2' }) => (
    <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden" style={{ backgroundColor: color }}>
        {isBot ? (
            <span className="text-white font-bold text-lg">S</span>
        ) : (
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="currentColor">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
            </svg>
        )}
    </div>
);

const DiscordMessage = ({ avatarColor, isBot, author, time, content, isCommand, typing }) => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`flex gap-4 p-1 hover:bg-[#32353B] rounded-md transition-colors ${isCommand ? 'mt-2' : ''}`}
    >
        <UserAvatar isBot={isBot} color={avatarColor} />
        <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-1">
                <span className="text-slate-200 font-medium text-sm data-[bot=true]:text-[#5865F2]" data-bot={isBot}>
                    {author}
                </span>
                {isBot && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-[#5865F2] text-white flex items-center gap-1 leading-none">
                        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
                        Bot
                    </span>
                )}
                <span className="text-slate-500 text-xs">{time}</span>
            </div>

            {isCommand ? (
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-slate-400 font-mono">Used</span>
                    <span className="text-sm text-[#00A8FC] font-mono bg-[#00A8FC]/10 px-1 rounded cursor-pointer hover:bg-[#00A8FC]/20">
                        {content}
                    </span>
                </div>
            ) : typing ? (
                <div className="flex items-center gap-1 text-slate-400 h-5">
                    <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.4, delay: 0 }} className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
                    <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.4, delay: 0.2 }} className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
                    <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.4, delay: 0.4 }} className="w-1.5 h-1.5 bg-slate-400 rounded-full" />
                </div>
            ) : (
                <div className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
                    {content}
                </div>
            )}
        </div>
    </motion.div>
);


function DiscordMockup({ activeStep }) {
    return (
        <div className="w-full h-[400px] bg-[#36393F] rounded-2xl border border-slate-700/50 shadow-2xl overflow-hidden flex flex-col relative">
            {/* Title Bar */}
            <div className="h-10 bg-[#202225] flex items-center px-4 gap-2 flex-shrink-0">
                <div className="w-3 h-3 rounded-full bg-[#ED4245]" />
                <div className="w-3 h-3 rounded-full bg-[#FEE75C]" />
                <div className="w-3 h-3 rounded-full bg-[#57F287]" />
                <div className="ml-4 flex items-center font-bold text-slate-400 text-sm">
                    <span className="text-slate-500 mr-1">#</span> general
                </div>
            </div>

            {/* Main Chat Area */}
            <div className="flex-1 p-4 overflow-hidden flex flex-col justify-end gap-3 pb-20 relative">
                <AnimatePresence mode="wait">
                    {activeStep === 0 && (
                        <motion.div key="step1" className="flex flex-col gap-4 absolute bottom-20 left-4 right-4">
                            <DiscordMessage
                                isBot={true}
                                avatarColor="#78b846"
                                author="Sage"
                                time="Today at 12:00 PM"
                                content="Hello there! 👋 I am Sage, an agentic AI community engineer. I've successfully connected to your server architecture."
                            />
                            <DiscordMessage
                                isBot={true}
                                avatarColor="#78b846"
                                author="Sage"
                                time="Today at 12:00 PM"
                                content={<div className="bg-[#2B2D31] p-3 rounded border border-slate-700/50 mt-1"><span className="text-[#a9df7c] text-xs font-mono uppercase font-bold tracking-wider block mb-1">Status: Online</span><div className="text-slate-300">Talk to Sage once to open the setup card, or self-host Sage against any OpenAI-compatible provider.</div></div>}
                            />
                        </motion.div>
                    )}

                    {activeStep === 1 && (
                        <motion.div key="step2" className="flex flex-col gap-4 absolute bottom-20 left-4 right-4">
                            <DiscordMessage
                                isBot={false}
                                avatarColor="#5865F2"
                                author="Admin"
                                time="Today at 12:05 PM"
                                content={<>@<span className="text-[#5865F2] bg-[#5865F2]/10 px-0.5 rounded">Sage</span> hello</>}
                            />
                            <DiscordMessage
                                isBot={true}
                                avatarColor="#78b846"
                                author="Sage"
                                time="Today at 12:05 PM"
                                content="✅ Server key validated. Hosted runtime activated for this guild. I am now ready for normal chat, tools, and voice control."
                            />
                        </motion.div>
                    )}

                    {activeStep === 2 && (
                        <motion.div key="step3" className="flex flex-col gap-4 absolute bottom-20 left-4 right-4">
                            <DiscordMessage
                                isBot={false}
                                avatarColor="#5865F2"
                                author="Admin"
                                time="Today at 12:10 PM"
                                content={<>Hey <span className="text-[#5865F2] bg-[#5865F2]/10 px-0.5 rounded">@Sage</span>, can you explain what happened in #dev-updates yesterday?</>}
                            />

                            <div className="relative">
                                {/* Agentic thinking state overlay */}
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    className="pl-14 mb-2 overflow-hidden"
                                >
                                    <div className="text-xs font-mono text-slate-500 border-l-2 border-[#5865F2]/50 pl-2 py-0.5">
                                        <span className="text-[#B49CEC]">thought:</span> searching memory pipeline...
                                    </div>
                                </motion.div>

                                <DiscordMessage
                                    isBot={true}
                                    avatarColor="#78b846"
                                    author="Sage"
                                    time="Today at 12:10 PM"
                                    content="Yesterday in #dev-updates, Alice merged the new payment gateway API, and Bob deployed the staging environment which caused a brief 5-minute blip in the test DB."
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Message Input Mock */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-[#36393F]">
                <div className="bg-[#383A40] h-11 rounded-lg flex items-center px-4 cursor-text hover:bg-[#404249] transition-colors shadow-inner border border-white/5">
                    <div className="w-6 h-6 rounded-full bg-slate-500/80 flex items-center justify-center mr-3 hidden sm:flex">
                        <svg viewBox="0 0 24 24" className="w-4 h-4 text-white transition-transform hover:scale-110" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                    </div>
                    <span className="text-slate-500 text-sm flex items-center">
                        Message #general
                        {activeStep === 0 && (
                            <motion.div
                                animate={{ opacity: [1, 0, 1] }}
                                transition={{ repeat: Infinity, duration: 1 }}
                                className="w-0.5 h-4 ml-0.5 bg-white/70 rounded-full"
                            />
                        )}
                    </span>
                </div>
            </div>
        </div>
    );
}

export default function QuickStart() {
    const [activeStep, setActiveStep] = useState(0);
    const activeColor = steps[activeStep].color;

    return (
        <section id="quickstart" className="relative max-w-7xl mx-auto px-6 py-28 overflow-hidden">
            {/* Background decoration */}
            <div className="absolute top-1/2 right-0 w-[500px] h-[500px] bg-[#BB9AF7]/5 blur-[100px] rounded-full pointer-events-none -z-10" />

            {/* Header */}
            <motion.div
                className="text-left mb-16 lg:text-center"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
            >
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141a23] border border-[#2d4530] text-[#a9df7c] text-xs font-mono mb-6">
                    <span className="w-2 h-2 rounded-full bg-[#78b846] animate-pulse" />
                    60-Second Onboarding
                </div>
                <h2 className="text-4xl lg:text-5xl font-extrabold text-white mb-4">
                    Live in{' '}
                    <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#78b846] to-[#9cd65a]">
                        Three Steps
                    </span>
                </h2>
                <p className="text-lg text-slate-400 max-w-xl lg:mx-auto font-light">
                    From zero to a fully agentic community engineer with a chat-first setup flow.
                </p>
            </motion.div>

            {/* Main Split Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-8 lg:items-center">

                {/* Left Side: Interactive Steps */}
                <div className="flex flex-col gap-4 relative z-10">
                    {/* Vertical connecting line */}
                    <div className="absolute left-[27px] top-8 bottom-8 w-px bg-white/5 -z-10" />

                    {steps.map((step, i) => {
                        const isActive = activeStep === i;
                        return (
                            <motion.div
                                key={step.num}
                                className={`relative p-5 rounded-2xl border transition-all duration-300 cursor-pointer overflow-hidden ${isActive ? 'bg-[#141a23]/60 border-white/20 shadow-xl' : 'bg-transparent border-transparent hover:bg-white/5'}`}
                                onMouseEnter={() => setActiveStep(i)}
                                onClick={() => setActiveStep(i)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        setActiveStep(i);
                                    }
                                }}
                                role="button"
                                tabIndex={0}
                                aria-pressed={isActive}
                                aria-label={`Select step ${step.num}: ${step.title}`}
                                initial={{ opacity: 0, x: -30 }}
                                whileInView={{ opacity: 1, x: 0 }}
                                viewport={{ once: true }}
                                transition={{ duration: 0.5, delay: i * 0.1 }}
                            >
                                <div className="flex gap-4 relative z-10">
                                    {/* Icon Circle */}
                                    <div
                                        className={`w-[54px] h-[54px] rounded-2xl flex-shrink-0 flex items-center justify-center transition-all duration-300 border backdrop-blur-sm`}
                                        style={{
                                            backgroundColor: isActive ? `${step.color}20` : '#0a0e16',
                                            borderColor: isActive ? `${step.color}50` : 'rgba(255,255,255,0.05)',
                                            color: isActive ? step.color : '#64748b',
                                            boxShadow: isActive ? `0 0 20px ${step.color}30` : 'none'
                                        }}
                                    >
                                        <div className="w-6 h-6">
                                            {step.icon}
                                        </div>
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 pt-1">
                                        <div className="flex items-baseline justify-between mb-1.5">
                                            <h3 className={`text-lg font-bold transition-colors ${isActive ? 'text-white' : 'text-slate-300'}`}>
                                                {step.title}
                                            </h3>
                                            <span className="text-xs font-mono font-bold tracking-wider" style={{ color: isActive ? step.color : '#475569' }}>
                                                STEP {step.num}
                                            </span>
                                        </div>
                                        <p className={`text-sm leading-relaxed mb-4 transition-colors ${isActive ? 'text-slate-400' : 'text-slate-500'}`}>
                                            {step.desc}
                                        </p>

                                        {/* Interactive Code Block inside content */}
                                        <AnimatePresence>
                                            {isActive && (
                                                <motion.div
                                                    initial={{ opacity: 0, height: 0, y: -10 }}
                                                    animate={{ opacity: 1, height: 'auto', y: 0 }}
                                                    exit={{ opacity: 0, height: 0, y: -10 }}
                                                    className="bg-[#0a0e16] border border-white/10 rounded-xl px-4 py-3 font-mono text-xs overflow-hidden group shadow-inner"
                                                >
                                                    <div className="flex justify-between items-center">
                                                        <div className="text-slate-400 flex items-center gap-2 overflow-hidden truncate whitespace-nowrap">
                                                            <span style={{ color: step.color }}>$</span>
                                                            <span className="truncate">{step.commandDisplay}</span>
                                                        </div>
                                                        <CopyButton text={step.command} color={step.color} />
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </div>

                                {/* Active glass highlight overlay */}
                                <AnimatePresence>
                                    {isActive && (
                                        <motion.div
                                            layoutId="step-highlight"
                                            className="absolute inset-0 bg-gradient-to-r from-white/5 to-transparent pointer-events-none"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                        />
                                    )}
                                </AnimatePresence>
                            </motion.div>
                        )
                    })}
                </div>

                {/* Right Side: Mock Discord UI */}
                <div className="relative group">
                    {/* Decorative dynamic ambient glow */}
                    <motion.div
                        className="absolute -inset-2 rounded-[24px] opacity-20 blur-2xl z-0 transition-colors duration-500"
                        animate={{ backgroundColor: activeColor }}
                    />
                    <motion.div
                        className="absolute -inset-0.5 rounded-[22px] opacity-40 blur-md z-0 transition-colors duration-500"
                        animate={{ backgroundColor: activeColor }}
                    />

                    <div className="relative z-10 transition-transform duration-500 ease-out group-hover:scale-[1.01]">
                        <DiscordMockup activeStep={activeStep} />
                    </div>
                </div>

            </div>
        </section>
    );
}

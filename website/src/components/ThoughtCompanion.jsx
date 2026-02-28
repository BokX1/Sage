import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

const thoughts = [
    { text: "[System] Initializing Cognitive Runtime...", yThreshold: 100 },
    { text: "[GraphRAG] Analyzing user social topology...", yThreshold: 800 },
    { text: "[Memory] Injecting LTM context vectors...", yThreshold: 1600 },
    { text: "[Tool] Executing 'github_repo_lookup'...", yThreshold: 2400 },
    { text: "[Voice] Summarizing live transcription context...", yThreshold: 3200 },
    { text: "[System] Awaiting new user input.", yThreshold: 4000 }
];

const SCROLL_VISIBILITY_THRESHOLD = 300;
const DISMISS_STORAGE_KEY = 'sage.website.inner-monologue.dismissed';

function resolveThoughtIndex(scrollY) {
    for (let index = thoughts.length - 1; index >= 0; index -= 1) {
        if (scrollY >= thoughts[index].yThreshold) {
            return index;
        }
    }
    return 0;
}

const ThoughtCompanion = () => {
    const shouldReduceMotion = useReducedMotion();
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isVisible, setIsVisible] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [dismissedState, setDismissedState] = useState(null);
    const [isPinnedOpen, setIsPinnedOpen] = useState(false);
    const rafIdRef = useRef(null);

    const isDismissed = dismissedState === true;
    const currentThought = useMemo(() => thoughts[currentIndex].text, [currentIndex]);

    useEffect(() => {
        try {
            setDismissedState(window.localStorage.getItem(DISMISS_STORAGE_KEY) === '1');
        } catch {
            setDismissedState(false);
        }
    }, []);

    useEffect(() => {
        if (dismissedState === null) return;
        try {
            if (isDismissed) {
                window.localStorage.setItem(DISMISS_STORAGE_KEY, '1');
            } else {
                window.localStorage.removeItem(DISMISS_STORAGE_KEY);
            }
        } catch {
            // Ignore storage failures (privacy mode, restricted storage, etc.)
        }
    }, [dismissedState, isDismissed]);

    useEffect(() => {
        if (dismissedState === null) return;
        let pageIsVisible = document.visibilityState === 'visible';

        const updateThoughtFromScroll = () => {
            const y = window.scrollY;
            const shouldShow = (y > SCROLL_VISIBILITY_THRESHOLD || isPinnedOpen) && !isDismissed;

            setIsVisible(shouldShow);

            if (!shouldShow || isPaused || !pageIsVisible) {
                rafIdRef.current = null;
                return;
            }

            const nextIndex = resolveThoughtIndex(y);
            setCurrentIndex(prev => (prev === nextIndex ? prev : nextIndex));
            rafIdRef.current = null;
        };

        const scheduleUpdate = () => {
            if (rafIdRef.current !== null) return;
            rafIdRef.current = window.requestAnimationFrame(updateThoughtFromScroll);
        };

        const handleVisibilityChange = () => {
            pageIsVisible = document.visibilityState === 'visible';
            scheduleUpdate();
        };

        updateThoughtFromScroll();
        window.addEventListener('scroll', scheduleUpdate, { passive: true });
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            window.removeEventListener('scroll', scheduleUpdate);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (rafIdRef.current !== null) {
                window.cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
        };
    }, [dismissedState, isDismissed, isPaused, isPinnedOpen]);

    if (dismissedState === null) return null;

    return (
        <AnimatePresence>
            {isDismissed ? (
                <motion.button
                    type="button"
                    initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
                    animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                    exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 10 }}
                    className="fixed bottom-8 left-8 z-[100] px-3 py-2 rounded-xl bg-[#141a23]/90 border border-white/10 text-xs font-mono text-slate-300 hover:text-white hover:border-[#78b846]/40 transition-colors"
                    onClick={() => {
                        setDismissedState(false);
                        setIsPinnedOpen(true);
                    }}
                    aria-label="Show inner monologue panel"
                >
                    Show inner monologue
                </motion.button>
            ) : isVisible && (
                <motion.div
                    initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: -40 }}
                    animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, x: 0 }}
                    exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: -40 }}
                    className="fixed bottom-8 left-8 z-[100] max-w-[280px]"
                >
                    <div className="relative glass-panel px-4 py-3 rounded-2xl border border-white/10 shadow-2xl flex items-start gap-3 backdrop-blur-xl">
                        <div className={`flex-shrink-0 w-3 h-3 rounded-full mt-1 bg-gradient-to-br from-[#78b846] to-[#a9df7c] shadow-[0_0_10px_rgba(120,184,70,0.8)] ${shouldReduceMotion ? '' : 'animate-pulse'}`}></div>

                        <div className="flex-1">
                            <div className="flex items-center justify-between gap-3 mb-1">
                                <span className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">
                                    Inner Monologue
                                </span>
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => setIsPaused(prev => !prev)}
                                        aria-pressed={isPaused}
                                        aria-label={isPaused ? 'Resume inner monologue updates' : 'Pause inner monologue updates'}
                                        className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20 transition-colors"
                                    >
                                        {isPaused ? 'Resume' : 'Pause'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setDismissedState(true);
                                            setIsPinnedOpen(false);
                                        }}
                                        aria-label="Hide inner monologue panel"
                                        className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20 transition-colors"
                                    >
                                        Hide
                                    </button>
                                </div>
                            </div>

                            <div
                                role="status"
                                aria-live={isPaused ? 'off' : 'polite'}
                                aria-atomic="true"
                                aria-label="Inner monologue status updates"
                            >
                                <motion.p
                                    key={currentThought}
                                    initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
                                    animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                                    className="text-xs font-mono text-[#a9df7c] leading-relaxed"
                                >
                                    {currentThought}
                                </motion.p>
                            </div>

                            <div className="mt-2 text-[10px] font-mono text-slate-600">
                                Stage {currentIndex + 1}/{thoughts.length}
                            </div>
                        </div>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default ThoughtCompanion;

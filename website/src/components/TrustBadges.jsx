import { motion } from 'framer-motion';

const badges = [
    { icon: '🔒', label: 'Channel Blocklists', desc: 'Exclude sensitive channels from ingestion' },
    { icon: '✅', label: 'Ingestion Allowlists', desc: 'Limit data capture to approved channels only' },
    { icon: '🏠', label: 'Self-Hosted Data', desc: 'All data stored in your own PostgreSQL instance' },
    { icon: '🚫', label: 'No Voice Recording', desc: 'Sage tracks presence metadata — never audio' },
    { icon: '📊', label: 'Trace Observability', desc: 'Full agent trace logging for audit compliance' },
];

const containerVariants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.1 } }
};

const badgeVariants = {
    hidden: { opacity: 0, rotateY: 90 },
    visible: { opacity: 1, rotateY: 0, transition: { duration: 0.6, ease: [0.4, 0, 0.2, 1] } }
};

export default function TrustBadges() {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <motion.div
                className="lg:col-span-5"
                variants={containerVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true }}
                style={{ display: 'contents' }}
            >
                {badges.map(badge => (
                    <motion.div
                        key={badge.label}
                        variants={badgeVariants}
                        whileHover={{ scale: 1.05, borderColor: 'rgba(120,184,70,0.3)' }}
                        className="bento-cell p-5 text-center cursor-default"
                        style={{ perspective: '600px' }}
                    >
                        <div className="text-3xl mb-3">{badge.icon}</div>
                        <h3 className="font-bold text-white text-sm mb-1">{badge.label}</h3>
                        <p className="text-[10px] text-slate-500 leading-relaxed">{badge.desc}</p>
                    </motion.div>
                ))}
            </motion.div>
        </div>
    );
}

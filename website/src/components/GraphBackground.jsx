import React, { useEffect, useState, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';

const GraphBackground = () => {
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const graphData = useMemo(() => {
        // Generate a random graph
        const N = 40;
        const nodes = [...Array(N).keys()].map(i => ({ id: i, val: Math.random() * 2 + 1 }));
        const links = [...Array(N).keys()]
            .filter(id => id)
            .map(id => ({
                source: id,
                target: Math.round(Math.random() * (id - 1))
            }));
        
        // Add some more random links to make it look like a web
        for (let i = 0; i < N / 2; i++) {
            links.push({
                source: Math.floor(Math.random() * N),
                target: Math.floor(Math.random() * N)
            });
        }

        return { nodes, links };
    }, []);

    useEffect(() => {
        let resizeFrame = null;

        const updateDimensions = () => {
            setDimensions({
                width: window.innerWidth,
                height: window.innerHeight * 0.85 // Approximate Hero height
            });
        };

        const handleResize = () => {
            if (resizeFrame !== null) return;
            resizeFrame = window.requestAnimationFrame(() => {
                updateDimensions();
                resizeFrame = null;
            });
        };

        updateDimensions();
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (resizeFrame !== null) {
                window.cancelAnimationFrame(resizeFrame);
            }
        };
    }, []);

    if (dimensions.width === 0) return null; // Avoid SSR issues

    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
            <ForceGraph2D
                graphData={graphData}
                width={dimensions.width}
                height={dimensions.height}
                nodeColor={() => '#78b846'}
                linkColor={() => 'rgba(255, 255, 255, 0.1)'}
                backgroundColor="transparent"
                nodeRelSize={2}
                linkWidth={1}
                d3AlphaDecay={0.01}
                d3VelocityDecay={0.4}
                cooldownTicks={100}
            />
        </div>
    );
};

export default GraphBackground;

import { useEffect, useRef } from "react";
import { NeatGradient } from "@firecms/neat";
import { NEAT_BASE_CONFIG } from "./neatConfig";

export function NeatHeroBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const neatRef = useRef<NeatGradient | null>(null);

    useEffect(() => {
        if (!canvasRef.current) return;

        const neat = new NeatGradient({
            ref: canvasRef.current,
            ...NEAT_BASE_CONFIG,
        });
        neatRef.current = neat;

        const baseOffset = NEAT_BASE_CONFIG.yOffset;
        const handleScroll = () => {
            neat.yOffset = baseOffset + window.scrollY * 0.3;
        };

        window.addEventListener("scroll", handleScroll, { passive: true });

        return () => {
            window.removeEventListener("scroll", handleScroll);
            neat.destroy();
            neatRef.current = null;
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            id="neat-hero-canvas"
            style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                opacity: 0.55,
                isolation: "isolate",
            }}
            aria-hidden="true"
        />
    );
}

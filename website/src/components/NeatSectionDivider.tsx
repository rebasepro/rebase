import { useEffect, useRef } from "react";
import { NEAT_BASE_CONFIG } from "./neatConfig";

const VARIANTS: Record<string, Partial<NeatConfig>> = {
    a: {
        yOffset: 0,
        textureSeed: 217,
        planeBend: 0.2,
        planeTwist: 0.8,
        cameraX: 25.5,
        cameraY: 10.5,
        cameraRotationX: 0.61,
        cameraRotationY: 0.483,
        cameraZoom: 2.05,
        speed: 0.2,
    },
    b: {
        yOffset: 0,
        textureSeed: 891,
        planeBend: 0.2,
        planeTwist: 0.8,
        cameraX: -29.5,
        cameraY: 1.5,
        cameraRotationX: 0.61,
        cameraRotationY: 0.483,
        cameraZoom: 2.05,
        speed: 0.2,
    },
};

export function NeatSectionDivider({ variant = "a" }: { variant?: "a" | "b" }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!canvasRef.current) return;

        const config = { ...NEAT_BASE_CONFIG, ...(VARIANTS[variant] ?? {}) };

        let neat: any;
        let scrollHandler: (() => void) | null = null;
        import("@firecms/neat").then(({ NeatGradient }) => {
            if (!canvasRef.current) return;
            neat = new NeatGradient({
                ref: canvasRef.current,
                ...config,
            });

            const baseOffset = config.yOffset ?? 0;
            const canvas = canvasRef.current;
            scrollHandler = () => {
                const rect = canvas.getBoundingClientRect();
                const viewportCenter = window.innerHeight / 2;
                const offset = (rect.top - viewportCenter) * 0.3;
                neat.yOffset = baseOffset + offset;
            };
            window.addEventListener("scroll", scrollHandler, { passive: true });
            scrollHandler();
        });

        return () => {
            if (scrollHandler) window.removeEventListener("scroll", scrollHandler);
            if (neat) neat.destroy();
        };
    }, [variant]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                display: "block",
                width: "100%",
                height: "100%",
                opacity: 0.55,
            }}
            aria-hidden="true"
        />
    );
}

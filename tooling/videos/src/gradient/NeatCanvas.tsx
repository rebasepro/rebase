import React, { useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender, useCurrentFrame, useVideoConfig } from "remotion";
import * as neatModule from "@firecms/neat";
import { NEAT_BASE_CONFIG } from "../data/neat-config";
import { DeterministicClock } from "./clock";

/**
 * The landing page's gradient — the actual `@firecms/neat`, running the
 * actual configuration from `NeatBackground.tsx`.
 *
 * An earlier version of this file reimplemented the look as a hand-written
 * shader, on the reasoning that a wall-clock animation cannot be rendered
 * deterministically. That reasoning was wrong twice over: the clock is
 * replaceable (see `clock.ts`), and Neat takes a `seed` for exactly this
 * purpose. What it produced was a lookalike — and a lookalike of your own
 * brand is worse than no gradient at all, because it is wrong in ways only
 * the people who own the brand can see.
 *
 * Nothing here invents anything. The palette, the flow, the texture, the
 * camera and the 12x12 ribbon mesh are all the site's, generated into
 * `src/data/neat-config.ts` by a script so they cannot drift.
 */

interface NeatGradientInstance {
    yOffset: number;
    destroy: () => void;
}

type NeatCtor = new (config: Record<string, unknown>) => NeatGradientInstance;

// The package publishes UMD and ESM, and which shape a bundler hands back
// varies. The site does the same triple-check; if it ever stops being
// necessary, it stops being necessary in both places at once.
const mod = neatModule as unknown as {
    NeatGradient?: NeatCtor;
    default?: { NeatGradient?: NeatCtor; default?: { NeatGradient?: NeatCtor } };
};
const NeatGradient = mod.NeatGradient ?? mod.default?.NeatGradient ?? mod.default?.default?.NeatGradient;

export type NeatFraming = "hero" | "full" | "left" | "right" | "bloom" | "close" | "floor";

/**
 * How each scene is framed.
 *
 * `hero`, `left` and `right` are the site's own variants, copied exactly —
 * `hero` is the empty override the landing page runs, and the other two are
 * its section dividers. The rest move the same camera around the same ribbon
 * to keep type and product windows off the art; they change nothing about what
 * the art IS.
 */
const FRAMING: Record<NeatFraming, Record<string, number>> = {
    /** The landing page hero, unmodified. */
    hero: {},

    /** The site's divider variants, verbatim. */
    left: {
        yOffset: 0, planeBend: 0.2, planeTwist: 0.8,
        cameraX: 25.5, cameraY: 10.5,
        cameraRotationX: 0.61, cameraRotationY: 0.483,
        cameraZoom: 2.05, speed: 0.2,
    },
    right: {
        yOffset: 0, planeBend: 0.2, planeTwist: 0.8,
        cameraX: -29.5, cameraY: 1.5,
        cameraRotationX: 0.61, cameraRotationY: 0.483,
        cameraZoom: 2.05, speed: 0.2,
    },

    /* The three below were swept rather than guessed, and the first guesses
     * were backwards: `cameraY` TRANSLATES THE WORLD, so a more negative value
     * lifts the ribbon out of the top of frame rather than dropping it. The
     * base config sits at -9.5; everything here is well above it, which is what
     * puts the band low and leaves clean black for type. Framing also depends
     * on aspect, so these are only true at 16:9. */

    /** The ribbon rising through the lower half, centred. */
    full: { cameraY: 14, cameraZoom: 2.0, speed: 0.25 },

    /** The cold open: art across the bottom-left, and clean black through the
     *  middle where the mark assembles. */
    bloom: { cameraX: 20, cameraY: 18, cameraZoom: 1.8, speed: 0.14 },

    /** Low and to one corner, so a closing card sits in black above it. */
    close: { cameraY: 22, cameraZoom: 1.8, speed: 0.18 },

    /** Lower and further left again. For a scene whose subject is a window:
     *  the art has to be present without ever being behind the thing being
     *  shown, and the window holds the right two-thirds of that frame. */
    floor: { cameraX: 26, cameraY: 22, cameraZoom: 1.9, speed: 0.16 },
};

/**
 * The properties a scene is allowed to move.
 *
 * All of these are real accessors on the prototype (the library builds them
 * from a table with `Object.defineProperty`), so assigning one mid-render is
 * supported rather than a hack. The first seven only touch uniforms and are
 * free; `planeBend` and `planeTwist` REGENERATE THE MESH, which is affordable
 * only because the mesh is 12x12 — do not assume that if `resolution` changes.
 */
const MOVABLE = [
    "cameraX", "cameraY", "cameraZ",
    "cameraRotationX", "cameraRotationY", "cameraRotationZ",
    "cameraZoom", "planeBend", "planeTwist", "yOffset",
] as const;

type Movable = (typeof MOVABLE)[number];

export type NeatTravel = Partial<Record<Movable, number>>;

/** A framing's value for one property, falling back to the site's base config
 *  — a framing is a sparse override, not a complete camera. */
function valueOf(framing: NeatFraming, key: Movable): number {
    const override = FRAMING[framing][key];
    if (override !== undefined) return override;
    const base = (NEAT_BASE_CONFIG as Record<string, unknown>)[key];
    return typeof base === "number" ? base : 0;
}

interface NeatCanvasProps {
    framing?: NeatFraming;
    /** Master opacity. The site runs its hero canvas at 0.55. */
    opacity?: number;
    /** Seconds added to the clock, so two scenes on the same framing are not
     *  the same moment of the same animation. */
    timeOffset?: number;
    /** The ribbon's clock, in seconds, supplied by the caller. Overrides the
     *  frame-derived one — the film warps time so the art is nearly still
     *  while a slide is being read and quick across a cut. Must stay a pure
     *  function of the frame or seeking breaks. */
    time?: number;
    /** The site drives this from scroll; a film has no scroll, so it is a
     *  static framing choice here. */
    yOffset?: number;
    /**
     * The camera, as absolute values, applied every frame.
     *
     * Absolute rather than deltas because the path is no longer a per-scene
     * move — it is one continuous route through the plane, computed for the
     * whole film in Plane.tsx. Anything omitted keeps the framing's value.
     *
     * planeBend and planeTwist are accepted here too, and they do something
     * different in kind: they reshape the ribbon rather than move past it.
     * They cost a mesh rebuild per frame, which is affordable at 12x12 and
     * would not be at a finer resolution.
     */
    camera?: NeatTravel;
    /**
     * Supersampling factor. The gradient is flat-shaded geometry with hard
     * silhouettes and hairline texture bands, and it aliases badly: the
     * context asks for MSAA and headless Chrome does not give it, and MSAA
     * would not have fixed the banding anyway — that is interior detail, which
     * only more samples per pixel can resolve. So the canvas is laid out at
     * 2x and scaled down, which is true supersampling and costs 4x the
     * fragments of a shader that was never the bottleneck.
     */
    supersample?: number;
    style?: React.CSSProperties;
}

export const NeatCanvas: React.FC<NeatCanvasProps> = ({
    framing = "full",
    opacity = 0.62,
    timeOffset = 0,
    time,
    yOffset,
    camera,
    supersample = 2,
    style,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const neatRef = useRef<NeatGradientInstance | null>(null);
    const clockRef = useRef(new DeterministicClock());
    const handleRef = useRef<number | null>(null);
    const [licensed, setLicensed] = useState(false);

    const frame = useCurrentFrame();
    const { fps, width, height } = useVideoConfig();

    /* The canvas is sized in EXPLICIT PIXELS, not percentages.
     *
     * `_initScene` sizes the backbuffer from `this._ref.clientWidth || 300`,
     * and inside a layout effect a percentage-sized canvas has not been laid
     * out yet — `clientWidth` is 0. So the fallback won, and every gradient in
     * this film was rendering at 300x150 and being stretched to 1920x1080.
     * That is what the pixelation was: not aliasing, a six-fold upscale.
     *
     * Percentages cannot be made to work here, because the value has to be
     * right on the first synchronous read. The composition size is known, so
     * it is used directly and nothing depends on an ancestor being measured.
     *
     * With that fixed, 2x on top is real supersampling: the library renders at
     * 3840x2160 and the browser downsamples. Worth it because this is
     * flat-shaded geometry with hard silhouettes and hairline bands — the
     * context asks for MSAA, headless Chrome declines, and MSAA would not have
     * touched the bands anyway since those are interior detail. */
    const ss = Math.max(1, supersample);

    // Build once, at t=0. Kept out of the per-frame effect because rebuilding
    // recompiles shaders and regenerates geometry — and because `tick` is only
    // absolute if construction happens at a known time.
    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        if (!NeatGradient) throw new Error("@firecms/neat did not export NeatGradient");

        handleRef.current = delayRender("neat: licence, then first draw");
        const clock = clockRef.current;

        const neat = clock.run(0, () =>
            new NeatGradient({
                ...NEAT_BASE_CONFIG,
                ...FRAMING[framing],
                ...(yOffset !== undefined ? { yOffset } : {}),
                ref: canvas,
                // Without this the animation starts at "seconds elapsed in the
                // current hour" and no two renders match.
                seed: 0,
                // A WebGL backbuffer is allowed to be discarded after
                // compositing. A renderer screenshots whenever it is ready, so
                // without this the capture is intermittently blank.
                preserveDrawingBuffer: true,
                antialias: true,
            }),
        );

        neatRef.current = neat;

        /* Cut every path that can draw a frame we did not ask for.
         *
         * Neat re-renders from three browser callbacks: a ResizeObserver, an
         * IntersectionObserver, and visibilitychange. All three fire
         * asynchronously — OUTSIDE the window where performance.now() is ours
         * — so each one runs `tick += (realNow - lastTime) / 1000 * speed`
         * against a real millisecond clock and a fake lastTime of a few
         * thousand. The animation jumps by however long the machine happened
         * to take, which is different on every run.
         *
         * That is not theoretical: with the observers live, the same frame
         * rendered twice came back as two different images. It is also exactly
         * the kind of bug that survives review, because the output is
         * plausible every time — just never twice the same.
         *
         * Nothing is lost by removing them. The canvas cannot resize during a
         * render and it is always on screen; both observers exist to save
         * battery on a web page. */
        const internals = neat as unknown as {
            sizeObserver?: { disconnect(): void };
            _visibilityObserver?: { disconnect(): void };
            _visibilityHandler?: EventListener;
        };
        internals.sizeObserver?.disconnect();
        internals._visibilityObserver?.disconnect();
        if (internals._visibilityHandler) {
            document.removeEventListener("visibilitychange", internals._visibilityHandler);
        }

        /* The licence is verified asynchronously, and until it resolves the
         * instance draws a "NEAT" watermark into the bottom-right of the
         * canvas. The constructor has already drawn two frames by this line,
         * both watermarked.
         *
         * Waiting for the flag is necessary but NOT sufficient, and getting
         * that wrong is what put a watermark into the first three frames of a
         * render: releasing the delayRender the moment the licence lands
         * screenshots whatever is already in the buffer, and what is in the
         * buffer is a watermarked draw. `preserveDrawingBuffer` guarantees it
         * is still there.
         *
         * So the flag only flips a state bit. The handle is released by the
         * per-frame effect below, AFTER it has drawn once with the licence in
         * hand — which means no frame can exist that was not drawn licensed. */
        const startedAt = Date.now();
        const waitForLicence = () => {
            if (!neatRef.current) return;   // unmounted while we waited
            if ((neat as unknown as { _licensed?: boolean })._licensed) {
                setLicensed(true);
                return;
            }
            if (Date.now() - startedAt > 10_000) {
                throw new Error(
                    "Neat licence did not validate within 10s — every frame would carry a " +
                    "watermark. Check licenseKey in src/data/neat-config.ts (pnpm neat:config).",
                );
            }
            setTimeout(waitForLicence, 20);
        };
        waitForLicence();

        return () => {
            neat.destroy();
            neatRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [framing, yOffset, width, height, ss]);

    // One draw per frame, at a time we choose.
    useLayoutEffect(() => {
        const neat = neatRef.current;
        if (!neat || !licensed) return;

        // An IntersectionObserver decides this, and a headless renderer is not
        // a reliable place to ask whether something is on screen. It only
        // gates rAF re-registration — but that queue is the animation, so
        // losing it once freezes the gradient for the rest of the render.
        (neat as unknown as { _isVisible: boolean })._isVisible = true;

        // Move the camera BEFORE the draw, so the frame that is captured is the
        // one this position produces rather than the previous one.
        if (camera) {
            const target = neat as unknown as Record<Movable, number>;
            for (const key of MOVABLE) {
                const value = camera[key];
                if (value !== undefined) target[key] = value;
            }
        }

        clockRef.current.advanceTo(((time ?? frame / fps) + timeOffset) * 1000);

        // Only now is there a frame worth photographing.
        if (handleRef.current !== null) {
            continueRender(handleRef.current);
            handleRef.current = null;
        }
    });


    return (
        <div
            aria-hidden
            style={{
                position: "absolute",
                inset: 0,
                overflow: "hidden",
                opacity,
                ...style,
            }}
        >
            <canvas
                ref={canvasRef}
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: width * ss,
                    height: height * ss,
                    transform: `scale(${1 / ss})`,
                    transformOrigin: "top left",
                    display: "block",
                }}
            />
        </div>
    );
};

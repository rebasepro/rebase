import React from "react";
import { AbsoluteFill, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { ramp } from "../components/motion";
import { BEAT, FPS } from "./score";
import { Vignette } from "./kit";

/**
 * The first two bars: the product, up close, cut every two beats.
 *
 * No type and no window — just the real panel and Studio, magnified until
 * the UI is texture, the way a teaser opens on a detail before it says what
 * the thing is. Footage is the demo's own (public/demo, 2560x1600 renders of
 * the live demo), so every frame here is the shipped product.
 */

interface MacroShot {
    file: string;
    /** Seconds into the clip. */
    from: number;
    rate?: number;
    /** Point of the clip held at frame centre, as fractions, start → end. */
    focus: [[number, number], [number, number]];
    zoom: [number, number];
}

const SHOT = BEAT * 2;

const SHOTS: MacroShot[] = [
    // The product grid, scrolling: photos, prices, status chips.
    { file: "demo/panel.mp4", from: 0.3, focus: [[0.36, 0.34], [0.46, 0.4]], zoom: [1.9, 2.1] },
    // Studio's SQL editor mid-keystroke, its autocomplete open.
    { file: "demo/studio.mp4", from: 8.5, rate: 1.4, focus: [[0.34, 0.08], [0.4, 0.1]], zoom: [2.3, 2.5] },
    // The schema editor: an enum's values, one per row.
    { file: "demo/schema.mp4", from: 5.4, focus: [[0.72, 0.66], [0.76, 0.6]], zoom: [2.1, 2.3] },
    // Orders, scrolling past: the status column.
    { file: "demo/orders.mp4", from: 1.2, rate: 1.3, focus: [[0.36, 0.44], [0.46, 0.5]], zoom: [2.0, 2.2] },
];

/** The clip fills the frame at `zoom` x its cover size; the focus point is
 *  held at centre unless that would show past the clip's edge. */
const Macro: React.FC<{ shot: MacroShot }> = ({ shot }) => {
    const frame = useCurrentFrame();
    const t = frame / SHOT;
    // A short punch on the cut: the shot lands slightly closer and settles.
    const punch = 1 + 0.06 * (1 - ramp(frame, 0, 14));
    const zoom = interpolate(t, [0, 1], shot.zoom) * punch;
    const fx = interpolate(t, [0, 1], [shot.focus[0][0], shot.focus[1][0]]);
    const fy = interpolate(t, [0, 1], [shot.focus[0][1], shot.focus[1][1]]);

    const w = 1920 * zoom;
    const h = 1200 * zoom;
    const left = Math.min(0, Math.max(1920 - w, 960 - fx * w));
    const top = Math.min(0, Math.max(1080 - h, 540 - fy * h));

    return (
        <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
            <div style={{ position: "absolute", left, top, width: w, height: h }}>
                <OffthreadVideo
                    src={staticFile(shot.file)}
                    trimBefore={Math.round(shot.from * FPS)}
                    playbackRate={shot.rate ?? 1}
                    muted
                    style={{ width: "100%", height: "100%" }}
                />
            </div>
            <Vignette />
        </AbsoluteFill>
    );
};

export const Hook: React.FC = () => (
    <AbsoluteFill>
        {SHOTS.map((shot, i) => (
            <Sequence key={shot.file} from={i * SHOT} durationInFrames={SHOT}>
                <Macro shot={shot} />
            </Sequence>
        ))}
    </AbsoluteFill>
);

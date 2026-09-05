import React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { BentoTiles } from "../../bento/Bento";
import { Map as SchemaMap } from "../../reel/Map";
import { PanelWindow, ShotLabel, PANEL_SHOTS, type Shot } from "../../components/PanelWindow";
import { StudioWindow } from "../../components/StudioWindow";
import { ramp } from "../../components/motion";
import { FONT } from "../../theme";
import { useTone } from "../../Plane";

/**
 * THE TOUR — what else you got, once the backend is safe. Four windows the
 * camera visits quickly: the panel, every view, the schema, Studio. Each is
 * the slide film's scene with its Stage removed and its position handed in;
 * the footage, the timing inside each window and the copy are unchanged.
 */

/** Shorter than the slide film's montage — the beat is shorter. */
const SHOTS: Shot[] = [
    { ...PANEL_SHOTS[0], frames: 50 },
    { ...PANEL_SHOTS[1], frames: 104 },
    { ...PANEL_SHOTS[2], frames: 70 },
];

export const Panel: React.FC<{ x: number; y: number; at: number; tail: number }> = ({ x, y, at, tail }) => (
    <div style={{ position: "absolute", left: x, top: y, width: 1520, display: "flex", gap: 72, alignItems: "flex-start" }}>
        <Sequence from={at} layout="none">
            <div style={{ width: 520, flexShrink: 0, paddingTop: 230 }}>
                <ShotLabel shots={SHOTS} firstShotAt={14} />
            </div>
            <div style={{ flex: 1 }}>
                {/* The first shot starts almost as the window lands — an
                    empty black window for twenty frames read as a broken
                    video, not as anticipation. */}
                <PanelWindow shots={SHOTS} firstShotAt={14} enterAt={4} tail={tail} />
            </div>
        </Sequence>
    </div>
);

export const Views: React.FC<{ x: number; y: number; at: number; hold: number }> = ({ x, y, at, hold }) => (
    <Sequence from={at} layout="none">
        {/* The bento positions its own tiles absolutely, so it takes the
            world box directly. Composed for the slide film's 240-frame
            window, then held for the pull-back. */}
        <BentoTiles
            box={{ x: x + 80, y: y + 80, w: 1760, h: 920, gap: 16 }}
            duration={240}
            hold={hold}
            travel={110}
            lift={30}
        />
    </Sequence>
);

export const Schema: React.FC<{ x: number; y: number; at: number }> = ({ x, y, at }) => (
    <div style={{ position: "absolute", left: x, top: y, width: 1920, height: 1080 }}>
        <Sequence from={at} layout="none">
            <SchemaMap tempo="quick" captionAt={92} />
        </Sequence>
    </div>
);

const SURFACES = [
    ["SQL editor", "Query your data, with the schema beside it"],
    ["Schema visualizer", "Tables and relations, as they really are"],
    ["RLS editor", "Read and write the policies where they live"],
    ["Logs & API explorer", "Every request, and what it was answered with"],
];

export const Studio: React.FC<{ x: number; y: number; at: number }> = ({ x, y, at }) => (
    <div style={{ position: "absolute", left: x, top: y, width: 1520, display: "flex", gap: 64, alignItems: "center" }}>
        <Sequence from={at} layout="none">
            <div style={{ width: 520, flexShrink: 0, paddingTop: 210 }}>
                <StudioList />
            </div>
            <div style={{ flex: 1 }}>
                <StudioWindow enterAt={4} driftUntil={140} />
            </div>
        </Sequence>
    </div>
);

const StudioList: React.FC = () => {
    const frame = useCurrentFrame();
    const tone = useTone();
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {SURFACES.map(([name, note], i) => {
                const t = ramp(frame, 20 + i * 7, 20);
                return (
                    <div key={name} style={{ opacity: t, transform: `translateY(${(1 - t) * 8}px)` }}>
                        <div
                            style={{
                                fontFamily: FONT.display,
                                fontWeight: 600,
                                fontSize: 23,
                                letterSpacing: "-0.014em",
                                color: tone.high,
                            }}
                        >
                            {name}
                        </div>
                        <div style={{ fontFamily: FONT.body, fontSize: 17, color: tone.muted, marginTop: 1 }}>{note}</div>
                    </div>
                );
            })}
        </div>
    );
};

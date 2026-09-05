import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { beat, cameraAt, cameraStill, DESK, DESK_DURATION, windowOpacity } from "./beats";
import { Title } from "./Title";
import { AgentSession, ScanNote, ScanWindow } from "./windows/Hook";
import { RuleWindows } from "./windows/Rule";
import { Shell } from "./windows/Shell";
import { UsersWindows } from "./windows/Users";
import { AgentConsole } from "./windows/AgentConsole";
import { Panel, Schema, Studio, Views } from "./windows/Tour";
import { ToneOverride } from "../Plane";
import { DISPLAY } from "../components/Type";
import { TONE } from "../theme";

/**
 * The desk: every window at its place in the world, appearing when the
 * story reaches it, under one camera.
 *
 * Positions are world pixels. Each cell is one frame of world (1920 x 1080)
 * and the content inside a cell keeps the slide film's measure — 200 in from
 * the cell's left edge, headline at 180 from its top — so a held shot on the
 * desk is composed exactly like a slide was. The camera is what changed, not
 * the typography.
 *
 * Nothing here is ever unmounted once it has appeared. The last shot pulls
 * back to show the whole desk, and a window that had been tidied away would
 * leave a hole in it.
 */

const HOOK = beat("hook");
const RULE = beat("rule");
const PUSH = beat("push");
const USERS = beat("users");
const AGENT = beat("agent");
const PANEL = beat("panel");
const VIEWS = beat("views");
const SCHEMA = beat("schema");
const STUDIO = beat("studio");
const COMMANDS = beat("commands");

/* The scan re-runs once `db push` has printed — timed against the shell's
   own typing so the second command starts the moment the first window is
   done. See Shell.tsx for the session; these are its arithmetic. */
const SHELL_AT = PUSH.start + 6;
const RERUN_AT = SHELL_AT + 96;
const DEV_AT = COMMANDS.start + 20;

const Chroma: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <ToneOverride.Provider value={TONE.claim}>{children}</ToneOverride.Provider>
);

/** On camera during these beats; fades across the moves between. See
 *  `windowOpacity` in beats.ts for why. The wrapper is not positioned, so
 *  the absolutely placed windows inside still measure from the desk.
 *
 *  Headlines start four frames BEFORE their beat — while the camera is still
 *  settling — because the outgoing windows are gone by the middle of the move
 *  and a headline that waited for the camera to stop left six frames of bare
 *  ground between the two. */
const On: React.FC<{ beats: string[]; children: React.ReactNode }> = ({ beats, children }) => {
    const frame = useCurrentFrame();
    const o = windowOpacity(frame, beats);
    if (o <= 0) return null;
    return <div style={o < 1 ? { opacity: o } : undefined}>{children}</div>;
};

export const Desk: React.FC = () => {
    const frame = useCurrentFrame();
    const cam = cameraAt(frame);
    const still = cameraStill(frame);
    // Whole pixels at rest, so type rasterises the same on every held frame.
    const x = still ? Math.round(cam.x) : cam.x;
    const y = still ? Math.round(cam.y) : cam.y;

    return (
        <AbsoluteFill style={{ overflow: "hidden" }}>
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: DESK.w,
                    height: DESK.h,
                    transformOrigin: "0 0",
                    transform: `scale(${cam.zoom}) translate(${-x}px, ${-y}px)`,
                }}
            >
                {/* ── (0,0) THE HOOK ─────────────────────────────────── */}
                {/* Lower than a slide's headline: the push view later shares
                    this cell's bottom half, so the hook keeps to its top two
                    thirds — and set at 180 that left a third of the frame
                    empty under two small windows. */}
                <On beats={["hook", "all"]}>
                    <Title
                        x={200}
                        y={250}
                        at={HOOK.start - 4}
                        lines={["Anyone can have a backend by lunch.", "Nobody can tell you if it's safe."]}
                    />
                </On>
                <On beats={["hook", "push", "all"]}>
                    <AgentSession x={200} y={550} w={740} at={HOOK.start + 30} />
                    {/* Wide enough that the tool's own clean line — 70 characters
                        of it — sits on one row. Wrapped, it read as two findings. */}
                    <ScanWindow x={1010} y={550} w={880} at={HOOK.start + 130} rerunAt={RERUN_AT} />
                    <ScanNote x={1010} y={868} at={RERUN_AT + 70} />
                </On>

                {/* ── (0,½) PUSH, then (0,¾) THE THREE COMMANDS ──────── */}
                <On beats={["push", "commands", "all"]}>
                    <Shell x={870} y={1080} w={1020} at={SHELL_AT} devAt={DEV_AT} />
                </On>
                <On beats={["commands", "all"]}>
                    <Title
                        x={200}
                        y={1090}
                        at={COMMANDS.start}
                        eyebrow="The first five minutes"
                        lines={["Init.", "Push.", "Run."]}
                        width={560}
                    />
                </On>

                {/* ── (1,0) THE RULE — on the blue field ─────────────── */}
                <On beats={["rule", "all"]}>
                    <Chroma>
                        <Title
                            x={2120}
                            y={180}
                            at={RULE.start - 4}
                            eyebrow="Row-level security"
                            lines={["Security lives in the database."]}
                        />
                        <RuleWindows x={2120} y={480} at={RULE.start + 24} />
                    </Chroma>
                </On>

                {/* ── (1,1) TWO PEOPLE ───────────────────────────────── */}
                <On beats={["users", "all"]}>
                    <Title
                        x={2120}
                        y={1260}
                        at={USERS.start - 4}
                        eyebrow="Row-level security, running"
                        lines={["The same query, twice."]}
                    />
                    <UsersWindows x={2120} y={1440} at={USERS.start + 20} />
                </On>

                {/* ── (2,0) THE AGENT — on the deep field ────────────── */}
                <On beats={["agent", "all"]}>
                    <ToneOverride.Provider value={TONE.deep}>
                        <Title
                            x={4040}
                            y={180}
                            at={AGENT.start - 4}
                            eyebrow="Agent-native"
                            lines={["An agent gets your permissions.", "No way around them."]}
                        />
                        <AgentConsole x={4040} y={500} w={1520} at={AGENT.start + 26} />
                    </ToneOverride.Provider>
                </On>

                {/* ── (2,1) THE PANEL ────────────────────────────────── */}
                <On beats={["panel", "all"]}>
                    <Title
                        x={4040}
                        y={1380}
                        at={PANEL.start - 4}
                        eyebrow="The panel"
                        lines={["And an app for", "everyone else."]}
                        size={DISPLAY.split}
                        width={520}
                    />
                    <Panel x={4040} y={1330} at={PANEL.start + 6} tail={DESK_DURATION - PANEL.start} />
                </On>

                {/* ── (2,2) EVERY VIEW ───────────────────────────────── */}
                <On beats={["views", "all"]}>
                    <Views x={3840} y={2160} at={VIEWS.start - 6} hold={DESK_DURATION - VIEWS.start} />
                </On>

                {/* ── (1,2) THE SCHEMA ───────────────────────────────── */}
                <On beats={["schema", "all"]}>
                    <Schema x={1920} y={2160} at={SCHEMA.start - 4} />
                </On>

                {/* ── (0,2) STUDIO ───────────────────────────────────── */}
                <On beats={["studio", "all"]}>
                    <Title
                        x={200}
                        y={2440}
                        at={STUDIO.start - 4}
                        eyebrow="Studio"
                        lines={["Run the database", "from the same app."]}
                        size={DISPLAY.split}
                        width={520}
                    />
                    <Studio x={200} y={2410} at={STUDIO.start + 6} />
                </On>
            </div>
        </AbsoluteFill>
    );
};

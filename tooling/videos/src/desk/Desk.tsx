import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { beat, cameraAt, cameraStill, DESK, DESK_DURATION, windowOpacity } from "./beats";
import { FLY_TO_CORNER } from "./Presenter";
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
 * THE BOTTOM-RIGHT CORNER OF EVERY VIEW IS RESERVED — 1600..1860 by 760..1020
 * in screen space — for the presenter (Presenter.tsx). Nothing that has to
 * be read sits there: the shell and the agent console stop at 1580, the two
 * users' panels are 640 wide, the panel and Studio windows sit high enough
 * to end above 760, the bento is scaled to end at 1600. A window's empty
 * right margin may run under the corner; its text may not.
 *
 * Nothing here is ever unmounted once it has appeared. The last shot pulls
 * back to show the whole desk, and a window that had been tidied away would
 * leave a hole in it.
 */

const HOOK = beat("hook");
const INIT = beat("init");
const RULE = beat("rule");
const PUSH = beat("push");
const USERS = beat("users");
const AGENT = beat("agent");
const PANEL = beat("panel");
const VIEWS = beat("views");
const SCHEMA = beat("schema");
const STUDIO = beat("studio");

/* The shell's three commands, on the film's clock. `init` types as the
   camera lands on the terminal; `db push` types on the return visit; the
   scan re-runs the moment push has printed "RLS policies applied"; `dev`
   types once the scan has come back clean. See Shell.tsx for the session
   itself — these are its arithmetic (typing at 0.55 frames a character). */
const SHELL_AT = INIT.start + 8;
const PUSH_AT = PUSH.start + 14;
const RERUN_AT = PUSH_AT + 8 + 40 + 4;
const DEV_AT = RERUN_AT + 70;

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
                {/* The hook's windows arrive as the presenter leaves the middle
                    of the frame for the corner: the headline first, the agent's
                    summary under it, and the scan last, so its findings print
                    under "found three ways in". */}
                <On beats={["hook", "all"]}>
                    <Title
                        x={200}
                        y={230}
                        at={FLY_TO_CORNER + 12}
                        lines={["Anyone can have a backend by lunch.", "Nobody can tell you if it's safe."]}
                    />
                </On>
                <On beats={["hook", "init", "push", "all"]}>
                    <AgentSession x={200} y={530} w={740} at={FLY_TO_CORNER + 18} />
                    {/* Wide enough that the tool's own clean line — 70 characters
                        of it — sits on one row at 18px. Wrapped, it read as two
                        findings; wider, it ran under the presenter. */}
                    <ScanWindow x={1010} y={530} w={820} at={FLY_TO_CORNER + 26} rerunAt={RERUN_AT} />
                    <ScanNote x={1010} y={846} at={RERUN_AT + 70} />
                </On>

                {/* ── (0,½) THE TERMINAL — init, then push, then dev ─── */}
                <On beats={["init", "push", "all"]}>
                    <Shell x={200} y={1000} w={1380} at={SHELL_AT} pushAt={PUSH_AT} devAt={DEV_AT} />
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
                        <AgentConsole x={4040} y={500} w={1380} at={AGENT.start + 26} />
                    </ToneOverride.Provider>
                </On>

                {/* ── (2,1) THE PANEL ────────────────────────────────── */}
                <On beats={["panel", "all"]}>
                    <Title
                        x={4040}
                        y={1300}
                        at={PANEL.start - 4}
                        eyebrow="The panel"
                        lines={["And an app for", "everyone else."]}
                        size={DISPLAY.split}
                        width={520}
                    />
                    <Panel x={4040} y={1250} at={PANEL.start + 6} tail={DESK_DURATION - PANEL.start} />
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
                        y={2360}
                        at={STUDIO.start - 4}
                        eyebrow="Studio"
                        lines={["Run the database", "from the same app."]}
                        size={DISPLAY.split}
                        width={520}
                    />
                    <Studio x={200} y={2330} at={STUDIO.start + 6} />
                </On>
            </div>
        </AbsoluteFill>
    );
};

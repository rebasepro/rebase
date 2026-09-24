import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { DESK } from "./beats";
import { useDeskTimeline } from "./timeline";
import { Title } from "./Title";
import { AgentSession, ScanWindow } from "./windows/Hook";
import { More } from "./windows/More";
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

/* The shell's three commands, the scan's two runs, the agent's refusal —
   every moment below is a cue in timeline.ts, hung off a beat or a word.
   See Shell.tsx for the session itself; typing is 0.55 frames a character. */

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
    const o = useDeskTimeline().windowOpacity(frame, beats);
    if (o <= 0) return null;
    return <div style={o < 1 ? { opacity: o } : undefined}>{children}</div>;
};

export const Desk: React.FC = () => {
    const frame = useCurrentFrame();
    const tl = useDeskTimeline();
    const { cues } = tl;
    const cam = tl.camera(frame);
    const still = tl.cameraStill(frame);
    /* A beat not yet placed — live, a line not yet said — has no windows:
       they are left out of the tree, not faded, until its moment comes. */
    const RULE = tl.beat("rule");
    const USERS = tl.beat("users");
    const AGENT = tl.beat("agent");
    const PANEL = tl.beat("panel");
    const VIEWS = tl.beat("views");
    const SCHEMA = tl.beat("schema");
    const STUDIO = tl.beat("studio");
    const MORE = tl.beat("more");
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
                    of the frame for the corner, under the second line: the
                    headline first, the agent's summary during "built by an
                    agent. It works.", and the scan last, so its findings print
                    under "found three ways in". */}
                {cues.hookTitle !== null && (
                    <On beats={["hook", "all"]}>
                        <Title
                            x={200}
                            y={230}
                            at={cues.hookTitle}
                            lines={["Anyone can build a backend", "in an afternoon.", "Nobody can tell you if it's safe."]}
                        />
                    </On>
                )}
                <On beats={["hook", "init", "push", "all"]}>
                    {/* The scan sits on the LEFT: its report is 72 columns wide
                        and its summary line 77, and on the right that ran under
                        the presenter's corner. The agent's session, whose lines
                        are short, takes the right. 740 wide at 14px holds the
                        widest line the tool prints, the 77-character summary. Timed so the tally prints
                        under "nine critical". */}
                    {cues.scan !== null && (
                        <ScanWindow x={200} y={540} w={740} at={cues.scan} reportAt={cues.scanReport} rerunAt={cues.rerun} />
                    )}
                    {cues.agentSession !== null && <AgentSession x={960} y={540} w={620} at={cues.agentSession} />}
                </On>

                {/* ── (0,½) THE TERMINAL — init, then push, then dev ─── */}
                {cues.shell !== null && (
                    <On beats={["init", "push", "all"]}>
                        <Shell x={200} y={1000} w={1380} at={cues.shell} pushAt={cues.push} devAt={cues.dev} />
                    </On>
                )}

                {/* ── (1,0) THE RULE — on the blue field ─────────────── */}
                {RULE && <On beats={["rule", "all"]}>
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
                </On>}

                {/* ── (1,1) TWO PEOPLE ───────────────────────────────── */}
                {USERS && <On beats={["users", "all"]}>
                    <Title
                        x={2120}
                        y={1260}
                        at={USERS.start - 4}
                        eyebrow="Row-level security, running"
                        lines={["The same query, twice."]}
                    />
                    {cues.users !== null && <UsersWindows x={2120} y={1440} at={cues.users} />}
                </On>}

                {/* ── (2,0) THE AGENT — on the deep field ────────────── */}
                {AGENT && <On beats={["agent", "all"]}>
                    <ToneOverride.Provider value={TONE.deep}>
                        <Title
                            x={4040}
                            y={180}
                            at={AGENT.start - 4}
                            eyebrow="Agent-native"
                            lines={["An agent gets your permissions.", "No way around them."]}
                        />
                        {cues.agentConsole !== null && (
                            <AgentConsole x={4040} y={500} w={1380} at={cues.agentConsole} refuseAt={cues.agentRefuse} />
                        )}
                    </ToneOverride.Provider>
                </On>}

                {/* ── (2,1) THE PANEL ────────────────────────────────── */}
                {PANEL && <On beats={["panel", "all"]}>
                    <Title
                        x={4040}
                        y={1300}
                        at={PANEL.start - 4}
                        eyebrow="The panel"
                        lines={["And an app for", "everyone else."]}
                        size={DISPLAY.split}
                        width={520}
                    />
                    <Panel x={4040} y={1250} at={PANEL.start + 6} tail={tl.until - PANEL.start} />
                </On>}

                {/* ── (2,2) EVERY VIEW ───────────────────────────────── */}
                {VIEWS && <On beats={["views", "all"]}>
                    <Views x={3840} y={2160} at={VIEWS.start - 6} hold={tl.until - VIEWS.start} />
                </On>}

                {/* ── (1,2) THE SCHEMA ───────────────────────────────── */}
                {SCHEMA && <On beats={["schema", "all"]}>
                    <Schema x={1920} y={2160} at={SCHEMA.start - 4} />
                </On>}

                {/* ── (0,2) STUDIO ───────────────────────────────────── */}
                {STUDIO && <On beats={["studio", "all"]}>
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
                </On>}

                {/* ── (0,3) THE WALL — what a hundred seconds leaves out ─── */}
                {MORE && <On beats={["more", "all"]}>
                    <More x={0} y={3240} at={MORE.start + 4} />
                </On>}
            </div>
        </AbsoluteFill>
    );
};

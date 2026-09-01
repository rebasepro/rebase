import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Stage } from "../components/Scene";
import { DisplayLine, DISPLAY } from "../components/Type";
import { Frame } from "../components/Frame";
import { ramp } from "../components/motion";
import { CHROMA, FONT, INK, TRACKING } from "../theme";

/**
 * CANDIDATE — a different opening for the film.
 *
 * The film currently opens on the second copy: you have written this table five
 * times. That is a real problem and it is the site's claim TWO. Claim one is
 * security, `SITE-STORY.md` ranks them deliberately, and rls-check is the
 * acquisition wedge — so the film leads with the second-best thing it has and
 * reaches the best one seventy seconds in.
 *
 * It is also the less DIFFERENTIATING of the two. Prisma, tRPC, zod, Supabase's
 * generated types, Directus and Payload all attack duplication; a viewer using
 * any of them hears "another codegen tool". Nobody else in the category can
 * make claim one.
 *
 * So this opens where 2026 actually is: getting a backend is no longer hard,
 * and knowing whether it is safe never got easier. The two halves are the same
 * database — the agent's summary of it, and what a read-only audit finds in it
 * ninety seconds later. The contrast is the whole scene; neither half is
 * interesting alone.
 */

const SHIPPED = [
    "auth · email, sessions, refresh",
    "CRUD for 8 tables",
    "REST + OpenAPI",
    "deployed · api.acme.com",
];

/* Findings on the agent's OWN database, and deliberately not the ones the
   proof scene shows. Those are a customer's production database a hundred
   seconds later; repeating public.invoices and public.documents here made the
   film audit the same tables twice and read as one canned screenshot used
   twice.

   All three are DATABASE findings. An earlier draft had rls-check reporting a
   service key committed in apps/web, which it cannot do and does not claim to:
   the proof scene says it opens a read-only transaction and nothing leaves
   your machine, and a filesystem finding here contradicted that on screen. */
const FOUND: { text: string; tone: "crit" | "body" | "fix" }[] = [
    { text: "[critical] rls-disabled     public.customers", tone: "crit" },
    { text: "readable by anyone holding the anon key", tone: "body" },
    { text: "[critical] anon-can-insert  public.orders", tone: "crit" },
    { text: "no policy restricts INSERT for anon", tone: "body" },
    { text: "[high]     permissive-select  public.tickets", tone: "crit" },
];

export const Plausible: React.FC = () => {
    const frame = useCurrentFrame();

    return (
        <AbsoluteFill>
            <Stage style={{ justifyContent: "flex-start", paddingTop: 92 }}>
                <DisplayLine size={DISPLAY.statement} delay={6}>
                    Anyone can have a backend by lunch.
                </DisplayLine>
                <DisplayLine size={DISPLAY.statement} delay={13}>
                    Nobody can tell you if it is safe.
                </DisplayLine>
            </Stage>

            <AbsoluteFill>
                <div style={{ position: "absolute", left: 200, top: 348, width: 700 }}>
                    <Frame title="agent · session summary" delay={30} bodyStyle={{ padding: "26px 30px 30px" }}>
                        {SHIPPED.map((line, i) => (
                            <div
                                key={line}
                                style={{
                                    display: "flex",
                                    gap: 14,
                                    alignItems: "center",
                                    padding: "9px 0",
                                    fontFamily: FONT.mono,
                                    fontSize: 19,
                                    color: INK.copy,
                                    opacity: ramp(frame, 40 + i * 9, 14),
                                }}
                            >
                                <span style={{ color: CHROMA.cyan }}>✔</span>
                                {line}
                            </div>
                        ))}
                        <div
                            style={{
                                marginTop: 18,
                                fontFamily: FONT.mono,
                                fontSize: 19,
                                color: INK.high,
                                opacity: ramp(frame, 82, 16),
                            }}
                        >
                            Done — your API is live.
                        </div>
                    </Frame>
                </div>

                <div style={{ position: "absolute", left: 980, top: 348, width: 740 }}>
                    <Frame
                        title="rls-check · the same database"
                        delay={112}
                        bodyStyle={{ padding: "26px 30px 30px" }}
                    >
                        {FOUND.map((l, i) => (
                            <div
                                key={l.text}
                                style={{
                                    padding: "7px 0",
                                    paddingLeft: l.tone === "body" ? 26 : 0,
                                    fontFamily: FONT.mono,
                                    fontSize: l.tone === "body" ? 16 : 18,
                                    color: l.tone === "crit" ? CHROMA.coral : INK.muted,
                                    opacity: ramp(frame, 124 + i * 11, 14),
                                    whiteSpace: "pre",
                                }}
                            >
                                {l.text}
                            </div>
                        ))}
                        <div
                            style={{
                                marginTop: 18,
                                fontFamily: FONT.mono,
                                fontSize: 18,
                                color: CHROMA.coral,
                                letterSpacing: TRACKING.eyebrow,
                                opacity: ramp(frame, 186, 16),
                            }}
                        >
                            2 critical · 1 high
                        </div>
                    </Frame>
                </div>

                <div
                    style={{
                        position: "absolute",
                        left: 200,
                        top: 852,
                        width: 1500,
                        fontFamily: FONT.body,
                        fontSize: 26,
                        lineHeight: 1.5,
                        color: INK.copy,
                        opacity: ramp(frame, 208, 26),
                    }}
                >
                    Agents made day-one code cheap. Nothing made the day-thirty
                    problems cheaper —
                    <span style={{ color: INK.high }}> and the database is the only place they can be answered once.</span>
                </div>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};

export const PLAUSIBLE_DURATION = 300;

import React from "react";
import { useCurrentFrame } from "remotion";
import { Scene, Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { Frame } from "../components/Frame";
import { Code, CodeCaption } from "../components/Code";
import { ramp } from "../components/motion";
import { FONT } from "../theme";
import { useTone } from "../Plane";

/**
 * 05 · HEADLESS — the first of the three adoption modes.
 *
 * The product's own shape is three modes — BaaS, CMS, Full — and the film had
 * been telling only the middle of that. This is the bottom: everything you get
 * before any UI exists at all.
 *
 * It used to close on "No React anywhere in your dependency tree", lifted from
 * PRODUCT.md. That is a real distinction INTERNALLY — BaaS mode has no React
 * where CMS mode does — and it is terrible copy. This scene runs BEFORE the
 * panel is mentioned, so the viewer has no reason to think React was ever on
 * the table: the line answers a question nobody asked, and boasting that a
 * backend has no UI framework in it reads as defensive.
 *
 * The line now describes the thing actually on screen beside it — the SDK is
 * generated, so a collection is a type rather than a string in a path.
 */

const SDK = `import { createRebaseClient } from "@rebasepro/client";
import { collectionsDictionary, type Database }
    from "./generated/sdk/database.types";

const client = createRebaseClient<Database>({
    baseUrl: "https://api.acme.com",
    collections: collectionsDictionary
});

const { data } = await client.data.orders.find({
    where: { status: ["==", "confirmed"] }
});

client.data.orders.listen({}, (res) => render(res.data));`;

/** Straight from PRODUCT.md's confirmed-capabilities list. */
const INCLUDED = [
    "REST", "Typed SDK",
    "Realtime", "Auth",
    "Storage", "Functions",
    "Cron", "Backups",
];

export const S05_Headless: React.FC = () => {
    const frame = useCurrentFrame();
    const tone = useTone();

    return (
        <Scene>
            <Stage>
                {/* MIRRORED. Five scenes in this film are a 520 column of type
                    beside one object, and laid out the same way every time they
                    read as one slide shown five times. Two of the five put the
                    object first instead — the measure is unchanged, so the block
                    still starts at STAGE_INSET; it is the order inside it that
                    flips. Here it also reads better: this scene's whole argument
                    is the evidence, so the evidence leads. */}
                <div style={{ display: "flex", flexDirection: "row-reverse", gap: 84, alignItems: "center" }}>
                    <div style={{ width: 520, flexShrink: 0 }}>
                        <Chapter n="04" label="Headless" delay={2} />
                        <div style={{ marginTop: 24 }}>
                            <DisplayLine size={DISPLAY.split} delay={8}>Take only</DisplayLine>
                            <DisplayLine size={DISPLAY.split} delay={13}>the backend.</DisplayLine>
                        </div>

                        {/* Two columns of eight, so the breadth is legible as a
                            SHAPE before any of it is read. A sentence listing
                            eight subsystems is a sentence nobody finishes. */}
                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 1fr",
                                gap: "10px 28px",
                                marginTop: 34,
                            }}
                        >
                            {INCLUDED.map((item, i) => {
                                const t = ramp(frame, 30 + i * 4, 16);
                                return (
                                    <div
                                        key={item}
                                        style={{
                                            fontFamily: FONT.mono,
                                            fontSize: 18,
                                            color: tone.copy,
                                            opacity: t,
                                            transform: `translateY(${(1 - t) * 6}px)`,
                                        }}
                                    >
                                        {item}
                                    </div>
                                );
                            })}
                        </div>

                        <div
                            style={{
                                marginTop: 34,
                                fontFamily: FONT.body,
                                fontSize: 21,
                                lineHeight: 1.5,
                                color: tone.muted,
                                opacity: ramp(frame, 66, 22),
                            }}
                        >
                            {/* A real mono span, not markdown backticks — those
                                render as literal backticks in a sans paragraph. */}
                            The SDK is generated from your collections.{" "}
                            <span style={{ fontFamily: FONT.mono, color: tone.copy }}>orders</span>{" "}
                            is a type, not a string.
                        </div>
                    </div>

                    <div style={{ flex: 1 }}>
                        <CodeCaption delay={16}>app/orders.ts</CodeCaption>
                        <Frame delay={18} style={{ marginTop: 12 }} bodyStyle={{ padding: "26px 30px" }}>
                            <Code code={SDK} delay={30} step={2} size={19} />
                        </Frame>
                    </div>
                </div>
            </Stage>
        </Scene>
    );
};

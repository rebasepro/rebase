import React from "react";
import { useCurrentFrame } from "remotion";
import { Scene, Stage } from "../components/Scene";
import { DisplayLine, Lead, DISPLAY } from "../components/Type";
import { ramp } from "../components/motion";
import { FONT, INK } from "../theme";

/**
 * 01 · THE HEADLINE — 140 frames.
 *
 * The site's hero, verbatim. Not paraphrased: the headline a visitor will read
 * thirty seconds after watching this had better be the one they just heard,
 * and "one definition, every surface" is a claim the product makes in exactly
 * these words or not at all.
 *
 * Composition follows the page too — the ribbon holds the top of the frame and
 * the type sits in the black beneath it. Nothing is ever laid over the art.
 */
export const S01_Headline: React.FC = () => {
    const frame = useCurrentFrame();
    const badge = ramp(frame, 6, 20);

    return (
        <Scene>
            <Stage style={{ justifyContent: "flex-end", paddingBottom: 150 }}>
                {/* The Postgres badge, before the headline has to say it. */}
                <div
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 12,
                        alignSelf: "flex-start",
                        border: `1px solid ${INK.rule}`,
                        background: "rgba(10,10,10,0.6)",
                        borderRadius: 999,
                        padding: "9px 20px",
                        marginBottom: 34,
                        fontFamily: FONT.body,
                        fontSize: 18,
                        fontWeight: 500,
                        color: "#A3A3A3",
                        opacity: badge,
                        transform: `translateY(${(1 - badge) * 10}px)`,
                    }}
                >
                    Open-source · Deploy anywhere · Postgres-native
                </div>

                <DisplayLine size={DISPLAY.bookend} delay={16}>The Postgres you already have.</DisplayLine>
                <DisplayLine size={DISPLAY.bookend} delay={26}>The backend you always wanted.</DisplayLine>

                <Lead delay={52} size={28} width={860} style={{ marginTop: 34 }}>
                    Point it at the database you already run. Nothing to provision,
                    nothing copied, nothing migrated.
                </Lead>
            </Stage>
        </Scene>
    );
};

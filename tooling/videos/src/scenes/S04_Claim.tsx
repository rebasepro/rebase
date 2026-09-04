import React from "react";
import { Scene, Stage } from "../components/Scene";
import { Chapter, DisplayLine, Lead, DISPLAY } from "../components/Type";
import { Frame } from "../components/Frame";
import { Code } from "../components/Code";

/**
 * 04 · THE CLAIM — 175 frames.
 *
 * The eyebrow used to read "The claim", which announces that an argument is
 * being made and so invites the viewer to discount it. It names the mechanism
 * now. The lead does the connective work — "the same collection you just saw"
 * is what makes this chapter three of one argument rather than slide four of
 * a feature list.
 *
 * The one full-chroma field in the first half of the film, and it is spent on
 * claim 1 of 4: security lives in the database. #0021C1 is the brand blue
 * deepened — the ground says THIS IS WHAT REBASE IS, and it is used once.
 *
 * White ink here is 10.6:1. That is worth stating because the OTHER chroma
 * ground in this film, coral, is the opposite case and takes dark ink; the two
 * are not interchangeable and neither is their type colour.
 *
 * The policy shown is a generated one, hashed name and all — that is what ends
 * up in the migration, and showing a hand-written policy here would quietly
 * contradict the sentence above it.
 */

const POLICY = `ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_select_9f2c1a4b ON orders
    FOR SELECT TO rebase_user
    USING (customer_id = rebase.uid());`;

export const S04_Claim: React.FC = () => (
    <Scene>
        {/* A STATEMENT layout, not a split. This ran a 90px headline inside
            a flex column beside the code frame — the largest type in the film
            after the bookends, crammed into half the width, and the only scene
            whose size matched no tier. The claim is the point of the scene, so
            it gets the full measure and the evidence sits beneath it.

            The lead used to open "generated from that same file". It ran second
            in an earlier cut, straight after the scene that shows the collection
            file, and the reference worked. This scene is now SECOND in the film
            — the answer to the safety problem, before any Rebase code has been
            on screen at all — so "that same file" pointed at something the
            viewer had not seen yet, and would not see for another seven
            seconds. It introduces the idea now and scene three reveals the
            file. Reordering scenes is a copy edit as well as a timeline edit. */}
        <Stage>
            <Chapter n="01" label="Row-level security" delay={4} />
            <div style={{ marginTop: 24 }}>
                <DisplayLine size={DISPLAY.statement} delay={10}>Security lives in the database.</DisplayLine>
            </div>

            <div style={{ display: "flex", gap: 76, alignItems: "flex-start", marginTop: 52 }}>
                <div style={{ width: 480, flexShrink: 0 }}>
                </div>

                <div style={{ flex: 1 }}>
                    <Frame
                        title="migrations/0004_orders.sql"
                        delay={26}
                        bodyStyle={{ padding: "28px 32px" }}
                    >
                        <Code code={POLICY} sql delay={44} step={3.5} size={22} />
                    </Frame>
                    <div
                        style={{
                            marginTop: 18,
                            fontFamily: "'JetBrains Mono', monospace",
                            fontSize: 16,
                            color: "rgba(255,255,255,0.66)",
                            letterSpacing: "0.02em",
                        }}
                    >
                        Applied by migration. Not by the server at boot.
                    </div>
                </div>
            </div>
        </Stage>

    </Scene>
);

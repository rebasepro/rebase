import React from "react";
import { useCurrentFrame } from "remotion";
import { Scene, Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { Frame } from "../components/Frame";
import { Code } from "../components/Code";
import { ramp, ENTER } from "../components/motion";
import { FONT } from "../theme";
import { useTone } from "../Plane";

/**
 * 02 · THE CLAIM — 210 frames.
 *
 * The one full-chroma field in the first half of the film, and it is spent on
 * claim 1 of 4: security lives in the database. #0021C1 is the brand blue
 * deepened — the ground says THIS IS WHAT REBASE IS, and it is used once.
 *
 * White ink here is 10.6:1. That is worth stating because the OTHER chroma
 * ground in this film, coral, is the opposite case and takes dark ink; the two
 * are not interchangeable and neither is their type colour.
 *
 * TWO FRAMES, and the second is made from the first. The line under the
 * headline is "enforced by Postgres, not by your code", and a scene that
 * showed only the policy was asserting that: a viewer sees SQL and has to
 * take on trust that it came from anywhere. So the rule is shown as it is
 * written — four lines of the collection file, the same four the next scene
 * shows in full — and the policy is shown being derived from it, with a line
 * drawn between them in the order the VO says them. What you write, then
 * what Postgres runs.
 *
 * The layout before this had a 480px column on the left with nothing in it —
 * the ghost of a lead paragraph that was cut two edits ago, still holding its
 * width, pushing the one frame to the right of a headline it belonged under.
 *
 * The policy shown is a generated one, hashed name and all — that is what
 * ends up in the migration, and showing a hand-written policy here would
 * quietly contradict the sentence above it.
 */

/** Verbatim from S03_OneDefinition's COLLECTION, so the file the next scene
 *  opens is recognisably the one this fragment came from. */
const RULE = `securityRules: [
    { operation: "select",
      using: "customer_id = rebase.uid()" }
]`;

const POLICY = `ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_select_9f2c1a4b ON orders
    FOR SELECT TO rebase_user
    USING (customer_id = rebase.uid());`;

/* Order of arrival, keyed to the line: the file lands under "every rule
   about who sees what", the connector draws on "enforced by", and the policy
   is on screen for "Postgres". */
const FILE_AT = 24;
const DRAW_AT = 74;
const POLICY_AT = 90;

export const S04_Claim: React.FC = () => {
    const frame = useCurrentFrame();
    const tone = useTone();
    const draw = ramp(frame, DRAW_AT, 18, ENTER);

    return (
        <Scene>
            <Stage>
                <Chapter n="01" label="Row-level security" delay={4} />
                <div style={{ marginTop: 24 }}>
                    <DisplayLine size={DISPLAY.statement} delay={10}>Security lives in the database.</DisplayLine>
                </div>

                <div style={{ display: "flex", gap: 0, alignItems: "center", marginTop: 56 }}>
                    <div style={{ width: 640, flexShrink: 0 }}>
                        <Frame title="collections/orders.ts" delay={FILE_AT} bodyStyle={{ padding: "26px 30px" }}>
                            <Code code={RULE} delay={FILE_AT + 14} step={4} size={22} />
                        </Frame>
                    </div>

                    {/* The connector. A line, not an arrow: it draws from the
                        file to the policy in the direction the derivation
                        runs, and the dot lands as the policy frame arrives. */}
                    <svg width={112} height={24} style={{ flexShrink: 0, display: "block" }}>
                        <line
                            x1={12}
                            y1={12}
                            x2={12 + 88 * draw}
                            y2={12}
                            stroke={tone.rule}
                            strokeWidth={1.5}
                        />
                        <circle cx={12} cy={12} r={3.5} fill={tone.copy} opacity={ramp(frame, DRAW_AT, 6)} />
                        <circle cx={100} cy={12} r={3.5} fill={tone.high} opacity={draw > 0.98 ? 1 : 0} />
                    </svg>

                    <div style={{ flex: 1 }}>
                        <Frame
                            title="migrations/0004_orders.sql"
                            delay={POLICY_AT}
                            bodyStyle={{ padding: "26px 30px" }}
                        >
                            <Code code={POLICY} sql delay={POLICY_AT + 14} step={3.5} size={22} />
                        </Frame>
                    </div>
                </div>

                <div
                    style={{
                        marginTop: 22,
                        fontFamily: FONT.mono,
                        fontSize: 16,
                        color: tone.muted,
                        letterSpacing: "0.02em",
                        opacity: ramp(frame, 138, 20),
                    }}
                >
                    Written once. Shipped as a migration. Checked by Postgres on every query.
                </div>
            </Stage>
        </Scene>
    );
};

import React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { Frame } from "../../components/Frame";
import { Code, CodeCaption } from "../../components/Code";
import { ramp, ENTER } from "../../components/motion";
import { FONT } from "../../theme";
import { useTone } from "../../Plane";

/**
 * THE RULE — four lines of the collection file, and the policy derived
 * from them. What you write, then what Postgres runs, joined in the order
 * the narration says them. Sits on the blue field.
 */

/** Verbatim from the collection file the product scaffolds. */
const RULE = `securityRules: [
    { operation: "select",
      using: "customer_id = rebase.uid()" }
]`;

const POLICY = `ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_select_9f2c1a4b ON orders
    FOR SELECT TO rebase_user
    USING (customer_id = rebase.uid());`;

const FILE_AT = 0;
const DRAW_AT = 52;
const POLICY_AT = 66;

export const RuleWindows: React.FC<{ x: number; y: number; at: number }> = ({ x, y, at }) => (
    <div style={{ position: "absolute", left: x, top: y, width: 1520 }}>
        <Sequence from={at} layout="none">
            <RuleBody />
        </Sequence>
    </div>
);

const RuleBody: React.FC = () => {
    const frame = useCurrentFrame();
    const tone = useTone();
    const draw = ramp(frame, DRAW_AT, 18, ENTER);
    return (
        <>
            <div style={{ display: "flex", alignItems: "flex-start" }}>
                <div style={{ width: 640, flexShrink: 0 }}>
                    <CodeCaption delay={FILE_AT}>collections/orders.ts</CodeCaption>
                    <Frame delay={FILE_AT + 4} style={{ marginTop: 12 }} bodyStyle={{ padding: "26px 30px" }}>
                        <Code code={RULE} delay={FILE_AT + 18} step={4} size={22} />
                    </Frame>
                </div>

                <svg width={112} height={24} style={{ flexShrink: 0, display: "block", marginTop: 112 }}>
                    <line x1={12} y1={12} x2={12 + 88 * draw} y2={12} stroke={tone.rule} strokeWidth={1.5} />
                    <circle cx={12} cy={12} r={3.5} fill={tone.copy} opacity={ramp(frame, DRAW_AT, 6)} />
                    <circle cx={100} cy={12} r={3.5} fill={tone.high} opacity={draw > 0.98 ? 1 : 0} />
                </svg>

                <div style={{ flex: 1 }}>
                    <CodeCaption delay={POLICY_AT - 4}>migrations/0004_orders.sql</CodeCaption>
                    <Frame delay={POLICY_AT} style={{ marginTop: 12 }} bodyStyle={{ padding: "26px 30px" }}>
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
                    opacity: ramp(frame, 118, 20),
                }}
            >
                Written once. Shipped as a migration. Checked by Postgres on every query.
            </div>
        </>
    );
};

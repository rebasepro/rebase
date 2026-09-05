import React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { Frame } from "../../components/Frame";
import { Code, CodeCaption } from "../../components/Code";
import { ramp, ENTER } from "../../components/motion";
import { FONT } from "../../theme";
import { useTone } from "../../Plane";

/**
 * THE RULE — the file `init` just wrote, with four lines added to it, and
 * the policy those four lines compile to. Sits on the blue field.
 *
 * The file is on screen FIRST, as introspection left it: a name, a table,
 * properties. Then the rule is typed into it. That order is the point of the
 * beat — you did not write a schema, you added a rule to a file that already
 * described your table — and a version that showed the rule alone read as
 * "here is some config", unattached to anything.
 */

const FILE = `export const orders = defineCollection({
    name: "Orders",
    table: "orders",
    properties: { reference, total, status, customer },
    securityRules: [
        { operation: "select",
          using: "customer_id = rebase.uid()" }
    ]
});`;

/* Lines 0-3 and 8 are the generated file; 4-7 are what gets added. */
const GENERATED = [0, 1, 2, 3, 8];
const ADDED = [4, 5, 6, 7];
const FILE_AT = 0;
const ADD_AT = 40;
const DRAW_AT = 86;
const POLICY_AT = 100;

const POLICY = `ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_select_9f2c1a4b ON orders
    FOR SELECT TO rebase_user
    USING (customer_id = rebase.uid());`;

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
    const delays = FILE.split("\n").map((_, i) =>
        GENERATED.includes(i) ? FILE_AT + 14 + GENERATED.indexOf(i) * 2 : ADD_AT + ADDED.indexOf(i) * 6,
    );
    return (
        <>
            <div style={{ display: "flex", alignItems: "flex-start" }}>
                <div style={{ width: 700, flexShrink: 0 }}>
                    <CodeCaption delay={FILE_AT}>collections/orders.ts</CodeCaption>
                    <Frame delay={FILE_AT + 4} style={{ marginTop: 12 }} bodyStyle={{ padding: "24px 28px" }}>
                        {/* The generated lines recede only once the rule starts
                            arriving — before that they are the whole file, and a
                            file shown dimmed reads as disabled. */}
                        <Code code={FILE} delays={delays} emphasise={frame >= ADD_AT ? ADDED : undefined} size={19} lazy />
                    </Frame>
                </div>

                <svg width={92} height={24} style={{ flexShrink: 0, display: "block", marginTop: 172 }}>
                    <line x1={12} y1={12} x2={12 + 68 * draw} y2={12} stroke={tone.rule} strokeWidth={1.5} />
                    <circle cx={12} cy={12} r={3.5} fill={tone.copy} opacity={ramp(frame, DRAW_AT, 6)} />
                    <circle cx={80} cy={12} r={3.5} fill={tone.high} opacity={draw > 0.98 ? 1 : 0} />
                </svg>

                <div style={{ flex: 1 }}>
                    <CodeCaption delay={POLICY_AT - 4}>migrations/0004_orders.sql</CodeCaption>
                    <Frame delay={POLICY_AT} style={{ marginTop: 12 }} bodyStyle={{ padding: "24px 28px" }}>
                        <Code code={POLICY} sql delay={POLICY_AT + 14} step={3.5} size={19} />
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
                    opacity: ramp(frame, 150, 20),
                }}
            >
                Four lines in the file. A policy in the database. Checked by Postgres on every query.
            </div>
        </>
    );
};

import React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { ALL, MINE, QUERY, Side } from "../../reel/TwoUsers";
import { ramp } from "../../components/motion";
import { CHROMA, FONT, INK } from "../../theme";

/**
 * TWO PEOPLE — one query, typed once, two answers. Robert, a customer, gets
 * his two orders; Dana, on support, gets all forty-eight. No middleware in
 * the picture and no mention of the policy: that was the previous beat's
 * job. Here it is just true.
 */
export const UsersWindows: React.FC<{ x: number; y: number; at: number }> = ({ x, y, at }) => (
    <div style={{ position: "absolute", left: x, top: y, width: 1520, height: 640 }}>
        <Sequence from={at} layout="none">
            <UsersBody />
        </Sequence>
    </div>
);

const UsersBody: React.FC = () => {
    const frame = useCurrentFrame();
    const typed = Math.round(ramp(frame, 4, QUERY.length * 0.8) * QUERY.length);
    return (
        <>
            <div
                style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    fontFamily: FONT.mono,
                    fontSize: 26,
                    color: INK.high,
                    opacity: ramp(frame, 2, 12),
                }}
            >
                {QUERY.slice(0, typed)}
                <span style={{ opacity: frame % 32 < 16 ? 1 : 0, color: CHROMA.cyan }}>▌</span>
            </div>
            <Side x={0} y={90} accent={CHROMA.cyan} who="Robert" role="customer" count="2 rows" rows={MINE} delay={44} />
            <Side x={780} y={90} accent={CHROMA.yellow} who="Dana" role="support" count="48 rows" rows={ALL} delay={44} />
        </>
    );
};

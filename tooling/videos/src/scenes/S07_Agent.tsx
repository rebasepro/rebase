import React from "react";
import { useCurrentFrame } from "remotion";
import { Scene, Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { Card } from "../components/Frame";
import { ramp } from "../components/motion";
import { FONT } from "../theme";
import { useTone } from "../Plane";

/**
 * 07 · AGENT-NATIVE — 150 frames.
 *
 * Claim 4. RAISED ground: three named mechanisms is a machine being opened,
 * and the sentence under them is the only part that is a claim.
 *
 * Three cards and no demo, deliberately. The site's version of this section
 * runs a live console beside it; a console in a five-second cut would be a
 * blur of text nobody can read, and the mechanisms are the point.
 *
 * The line under them used to restate the headline in longer words. It closes
 * the whole argument now instead — one definition, three audiences — which is
 * the sentence the film has spent fifty seconds earning and the last thing
 * said before the address.
 */

const MECHANISMS: [string, string][] = [
    ["MCP server", "The backend, as tools an agent can call."],
    ["Scoped API keys", "Per-collection, per-operation. A wildcard is not a scope."],
    ["Installable skills", "The agent learns your schema, not a generic API."],
];

export const S07_Agent: React.FC = () => {
    const frame = useCurrentFrame();
    const tone = useTone();

    return (
        <Scene>
            <Stage>
                <Chapter n="08" label="Agent-native" delay={4} />
                <div style={{ marginTop: 24 }}>
                    <DisplayLine size={DISPLAY.statement} delay={10}>
                        An agent gets the same authorization
                    </DisplayLine>
                    <DisplayLine size={DISPLAY.statement} delay={17}>you do. Not a way around it.</DisplayLine>
                </div>

                <div style={{ display: "flex", gap: 28, marginTop: 62 }}>
                    {MECHANISMS.map(([title, note], i) => (
                        <Card key={title} delay={34 + i * 7} style={{ flex: 1, padding: "30px 32px" }}>
                            <div
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: 14,
                                    letterSpacing: "0.22em",
                                    textTransform: "uppercase",
                                    color: tone.copy,
                                }}
                            >
                                {String(i + 1).padStart(2, "0")}
                            </div>
                            <div
                                style={{
                                    marginTop: 16,
                                    fontFamily: FONT.display,
                                    fontWeight: 600,
                                    fontSize: 34,
                                    letterSpacing: "-0.018em",
                                    color: tone.high,
                                }}
                            >
                                {title}
                            </div>
                            <div
                                style={{
                                    marginTop: 10,
                                    fontFamily: FONT.body,
                                    fontSize: 20,
                                    lineHeight: 1.5,
                                    color: tone.copy,
                                }}
                            >
                                {note}
                            </div>
                        </Card>
                    ))}
                </div>

            </Stage>
        </Scene>
    );
};

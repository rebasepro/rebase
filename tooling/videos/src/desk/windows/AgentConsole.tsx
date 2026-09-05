import React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { Frame } from "../../components/Frame";
import { ramp } from "../../components/motion";
import { CHROMA, FONT, INK } from "../../theme";

/**
 * THE AGENT — an MCP session against the same backend, under a scoped key.
 *
 * The tool names are the server's own (`packages/mcp`: list_documents,
 * delete_document) and the refusal is the one the API actually returns for
 * a key used outside its scope (`api-generator.ts`: 403 API_KEY_FORBIDDEN,
 * with that exact sentence). An invented error message in the one beat
 * about what an agent cannot do would be the film's own way around it.
 */

interface Line {
    kind: "call" | "key" | "ok" | "err" | "note";
    text: string;
    at: number;
}

const LINES: Line[] = [
    { kind: "key", text: "api key   acme-support · customers: read, write", at: 6 },
    { kind: "call", text: "list_documents   customers · where status = active", at: 22 },
    { kind: "ok", text: "← 48 documents", at: 44 },
    { kind: "call", text: "delete_document  customers · 3f9a2c7e-…", at: 74 },
    { kind: "err", text: "← 403 API_KEY_FORBIDDEN", at: 96 },
    { kind: "note", text: 'API key does not have "delete" permission for collection "customers"', at: 104 },
];

const COLOUR: Record<Line["kind"], string> = {
    call: INK.high,
    key: INK.muted,
    ok: "#34D399",
    err: CHROMA.coral,
    note: INK.copy,
};

export const AgentConsole: React.FC<{ x: number; y: number; w: number; at: number }> = ({ x, y, w, at }) => (
    <div style={{ position: "absolute", left: x, top: y, width: w }}>
        <Sequence from={at} layout="none">
            <ConsoleBody />
        </Sequence>
    </div>
);

const ConsoleBody: React.FC = () => {
    const frame = useCurrentFrame();
    return (
        <Frame title="mcp · rebase-mcp-server" delay={0} bodyStyle={{ padding: "26px 34px 30px" }}>
            <div style={{ fontFamily: FONT.mono, fontSize: 20, lineHeight: 1.75 }}>
                {LINES.map((l) => (
                    <div
                        key={l.text}
                        style={{
                            color: COLOUR[l.kind],
                            paddingLeft: l.kind === "ok" || l.kind === "err" ? 30 : l.kind === "note" ? 58 : 0,
                            fontSize: l.kind === "note" ? 17 : 20,
                            marginTop: l.kind === "call" ? 10 : 0,
                            opacity: ramp(frame, l.at, 10),
                            whiteSpace: "pre",
                        }}
                    >
                        {l.kind === "call" && <span style={{ color: INK.muted, marginRight: 14 }}>agent ›</span>}
                        {l.text}
                    </div>
                ))}
            </div>
        </Frame>
    );
};

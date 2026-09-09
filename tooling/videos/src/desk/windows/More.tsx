import React from "react";
import { Sequence, useCurrentFrame } from "remotion";
import { ramp } from "../../components/motion";
import { Title } from "../Title";
import { DISPLAY } from "../../components/Type";
import { FONT, INK } from "../../theme";

/**
 * THE WALL — what a hundred seconds leaves out. Twenty-four things the film
 * never mentions, each one a documented page of the product (the docs'
 * own titles, under website/src/content/docs/docs), cascading in while the
 * line names the first few. Nothing here is a plan or a slogan; every
 * entry has a page.
 *
 * It sits below Studio, the last stop before the pull-back, so "that's the
 * short version" is said with the whole desk about to recede behind it.
 * The grid stops at x 1520: the presenter's corner stays clear.
 */
const ITEMS: [string, string][] = [
    ["Realtime subscriptions", "every collection, over the wire you choose"],
    ["One isomorphic SDK", "the same shape on the server, in the browser, in an agent"],
    ["Live schema editing", "a visual collection editor that writes your TypeScript"],
    ["Offline & local-first sync", "reads and writes that survive the connection"],
    ["File storage", "local or any S3, uploads on any field"],
    ["Custom functions", "your code, in the same process or split out"],
    ["Cron jobs", "declared next to the collections they touch"],
    ["Background jobs", "queued work with retries and a log"],
    ["Full-text search", "and aggregates, from the SDK"],
    ["Entity history", "who changed what, on every record"],
    ["Database branching", "a branch of the data for every branch of the code"],
    ["Hooks", "before and after every write"],
    ["Indexes", "declared with the collection, owned by name"],
    ["Multiple databases", "and MongoDB, beside Postgres"],
    ["Auth adapters & API keys", "email, OAuth, keys with permissions on them"],
    ["REST API & OpenAPI", "generated, documented, with Swagger"],
    ["Soft delete", "one condition, applied on every read path"],
    ["Field-level access", "who can read which column"],
    ["Validation & conditions", "declared once, enforced everywhere"],
    ["Import & export", "CSV and JSON, in and out of the panel"],
    ["Translations", "the panel and your content, in your languages"],
    ["Custom fields, views & actions", "the panel is yours to extend"],
    ["MCP server & agent skills", "the same permissions, for agents"],
    ["Kubernetes & every cloud", "AWS, GCP, Azure, Fly, Railway, Hetzner"],
];

const COLS = 3;
const COL_W = 440;
const ROW_H = 70;

export const More: React.FC<{ x: number; y: number; at: number }> = ({ x, y, at }) => (
    <div style={{ position: "absolute", left: x, top: y, width: 1920, height: 1080 }}>
        <Title x={200} y={150} at={at} eyebrow="And there's more" lines={["That's the short version."]} size={DISPLAY.split} />
        <Sequence from={at} layout="none">
            <Wall />
        </Sequence>
    </div>
);

const Wall: React.FC = () => {
    const frame = useCurrentFrame();
    return (
        <div style={{ position: "absolute", left: 200, top: 356, width: COLS * COL_W }}>
            {ITEMS.map(([name, note], i) => {
                const col = i % COLS;
                const row = Math.floor(i / COLS);
                /* Down each column, column by column: the eye reads the wall
                   the way the cascade fills it. */
                const order = col * (ITEMS.length / COLS) + row;
                const t = ramp(frame, 16 + order * 4, 14);
                return (
                    <div
                        key={name}
                        style={{
                            position: "absolute",
                            left: col * COL_W,
                            top: row * ROW_H,
                            width: COL_W - 32,
                            opacity: t,
                            transform: `translateY(${(1 - t) * 8}px)`,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <span style={{ width: 6, height: 6, borderRadius: 999, background: INK.copy, flexShrink: 0 }} />
                            <span style={{ fontFamily: FONT.body, fontSize: 21, fontWeight: 600, color: INK.high, letterSpacing: "-0.01em" }}>
                                {name}
                            </span>
                        </div>
                        <div style={{ marginLeft: 18, marginTop: 3, fontFamily: FONT.body, fontSize: 15, color: INK.muted, lineHeight: 1.3 }}>
                            {note}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

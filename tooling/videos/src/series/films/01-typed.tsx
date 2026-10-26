import React from "react";
import { useCurrentFrame } from "remotion";
import { ENTER, ramp } from "../../components/motion";
import { CHROMA, FONT, INK, SURFACE } from "../../theme";
import { At, checkFilm, Editor as KitEditor, Headline, lines, Log, Prompt, useBody, useCue, useStage, Window, type FilmSpec } from "../kit";

/** The kit's editor, with this film's tab colour. */
const Editor: React.FC<React.ComponentProps<typeof KitEditor>> = (p) => <KitEditor accent={ACCENT} {...p} />;

/**
 * 01 — TYPED, END TO END.
 *
 * One collection file; the generator writes the client's types from it and
 * `rebase dev` keeps them current; the editor checks every query; a typo is a
 * compile error; server code gets the same typed accessors.
 *
 * Every line on screen is the product's own: the collection is an excerpt of
 * the CLI template's posts.ts; the generator's lines are generate_sdk.ts's;
 * the error is what tsc printed against a generated Database
 * (tests/e2e/baas-typecheck): TS2551, "Property 'post' does not exist on
 * type 'TypedDataLayer<Database>'. Did you mean 'posts'?".
 *
 * Its look: an editor — tabs, line numbers, a completion list, a squiggle.
 */

const ACCENT = CHROMA.cyan;

const SCRIPT = lines([
    ["hook", "What if your editor knew your database as well as you do?"],
    ["schema", "In Rebase, a collection file describes each table once."],
    ["generate", "From it, Rebase writes the types for your client, and keeps them current while you work."],
    ["query", "So your editor checks every query as you write it."],
    ["typo", "A typo is a red line in your editor, not an error in production."],
    ["server", "Your server code gets the same typed API, so the backend and the frontend agree."],
    ["close", "Rebase is open source. Point it at your Postgres, and your types come with it."],
]);

const POSTS = `const postsCollection = defineCollection({
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        title: { type: "string", validation: { required: true } },
        status: {
            type: "string",
            enum: [{ id: "draft" }, { id: "review" }, { id: "published" }],
        },
    },
});`;

/** The same excerpt for the tall frame's narrower editor: the enum one id
 *  a line, so nothing runs off the window. */
const POSTS_TALL = `const postsCollection = defineCollection({
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        title: { type: "string",
                 validation: { required: true } },
        status: {
            type: "string",
            enum: [{ id: "draft" },
                   { id: "review" },
                   { id: "published" }],
        },
    },
});`;

const QUERY = `const { data } = await client.data.posts.find({
    where: { status: ["==", "published"] },
    limit: 10,
});`;

const SERVER = `import { defineFunction } from "@rebasepro/server/functions";
import type { Database } from "../generated/sdk/database.types";

export default defineFunction<Database>((app, { rebase }) => {
    app.get("/latest", async (c) => {
        const { data } = await rebase.dataAsAdmin.posts.find({ limit: 5 });
        return c.json(data);
    });
});`;

/* ── scenes ─────────────────────────────────────────────────────────── */

const Schema: React.FC = () => {
    const { x, y, w, format } = useBody(1);
    const tall = format === "tall";
    return (
        <>
            <Headline text="Describe each table once." accent={ACCENT} mark={["once."]} />
            <At x={x} y={y} w={tall ? w : 1180}>
                <Editor file="config/collections/posts.ts · excerpt" code={tall ? POSTS_TALL : POSTS} size={tall ? 23 : 25} step={1.5} />
            </At>
        </>
    );
};

const Generate: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(format2(useStage().format));
    const tall = format === "tall";
    const t = 8 + "rebase generate-sdk".length * 0.6 + 8;
    const kept = useCue({ line: "generate", word: "current", plus: -6 }) ?? 9999;
    return (
        <>
            <Headline text="Rebase writes the types." accent={ACCENT} mark={["types."]} />
            <At x={x} y={y} w={tall ? w : 1240}>
                <Window title="zsh">
                    <Prompt command="rebase generate-sdk" at={8} size={tall ? 27 : 30} rate={0.6} />
                    <Log
                        size={tall ? 23 : 26}
                        lines={[
                            { text: "  🔧 Rebase SDK Generator", at: t, color: INK.high },
                            { text: "  → Loading collection definitions...", at: t + 6, color: ACCENT },
                            { text: "  ✓ Found 4 collection(s): posts, authors, tags, users", at: t + 14, color: "#34D399" },
                            { text: "  → Generating SDK files...", at: t + 20, color: ACCENT },
                            { text: "  ✓ SDK generated successfully!", at: t + 30, color: "#34D399" },
                        ]}
                    />
                </Window>
                <div style={{ marginTop: 26, display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap", opacity: ramp(frame, kept, 14) }}>
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 25 : 28, color: INK.high, padding: "10px 18px", borderRadius: 9, border: `2px solid ${ACCENT}` }}>
                        generated/sdk/database.types.ts
                    </span>
                    <span style={{ fontFamily: FONT.body, fontSize: tall ? 25 : 28, color: INK.copy }}>regenerated on every save by rebase dev</span>
                </div>
            </At>
        </>
    );
};

function format2(f: "wide" | "tall"): number {
    return f === "tall" ? 2 : 1;
}

/** The completion list after `client.data.` — the accessors are the
 *  collections, because the client is typed with the generated Database. */
const Query: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(format2(useStage().format));
    const tall = format === "tall";
    const size = tall ? 24 : 28;
    const menu = 26;
    const pick = 58;
    const m = ramp(frame, menu, 8, ENTER) * (1 - ramp(frame, pick, 6));
    return (
        <>
            <Headline text="Your editor checks every query." accent={ACCENT} mark={["every"]} />
            <At x={x} y={y} w={tall ? w : 1240}>
                <Editor file="src/posts.ts" code={QUERY} size={size} at={8} step={3}>
                    {m > 0.01 && (
                        <div
                            style={{
                                position: "absolute",
                                left: size * 21.3,
                                top: size * 1.65,
                                minWidth: size * 9,
                                background: SURFACE.raised,
                                border: `1px solid ${SURFACE.hairlineStrong}`,
                                borderRadius: 8,
                                padding: "6px 0",
                                fontFamily: FONT.mono,
                                fontSize: size * 0.9,
                                opacity: m,
                            }}
                        >
                            {["authors", "posts", "tags", "users"].map((c) => (
                                <div key={c} style={{ padding: "4px 14px", color: c === "posts" ? INK.high : INK.copy, background: c === "posts" ? "rgba(54,204,214,0.18)" : undefined }}>
                                    <span style={{ color: ACCENT, marginRight: 10 }}>◆</span>
                                    {c}
                                </div>
                            ))}
                        </div>
                    )}
                </Editor>
            </At>
        </>
    );
};

const Typo: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(format2(useStage().format));
    const tall = format === "tall";
    const size = tall ? 24 : 28;
    const red = useCue({ line: "typo", word: "red", plus: -6 }) ?? 9999;
    const r = ramp(frame, red, 10);
    const code = `const { data } = await client.data.post.find({ limit: 10 });`;
    return (
        <>
            <Headline text="A typo is a red line, not an outage." accent={CHROMA.coral} mark={["red", "line,"]} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <Editor file="src/posts.ts" code={code} size={size} at={6}>
                    <div
                        style={{
                            position: "absolute",
                            left: size * 0.6 * 35,
                            top: size * 1.4,
                            width: size * 0.6 * 4,
                            height: 4,
                            backgroundImage: `radial-gradient(circle at 2px 2px, ${CHROMA.coral} 1.6px, transparent 2px)`,
                            backgroundSize: "7px 4px",
                            opacity: r,
                        }}
                    />
                </Editor>
                <div
                    style={{
                        marginTop: 18,
                        padding: "16px 22px",
                        borderRadius: 9,
                        background: SURFACE.raised,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        fontFamily: FONT.mono,
                        fontSize: tall ? 22 : 25,
                        lineHeight: 1.55,
                        color: INK.high,
                        opacity: r,
                        transform: r < 1 ? `translateY(${(1 - r) * 10}px)` : undefined,
                    }}
                >
                    <span style={{ color: CHROMA.coral }}>error TS2551:</span> Property 'post' does not exist on type 'TypedDataLayer&lt;Database&gt;'.{" "}
                    <span style={{ color: ACCENT }}>Did you mean 'posts'?</span>
                </div>
            </At>
        </>
    );
};

const Server: React.FC = () => {
    const { x, y, w, format } = useBody(format2(useStage().format));
    const tall = format === "tall";
    return (
        <>
            <Headline text="The server speaks the same types." accent={ACCENT} mark={["same"]} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <Editor file="backend/functions/latest.ts" code={SERVER} size={tall ? 17 : 23} at={6} step={2} />
            </At>
        </>
    );
};

const Close: React.FC = () => null;

export const TYPED: FilmSpec = checkFilm({
    id: "typed",
    number: 1,
    title: "Typed, end to end",
    accent: ACCENT,
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 4 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "schema", at: { line: "schema", plus: 2 }, render: Schema, roll: 0.22 },
        { id: "generate", at: { line: "generate", plus: 2 }, render: Generate, roll: 0.64 },
        { id: "query", at: { line: "query", plus: 2 }, render: Query, roll: 0.34 },
        { id: "typo", at: { line: "typo", plus: 2 }, render: Typo, roll: 0.72 },
        { id: "server", at: { line: "server", plus: 2 }, render: Server, roll: 0.16 },
        { id: "close", at: { line: "close", plus: 0 }, render: Close, roll: 0.46 },
    ],
});

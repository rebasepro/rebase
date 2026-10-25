import React from "react";
import { useCurrentFrame } from "remotion";
import { Frame } from "../../components/Frame";
import { Code } from "../../components/Code";
import { Terminal } from "../../components/Terminal";
import { ENTER, ramp } from "../../components/motion";
import { CHROMA, FONT, GROUND, INK } from "../../theme";
import { At, checkFilm, Headline, Label, useBody, useCue, useStage, type FilmSpec } from "../kit";

/**
 * 03 — BUILT FOR AGENTS.
 *
 * The agent is a first-class caller, not an integration: an MCP server the
 * scaffold already wires up, keys that hold exactly the scopes they are
 * given, a refusal that names the missing scope, destructive tools that will
 * not touch a remote backend by default, and skills that teach the agent the
 * framework. Every string on screen is the product's own (packages/mcp,
 * packages/server/src/api/rest/api-generator.ts, docs/ai/mcp.md,
 * packages/types/src/types/scopes.ts, tooling/rebase-agent-skills).
 *
 * Its look: a terminal on the deep violet field — the agent's world is text.
 */

/* Yellow: the one hue that still reads as a highlight on the violet field. */
const ACCENT = CHROMA.yellow;

const SCRIPT = [
    { id: "hook", at: 15, words: "Your next teammate is an agent. So what is it allowed to touch?".split(" ") },
    { id: "mcp", at: 150, words: "Rebase ships an MCP server. One file connects your agent to your backend, with forty-four tools for data, schema, branches, functions and cron.".split(" ") },
    { id: "key", at: 400, words: "You give it a key that holds exactly what it needs, like reading articles.".split(" ") },
    { id: "refuse", at: 560, words: "When it tries to write, the API refuses, and names the permission it is missing.".split(" ") },
    { id: "guard", at: 740, words: "Its destructive tools refuse to touch a remote backend unless you switch that on.".split(" ") },
    { id: "skills", at: 905, words: "Twenty-three skills teach it how Rebase works, so the code it writes fits your project.".split(" ") },
    { id: "close", at: 1085, words: "Rebase is open source. Your agents get the same API and the same rules as everyone else.".split(" ") },
];

const MCP_JSON = `{
  "mcpServers": {
    "rebase": {
      "command": "pnpm",
      "args": ["exec", "rebase-mcp"],
      "env": { "REBASE_PROJECT_DIR": "." }
    }
  }
}`;

/** Nineteen of the local server's forty-four tools, by their own names. */
const TOOLS = [
    "list_documents", "get_document", "create_document", "update_document", "delete_document",
    "rebase_schema_plan", "rebase_schema_generate", "rebase_db_push", "rebase_db_migrate",
    "rebase_schema_introspect", "rebase_doctor", "rebase_db_branch_create", "rebase_db_branch_diff",
    "list_users", "create_user", "invoke_function", "cron_trigger_job", "storage_list_objects", "rebase_dev_start",
];

const REFUSAL = `{ "error": {
    "code": "SCOPE_MISSING",
    "message": "This credential does not hold
      \\"data:write\\" for collection \\"articles\\".
      A key needs \\"data:write\\" or
      \\"data:write:articles\\".",
    "details": {
      "requiredScope": "data:write:articles" } } }`;

const SKILLS = [
    "rebase-basics", "rebase-collections", "rebase-security", "rebase-sdk", "rebase-api", "rebase-auth",
    "rebase-realtime", "rebase-storage", "rebase-custom-functions", "rebase-cron-jobs", "rebase-webhooks",
    "rebase-email", "rebase-entity-history", "rebase-studio", "rebase-admin", "rebase-custom-views",
    "rebase-customize-admin", "rebase-ui-components", "rebase-design-language", "rebase-deployment",
    "rebase-backend-postgres", "rebase-local-env-setup", "rebase-cloud",
];

/* ── scenes ─────────────────────────────────────────────────────────── */

const Mcp: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(1);
    const tall = format === "tall";
    const tools = useCue({ line: "mcp", word: "forty-four", plus: -6 }) ?? 9999;
    return (
        <>
            <Headline text="One file connects your agent." accent={ACCENT} mark={["agent."]} />
            <At x={x} y={y} w={tall ? w : 680}>
                <Label at={6} color={ACCENT} size={tall ? 20 : 18}>.mcp.json · written by rebase init</Label>
                <div style={{ height: 14 }} />
                <Frame surface="well" delay={4} bodyStyle={{ padding: "22px 26px" }}>
                    <Code code={MCP_JSON} size={tall ? 28 : 28} delay={10} step={2} />
                </Frame>
            </At>
            <At x={tall ? x : x + 720} y={tall ? y + 460 : y} w={tall ? w : 680}>
                <Label at={tools} size={tall ? 20 : 18}>44 tools · nineteen of them</Label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
                    {TOOLS.slice(0, tall ? 12 : 19).map((t, i) => {
                        const o = ramp(frame, tools + i * 2, 10, ENTER);
                        return (
                            <span
                                key={t}
                                style={{
                                    fontFamily: FONT.mono,
                                    fontSize: tall ? 26 : 25,
                                    padding: "8px 14px",
                                    borderRadius: 6,
                                    background: "rgba(255,255,255,0.08)",
                                    color: t.startsWith("delete") ? CHROMA.coral : INK.high,
                                    opacity: o,
                                    transform: `translateY(${(1 - o) * 8}px)`,
                                }}
                            >
                                {t}
                            </span>
                        );
                    })}
                </div>
            </At>
        </>
    );
};

const Key: React.FC = () => {
    const frame = useCurrentFrame();
    const { x, y, w, format } = useBody(tall2(useStage().format));
    const tall = format === "tall";
    const scope = useCue({ line: "key", word: "reading", plus: -4 }) ?? 9999;
    const s = ramp(frame, scope, 16, ENTER);
    return (
        <>
            <Headline text="A key that holds exactly one permission." accent={ACCENT} mark={["one"]} />
            <At x={x} y={y} w={w}>
                <Frame title="zsh" surface="well" delay={8} bodyStyle={{ padding: "22px 30px" }}>
                    <Terminal command={`rebase api-keys create -n "Support agent" --scopes data:read:articles`} delay={16} rate={0.5} size={tall ? 30 : 32} />
                </Frame>
            </At>
            <At x={x} y={y + (tall ? 290 : 190)}>
                <div style={{ display: "flex", flexDirection: tall ? "column" : "row", gap: tall ? 14 : 24, alignItems: tall ? "flex-start" : "center", opacity: s, transform: `translateY(${(1 - s) * 14}px)` }}>
                    <span style={{ fontFamily: FONT.mono, fontSize: tall ? 46 : 52, color: INK.high, padding: "16px 26px", borderRadius: 12, border: `2px solid ${ACCENT}` }}>
                        data:read:articles
                    </span>
                    <span style={{ fontFamily: FONT.display, fontWeight: 500, fontSize: tall ? 38 : 40, color: INK.copy }}>and nothing else.</span>
                </div>
            </At>
        </>
    );
};

/** Two lines of headline in the tall frame, one in the wide. */
function tall2(format: "wide" | "tall"): number {
    return format === "tall" ? 2 : 1;
}

const Refuse: React.FC = () => {
    const frame = useCurrentFrame();
    const format = useStage().format;
    const { x, y, w } = useBody(tall2(format));
    const tall = format === "tall";
    const answer = useCue({ line: "refuse", word: "refuses,", plus: -6 }) ?? 9999;
    return (
        <>
            <Headline text="It tries to write. The API says no." accent={CHROMA.coral} mark={["no."]} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <Frame title="agent · mcp" surface="well" delay={0} bodyStyle={{ padding: "22px 28px" }}>
                    <div style={{ fontFamily: FONT.mono, fontSize: tall ? 27 : 29, lineHeight: 1.55 }}>
                        <div style={{ opacity: ramp(frame, 8, 10), color: INK.high }}>
                            <span style={{ color: ACCENT, marginRight: 14 }}>agent ›</span>update_document articles
                        </div>
                        <div style={{ marginTop: 14, color: CHROMA.coral, opacity: ramp(frame, answer, 8) }}>← 403 SCOPE_MISSING</div>
                        <div style={{ marginTop: 8, color: INK.copy, opacity: ramp(frame, answer + 8, 12), whiteSpace: "normal" }}>
                            This credential does not hold "data:write" for collection "articles". A key needs "data:write" or
                            "data:write:articles".
                        </div>
                    </div>
                </Frame>
            </At>
        </>
    );
};

const Guard: React.FC = () => {
    const frame = useCurrentFrame();
    const format = useStage().format;
    const { x, y, w } = useBody(tall2(format));
    const tall = format === "tall";
    const err = useCue({ line: "guard", word: "remote", plus: -4 }) ?? 9999;
    return (
        <>
            <Headline text="Not on production. Not by accident." accent={ACCENT} mark={["accident."]} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <Frame title="agent · mcp" surface="well" delay={6} bodyStyle={{ padding: "22px 28px" }}>
                    <div style={{ fontFamily: FONT.mono, fontSize: tall ? 27 : 29, lineHeight: 1.55 }}>
                        <div style={{ color: INK.high, opacity: ramp(frame, 12, 10) }}>
                            <span style={{ color: ACCENT, marginRight: 14 }}>agent ›</span>delete_document orders
                        </div>
                        <div style={{ color: CHROMA.coral, marginTop: 14, opacity: ramp(frame, err, 10) }}>
                            Error: Refusing to run "delete_document": project "default" points at https://api.example.com/, which is not local.
                        </div>
                    </div>
                </Frame>
            </At>
        </>
    );
};

const Skills: React.FC = () => {
    const frame = useCurrentFrame();
    const format = useStage().format;
    const { x, y, w } = useBody(tall2(format));
    const tall = format === "tall";
    const list = tall ? SKILLS.slice(0, 14) : SKILLS.slice(0, 18);
    return (
        <>
            <Headline text="Skills teach it the framework." accent={ACCENT} mark={["framework."]} />
            <At x={x} y={y} w={tall ? w : 1300}>
                <Frame title="zsh" surface="well" delay={0} bodyStyle={{ padding: "20px 28px" }}>
                    <Terminal command="rebase skills install --agent claude,cursor" delay={8} rate={0.55} size={tall ? 28 : 30} />
                </Frame>
                <div style={{ display: "grid", gridTemplateColumns: tall ? "1fr 1fr" : "1fr 1fr 1fr", gap: "10px 28px", marginTop: 26 }}>
                    {list.map((sk, i) => (
                        <div key={sk} style={{ fontFamily: FONT.mono, fontSize: tall ? 26 : 26, color: INK.high, opacity: ramp(frame, 36 + i * 2.4, 10), display: "flex", gap: 12 }}>
                            <span style={{ color: "#34D399" }}>✔</span>
                            {sk}
                        </div>
                    ))}
                </div>
                <div style={{ marginTop: 18, fontFamily: FONT.mono, fontSize: 22, color: INK.copy, opacity: ramp(frame, 36 + list.length * 2.4 + 6, 10) }}>
                    + {SKILLS.length - list.length} more · 23 skills
                </div>
            </At>
        </>
    );
};

/** The close: the presenter's last line carries it; the end card is the kit's. */
const Close: React.FC = () => null;

export const AGENTS: FilmSpec = checkFilm({
    id: "agents",
    number: 3,
    title: "Built for agents",
    accent: ACCENT,
    script: SCRIPT,
    toCorner: { line: "hook", end: true, plus: 4 },
    close: { line: "close", plus: -2 },
    scenes: [
        { id: "mcp", at: { line: "mcp", plus: 2 }, render: Mcp, roll: 0.22, ground: GROUND.deep, reveal: 0.65 },
        { id: "key", at: { line: "key", plus: 2 }, render: Key, roll: 0.64, ground: GROUND.deep, reveal: 0.65 },
        { id: "refuse", at: { line: "refuse", plus: 2 }, render: Refuse, roll: 0.34, ground: GROUND.deep, reveal: 0.65 },
        { id: "guard", at: { line: "guard", plus: 2 }, render: Guard, roll: 0.72, ground: GROUND.deep, reveal: 0.65 },
        { id: "skills", at: { line: "skills", plus: 2 }, render: Skills, roll: 0.16, ground: GROUND.deep, reveal: 0.65 },
        { id: "close", at: { line: "close", plus: 0 }, render: Close, roll: 0.46 },
    ],
});

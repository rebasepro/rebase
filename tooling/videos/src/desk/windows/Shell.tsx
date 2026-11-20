import React from "react";
import { Sequence } from "remotion";
import { Frame } from "../../components/Frame";
import { Session } from "../../components/Terminal";
import type { OutputLine, Step } from "../../components/Terminal";

/**
 * OUR terminal, under the agent's — the spine of the story, and PROOF, NOT
 * PROCEDURE. Three commands, each with the few lines of its output that
 * carry the point: `init --introspect` finds nine tables and writes, for
 * each, its table in `backend/schema` and its panel layout in
 * `frontend/src/cms` (the two halves since 0.31); `db push` applies the
 * policies; `dev` puts the admin app and the API up. A version that showed the whole session — pnpm's banners, `cd`,
 * "Next steps:" — was a tutorial, and the film is not one.
 *
 * The terminal draws its own ✓ before an "ok" line, so the tool's own ✓
 * and indent are not repeated in the text.
 *
 * Every line is one the tools print, captured 2026-11-20 by running this
 * CLI's `schema introspect` (what `init --introspect --install` runs) and
 * `db push` against a Postgres 18 database with these nine tables; `dev`'s
 * lines are dev.ts's. The file list is the real one for these nine tables. Lines are left out, never made up. The project lives at
 * {@link ROOT}: introspection prints each file's absolute path, and `dev`
 * derives both ports from that path (getProjectPort, getProjectFrontendPort),
 * so the paths and the ports below are what that directory gets.
 *
 * The window is a fixed height and SCROLLS: older lines leave off the top
 * as new ones print, the way a shell behaves.
 */

const blank = (at: number): OutputLine => ({ text: "", tone: "plain", at });

const FILES = ["authors", "customers", "order_items", "orders", "posts", "products", "tags", "tickets", "users"];

const ROOT = "/Users/you/work/acme";

/* The three commands, each with the few lines of its output that carry
   the point. Where each is typed is the film's business, not the shell's:
   `init` chains from the window's own start; push and dev are pinned to
   the narration (timeline.ts) and do not exist until their moment. */
const INIT: Step = {
    command: "rebase init acme --database-url $DATABASE_URL --introspect --install",
    output: [
        { text: "Introspecting schema 'public'...", tone: "muted", at: 4 },
        { text: "Found 9 tables.", tone: "accent", at: 10 },
        /* Each table, then its panel layout: the order the tool prints. */
        ...FILES.flatMap((f, i): OutputLine[] => [
            { text: `${ROOT}/backend/schema/${f}.ts`, tone: "ok", at: 16 + i * 3 },
            { text: `${ROOT}/frontend/src/cms/${f}.tsx`, tone: "ok", at: 17.5 + i * 3 },
        ]),
        blank(44),
        { text: "Introspected 9 tables — generated 9 table(s).", tone: "ok", at: 48 },
    ],
};

const PUSH: Step = {
    command: "rebase db push",
    output: [
        { text: "  Step 3/3: Applying RLS policies to database...", tone: "muted", at: 10 },
        blank(12),
        { text: "RLS policies applied successfully.", tone: "ok", at: 22 },
    ],
};

const DEV: Step = {
    command: "rebase dev",
    output: [
        blank(2),
        { text: "✦ Rebase is ready!", tone: "plain", at: 18 },
        { text: "➜ Admin: http://localhost:5255", tone: "plain", at: 22 },
        { text: "➜ API:   http://localhost:3297", tone: "plain", at: 26 },
    ],
};

export const Shell: React.FC<{
    x: number;
    y: number;
    w: number;
    at: number;
    /** Absolute frame `rebase db push` is typed; null until it is due. */
    pushAt: number | null;
    /** Absolute frame `rebase dev` is typed; null until it is due. */
    devAt: number | null;
}> = ({ x, y, w, at, pushAt, devAt }) => {
    const steps: Step[] = [INIT];
    if (pushAt !== null) steps.push({ ...PUSH, at: pushAt - at });
    if (devAt !== null) steps.push({ ...DEV, at: devAt - at });
    return (
        <div style={{ position: "absolute", left: x, top: y, width: w }}>
            <Sequence from={at} layout="none">
                <Frame title="zsh" surface="well" delay={0} bodyStyle={{ padding: "22px 34px 24px" }}>
                    <Session delay={12} size={19} lineHeight={1.6} rate={0.55} scroll={330} steps={steps} />
                </Frame>
            </Sequence>
        </div>
    );
};

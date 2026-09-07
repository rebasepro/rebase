import React from "react";
import { Sequence } from "remotion";
import { Frame } from "../../components/Frame";
import { Session } from "../../components/Terminal";
import type { OutputLine } from "../../components/Terminal";

/**
 * OUR terminal, under the agent's — the spine of the story.
 *
 * Four commands: `init` points Rebase at the database the agent left behind
 * and writes a collection file per table; `cd` into what it made; `db push`
 * applies the rule as a policy; `dev` runs it. EVERY LINE IS WHAT THE TOOLS
 * PRINT, in the order they print it: init.ts and introspect-db.ts for the
 * first command (the file list is the real one for these nine tables),
 * pnpm's own script banner and server-postgres/cli.ts for push, dev.ts for
 * the ready banner. Lines are left out — pnpm's install log, the Swagger
 * line — never made up.
 *
 * The window is a fixed height and SCROLLS: older lines leave off the top
 * as new ones print, the way a shell behaves.
 */

const blank = (at: number): OutputLine => ({ text: "", tone: "plain", at });

const FILES = ["authors", "customers", "order_items", "orders", "posts", "products", "tags", "tickets", "users"];

const INIT: OutputLine[] = [
    { text: "  Copying project files...", tone: "muted", at: 4 },
    { text: "  Using the blank template: collections will come from your database.", tone: "muted", at: 8 },
    blank(12),
    { text: "  Installing dependencies with pnpm...", tone: "muted", at: 14 },
    blank(16),
    { text: "Progress: resolved 418, reused 418, downloaded 0, added 418, done", tone: "plain", at: 40 },
    { text: "Done in 4.2s", tone: "plain", at: 44 },
    blank(48),
    { text: "  Introspecting database and generating collections...", tone: "muted", at: 52 },
    blank(54),
    { text: "Connected to database: localhost:5432", tone: "muted", at: 58 },
    { text: "Introspecting schema 'public'...", tone: "muted", at: 62 },
    { text: "Found 9 tables.", tone: "accent", at: 70 },
    { text: "  7 entities, 0 join tables (folded into relations), 0 code lists, 2 owned by another table (hidden from navigation).", tone: "muted", at: 74 },
    { text: "Skipping data inference (non-interactive run; pass --data-inference to enable).", tone: "muted", at: 78 },
    ...FILES.map((f, i) => ({ text: `../config/collections/${f}.ts`, tone: "ok" as const, at: 84 + i * 3 })),
    { text: "../config/collections/index.ts", tone: "ok", at: 114 },
    blank(116),
    { text: "Introspected 9 tables — generated 9 collection(s).", tone: "ok", at: 120 },
    { text: "  Review the generated files in ../config/collections and customize properties as needed.", tone: "muted", at: 122 },
    { text: "  Database successfully introspected!", tone: "green", at: 128 },
    blank(132),
    { text: "Project acme created successfully!", tone: "ok", at: 136 },
    blank(138),
    { text: "Next steps:", tone: "plain", at: 142 },
    blank(144),
    { text: "  cd acme", tone: "accent", at: 146 },
    blank(148),
    { text: "  # Database has been introspected & collections generated!", tone: "muted", at: 150 },
    { text: "  # Start the development server (frontend + backend):", tone: "muted", at: 152 },
    { text: "  pnpm run dev", tone: "accent", at: 156 },
];

export const Shell: React.FC<{
    x: number;
    y: number;
    w: number;
    at: number;
    /** Absolute frame `cd acme` is typed. */
    cdAt: number;
    /** Absolute frame `pnpm run db:push` is typed. */
    pushAt: number;
    /** Absolute frame `pnpm run dev` is typed. */
    devAt: number;
}> = ({ x, y, w, at, cdAt, pushAt, devAt }) => (
    <div style={{ position: "absolute", left: x, top: y, width: w }}>
        <Sequence from={at} layout="none">
            <Frame title="zsh" delay={0} bodyStyle={{ padding: "22px 34px 24px" }}>
                <Session
                    delay={12}
                    size={19}
                    lineHeight={1.6}
                    rate={0.55}
                    scroll={330}
                    steps={[
                        {
                            command: "pnpm dlx @rebasepro/cli init acme --database-url $DATABASE_URL --introspect --install",
                            output: INIT,
                        },
                        { command: "cd acme", at: cdAt - at, output: [] },
                        {
                            command: "pnpm run db:push",
                            at: pushAt - at,
                            output: [
                                blank(2),
                                { text: "> acme@0.1.0 db:push /home/dev/acme", tone: "muted", at: 4 },
                                { text: "> rebase db push", tone: "muted", at: 6 },
                                blank(8),
                                { text: "  Step 1/3: Generating Drizzle schema & Postgres DDL from collections...", tone: "muted", at: 10 },
                                { text: "  Step 2/3: Pushing schema to database with Atlas...", tone: "muted", at: 20 },
                                { text: "  Step 3/3: Applying RLS policies to database...", tone: "muted", at: 30 },
                                blank(32),
                                { text: "  RLS policies applied successfully.", tone: "ok", at: 42 },
                            ],
                        },
                        {
                            command: "pnpm run dev",
                            at: devAt - at,
                            output: [
                                blank(2),
                                { text: "> acme@0.1.0 dev /home/dev/acme", tone: "muted", at: 4 },
                                { text: "> rebase dev", tone: "muted", at: 6 },
                                blank(8),
                                { text: "✦ Rebase Admin App is ready!", tone: "plain", at: 18 },
                                { text: "➜ Admin:  http://localhost:5173", tone: "plain", at: 22 },
                                { text: "➜ API:    http://localhost:3001", tone: "plain", at: 26 },
                                blank(28),
                                { text: "First login: the first account to register becomes admin", tone: "muted", at: 34 },
                            ],
                        },
                    ]}
                />
            </Frame>
        </Sequence>
    </div>
);

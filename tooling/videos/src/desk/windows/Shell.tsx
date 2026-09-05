import React from "react";
import { Sequence } from "remotion";
import { Frame } from "../../components/Frame";
import { Session } from "../../components/Terminal";

/**
 * OUR terminal, under the agent's — the spine of the story.
 *
 * Three commands across two beats, with the rule written between them:
 * `init --introspect` points Rebase at the database the agent left behind
 * and writes a collection file per table; `db push` applies the rule as a
 * policy; `dev` runs it. Every line is what the tools print (`init.ts`,
 * `introspect-db.ts`, `server-postgres/cli.ts` — "Step 3/3: Applying RLS
 * policies", "✓ RLS policies applied successfully."). The one edit is an
 * ellipsis in place of six of the nine generated files.
 *
 * The window is a fixed height and SCROLLS: older lines leave off the top
 * as new ones print, the way a shell behaves, so the same window can carry
 * sixteen lines of session through a frame that has room for ten.
 */
export const Shell: React.FC<{
    x: number;
    y: number;
    w: number;
    at: number;
    /** Absolute frame `rebase db push` is typed. */
    pushAt: number;
    /** Absolute frame `rebase dev` is typed. */
    devAt: number;
}> = ({ x, y, w, at, pushAt, devAt }) => (
    <div style={{ position: "absolute", left: x, top: y, width: w }}>
        <Sequence from={at} layout="none">
            <Frame title="zsh · ~/acme" delay={0} bodyStyle={{ padding: "22px 34px 24px" }}>
                <Session
                    delay={12}
                    size={19}
                    lineHeight={1.6}
                    rate={0.55}
                    scroll={330}
                    steps={[
                        {
                            command: "pnpm dlx @rebasepro/cli init --database-url $DATABASE_URL --introspect",
                            output: [
                                { text: "Introspecting schema 'public'...", tone: "muted", at: 10 },
                                { text: "Found 9 tables.", tone: "accent", at: 22 },
                                { text: "collections/customers.ts", tone: "ok", at: 30 },
                                { text: "collections/orders.ts", tone: "ok", at: 36 },
                                { text: "collections/tickets.ts", tone: "ok", at: 42 },
                                { text: "\u00a0\u00a0⋯ 6 more", tone: "muted", at: 48 },
                                { text: "Project acme created successfully!", tone: "ok", at: 60 },
                            ],
                        },
                        {
                            command: "rebase db push",
                            at: pushAt - at,
                            output: [
                                { text: "Step 1/3: Generating Drizzle schema & Postgres DDL from collections...", tone: "muted", at: 8 },
                                { text: "Step 2/3: Pushing schema to database with Atlas...", tone: "muted", at: 18 },
                                { text: "Step 3/3: Applying RLS policies to database...", tone: "muted", at: 28 },
                                { text: "RLS policies applied successfully.", tone: "ok", at: 40 },
                            ],
                        },
                        {
                            command: "rebase dev",
                            at: devAt - at,
                            output: [{ text: "API and realtime on :3001, panel on :5173.", tone: "ok", at: 12 }],
                        },
                    ]}
                />
            </Frame>
        </Sequence>
    </div>
);

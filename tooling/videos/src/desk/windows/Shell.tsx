import React from "react";
import { Sequence } from "remotion";
import { Frame } from "../../components/Frame";
import { Session } from "../../components/Terminal";
import type { OutputLine } from "../../components/Terminal";

/**
 * OUR terminal, under the agent's — the spine of the story, and PROOF, NOT
 * PROCEDURE. Three commands, each with the few lines of its output that
 * carry the point: `init --introspect` finds nine tables and writes nine
 * files; `db push` applies the policies; `dev` puts the admin app and the
 * API up. A version that showed the whole session — pnpm's banners, `cd`,
 * "Next steps:" — was a tutorial, and the film is not one.
 *
 * Every line is one the tools print (init.ts, introspect-db.ts,
 * server-postgres/cli.ts, dev.ts), and the file list is the real one for
 * these nine tables. Lines are left out, never made up.
 *
 * The window is a fixed height and SCROLLS: older lines leave off the top
 * as new ones print, the way a shell behaves.
 */

const blank = (at: number): OutputLine => ({ text: "", tone: "plain", at });

const FILES = ["authors", "customers", "order_items", "orders", "posts", "products", "tags", "tickets", "users"];

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
            <Frame title="zsh" surface="well" delay={0} bodyStyle={{ padding: "22px 34px 24px" }}>
                <Session
                    delay={12}
                    size={19}
                    lineHeight={1.6}
                    rate={0.55}
                    scroll={330}
                    steps={[
                        {
                            command: "rebase init acme --database-url $DATABASE_URL --introspect",
                            output: [
                                { text: "Introspecting schema 'public'...", tone: "muted", at: 4 },
                                { text: "Found 9 tables.", tone: "accent", at: 10 },
                                ...FILES.map((f, i) => ({ text: `../config/collections/${f}.ts`, tone: "ok" as const, at: 16 + i * 3 })),
                                blank(44),
                                { text: "Introspected 9 tables — generated 9 collection(s).", tone: "ok", at: 48 },
                            ],
                        },
                        {
                            command: "rebase db push",
                            at: pushAt - at,
                            output: [
                                { text: "  Step 3/3: Applying RLS policies to database...", tone: "muted", at: 10 },
                                blank(12),
                                { text: "  RLS policies applied successfully.", tone: "ok", at: 22 },
                            ],
                        },
                        {
                            command: "rebase dev",
                            at: devAt - at,
                            output: [
                                blank(2),
                                { text: "✦ Rebase Admin App is ready!", tone: "plain", at: 18 },
                                { text: "➜ Admin:  http://localhost:5173", tone: "plain", at: 22 },
                                { text: "➜ API:    http://localhost:3001", tone: "plain", at: 26 },
                            ],
                        },
                    ]}
                />
            </Frame>
        </Sequence>
    </div>
);

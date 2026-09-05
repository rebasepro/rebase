import React from "react";
import { Sequence } from "remotion";
import { Frame } from "../../components/Frame";
import { Session } from "../../components/Terminal";

/**
 * OUR terminal, under the agent's. Three commands, typed across two beats
 * with a minute of story between them: `init` and `db push` while the scan
 * is about to re-run, `dev` when the film comes back to say it is running.
 * Every line is the CLI page's own session, verbatim.
 */
export const Shell: React.FC<{
    x: number;
    y: number;
    w: number;
    at: number;
    /** Absolute frame `rebase dev` is typed. */
    devAt: number;
}> = ({ x, y, w, at, devAt }) => (
    <div style={{ position: "absolute", left: x, top: y, width: w }}>
        <Sequence from={at} layout="none">
            <Frame title="zsh · ~/acme" delay={0} bodyStyle={{ padding: "26px 34px 30px" }}>
                <Session
                    delay={14}
                    size={21}
                    rate={0.7}
                    steps={[
                        {
                            command: "pnpm dlx @rebasepro/cli init",
                            output: [
                                { text: "Initialized Rebase in current directory.", tone: "ok", at: 10 },
                                { text: "  backend/  frontend/  .env  rebase.config.ts", tone: "muted", at: 15 },
                            ],
                            pause: 8,
                        },
                        {
                            command: "rebase db push",
                            output: [
                                { text: "Schema pushed to database. Tables created.", tone: "ok", at: 12 },
                                { text: "Row-level security enabled on every collection.", tone: "ok", at: 22 },
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

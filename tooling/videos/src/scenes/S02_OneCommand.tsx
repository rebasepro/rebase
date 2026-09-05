import React from "react";
import { Scene, Stage } from "../components/Scene";
import { Chapter, DisplayLine, DISPLAY } from "../components/Type";
import { Frame } from "../components/Frame";
import { Session } from "../components/Terminal";

/**
 * 14 · THREE COMMANDS — 205 frames.
 *
 * The site's "first five minutes" is three commands, and the headline has
 * always said so: Init. Push. Run. The terminal beside it, until now, showed
 * ONE — `init` printing the output of all three, including a server it had
 * not started. The voiceover says "three commands" over that picture. Every
 * line here is now the CLI page's own session, verbatim (CliContent.astro):
 * scaffold, move the schema onto the database, start both halves. A demo
 * terminal that invents its own output is the fastest way to lose a
 * developer watching this, and one that contradicts its own headline is
 * faster still.
 */
export const S02_OneCommand: React.FC = () => (
    <Scene>
        <Stage>
            <div style={{ display: "flex", alignItems: "center", gap: 96 }}>
                <div style={{ width: 520, flexShrink: 0 }}>
                    <Chapter n="09" label="The first five minutes" delay={4} />
                    <div style={{ marginTop: 26 }}>
                        {/* `statement`, not `split`, even though a terminal sits
                            beside it. The tier is chosen by ROLE and these three
                            words ARE the slide — and optically the rule needs the
                            exception: its siblings at 56 ("Run the database from
                            the same app.") fill the 520 column, while three
                            one-word lines fill a third of it and read as a caption
                            next to a large terminal rather than as the headline. */}
                        <DisplayLine size={DISPLAY.statement} delay={8}>Init.</DisplayLine>
                        <DisplayLine size={DISPLAY.statement} delay={13}>Push.</DisplayLine>
                        <DisplayLine size={DISPLAY.statement} delay={18}>Run.</DisplayLine>
                    </div>
                </div>

                <Frame
                    title="zsh · ~/work"
                    delay={12}
                    style={{ flex: 1 }}
                    bodyStyle={{ padding: "30px 38px 34px" }}
                >
                    <Session
                        delay={22}
                        size={23}
                        rate={0.9}
                        steps={[
                            {
                                command: "pnpm dlx @rebasepro/cli init",
                                output: [
                                    { text: "Initialized Rebase in current directory.", tone: "ok", at: 12 },
                                    { text: "\u00a0\u00a0backend/  frontend/  .env  rebase.config.ts", tone: "muted", at: 18 },
                                ],
                                pause: 14,
                            },
                            {
                                command: "rebase db push",
                                output: [
                                    { text: "Schema pushed to database. Tables created.", tone: "ok", at: 14 },
                                    { text: "Row-level security enabled on every collection.", tone: "ok", at: 24 },
                                ],
                                pause: 14,
                            },
                            {
                                command: "rebase dev",
                                output: [
                                    { text: "API and realtime on :3001, panel on :5173.", tone: "ok", at: 14 },
                                ],
                            },
                        ]}
                    />
                </Frame>
            </div>
        </Stage>
    </Scene>
);

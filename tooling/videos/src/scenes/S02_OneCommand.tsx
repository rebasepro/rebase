import React from "react";
import { Scene, Stage } from "../components/Scene";
import { Chapter, DisplayLine, Lead, DISPLAY } from "../components/Type";
import { Frame } from "../components/Frame";
import { Terminal } from "../components/Terminal";

/**
 * 02 · ONE COMMAND — 175 frames.
 *
 * Act I of the three-act shape the whole site reuses: point it at Postgres,
 * and the APIs appear. The output lines are the real ones the CLI prints and
 * the ports are the real ports — a demo terminal that invents its own output
 * is the fastest way to lose a developer watching this.
 */
export const S02_OneCommand: React.FC = () => (
    <Scene>
        <Stage>
            <div style={{ display: "flex", alignItems: "center", gap: 96 }}>
                <div style={{ width: 520, flexShrink: 0 }}>
                    <Chapter n="01" label="The first five minutes" delay={4} />
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
                    <Lead delay={34} size={25} width={470} style={{ marginTop: 28 }}>
                        It reads your schema — tables, relations,
                        constraints — and starts serving it.
                    </Lead>
                </div>

                <Frame
                    title="zsh · ~/work"
                    delay={12}
                    style={{ flex: 1 }}
                    bodyStyle={{ padding: "34px 38px 40px" }}
                >
                    <Terminal
                        delay={22}
                        size={26}
                        command="pnpm dlx @rebasepro/cli init"
                        output={[
                            { text: "Initialized Rebase in current directory.", tone: "ok", at: 16 },
                            { text: "Schema pushed to database. Tables created.", tone: "ok", at: 30 },
                            { text: "Admin panel, API, and WebSocket server running.", tone: "ok", at: 44 },
                            { text: "", at: 52 },
                            { text: "API on :3001 · panel on :5173", tone: "muted", at: 56 },
                        ]}
                    />
                </Frame>
            </div>
        </Stage>
    </Scene>
);

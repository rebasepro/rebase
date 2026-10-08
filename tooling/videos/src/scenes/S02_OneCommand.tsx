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
 * line here is copied from a real run of these three commands (init.ts,
 * db.ts, dev.ts, 2026-10-08, against a local Postgres): scaffold, move the
 * schema onto the database, start both halves. Lines are left out, none are
 * added, and the ports are the ones that run derived. The CLI page runs the
 * same three steps through pnpm (CliContent.astro); here they are the bare
 * `rebase` a global install gives, because `pnpm dlx …` and a `cd` typed out
 * do not fit the scene's 205 frames. A demo terminal that invents its own
 * output is the fastest way to lose a developer watching this, and one that
 * contradicts its own headline is faster still.
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
                    title="zsh · my-app"
                    delay={12}
                    style={{ flex: 1 }}
                    bodyStyle={{ padding: "30px 38px 34px" }}
                >
                    <Session
                        delay={22}
                        size={23}
                        rate={0.85}
                        steps={[
                            {
                                command: "rebase init . --database-url $DATABASE_URL --install",
                                output: [
                                    { text: "Copying project files...", tone: "muted", at: 8 },
                                    { text: "Installing dependencies with pnpm...", tone: "muted", at: 13 },
                                    { text: "Project my-app created successfully!", tone: "ok", at: 20 },
                                ],
                                pause: 10,
                            },
                            {
                                command: "rebase db push",
                                output: [
                                    { text: "Step 3/3: Applying RLS policies to database...", tone: "muted", at: 8 },
                                    { text: "RLS policies applied successfully.", tone: "ok", at: 14 },
                                    { text: "rebase db push completed successfully.", tone: "ok", at: 20 },
                                ],
                                pause: 10,
                            },
                            {
                                command: "rebase dev",
                                output: [
                                    { text: "↳ PORT = 3479 (derived)", tone: "muted", at: 6 },
                                    { text: "✦ Rebase is ready!", tone: "plain", at: 12 },
                                    { text: "➜ Admin: http://localhost:5175", tone: "plain", at: 16 },
                                    { text: "➜ API:   http://localhost:3479", tone: "plain", at: 20 },
                                ],
                            },
                        ]}
                    />
                </Frame>
            </div>
        </Stage>
    </Scene>
);

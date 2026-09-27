import React, { useState, useEffect } from "react";

/* A scripted editor: the SDK call being written against a typed client, with
   the completions the generated types give you at each dot.

   Every row is data, and the gutter number lives in the same flex row as the
   code, so the two cannot drift apart — they used to be two separate columns
   with different line-heights and margins, and "4" sat beside a blank line.
   The code is the real API (`'=='`, not `'eq'`; `find()` resolves to flat rows,
   not entities), so a reader who copies it gets something that compiles. */

type Seg = { t: string; c?: string };
type Popup = { kind: "field" | "method"; items: string[] };

const KW = "text-[#569cd6]";
const CTRL = "text-[#c586c0]";
const ID = "text-[#9cdcfe]";
const STR = "text-[#ce9178]";
const NUM = "text-[#b5cea8]";
const TYPE = "text-[#4ec9b0]";
const FN = "text-[#dcdcaa]";
const PUNCT = "text-[#d4d4d4]";

const INDENT: Seg = { t: "    " };

const PREAMBLE: Seg[][] = [
    [{ t: "import", c: CTRL }, { t: " { ", c: PUNCT }, { t: "createRebaseClient", c: ID }, { t: " } ", c: PUNCT }, { t: "from", c: CTRL }, { t: " " }, { t: "'@rebasepro/client'", c: STR }, { t: ";", c: PUNCT }],
    [{ t: "import", c: CTRL }, { t: " " }, { t: "type", c: CTRL }, { t: " { ", c: PUNCT }, { t: "Database", c: TYPE }, { t: " } ", c: PUNCT }, { t: "from", c: CTRL }, { t: " " }, { t: "'./generated/sdk/database.types'", c: STR }, { t: ";", c: PUNCT }],
    [],
    [{ t: "const", c: KW }, { t: " " }, { t: "client", c: ID }, { t: " = ", c: PUNCT }, { t: "createRebaseClient", c: FN }, { t: "<", c: PUNCT }, { t: "Database", c: TYPE }, { t: ">({ ", c: PUNCT }, { t: "baseUrl", c: ID }, { t: ": ", c: PUNCT }, { t: "API_URL", c: ID }, { t: " });", c: PUNCT }],
    [],
];

const QUERY_HEAD: Seg[] = [{ t: "const", c: KW }, { t: " { ", c: PUNCT }, { t: "data", c: ID }, { t: " } = ", c: PUNCT }, { t: "await", c: CTRL }, { t: " " }, { t: "client", c: ID }, { t: ".", c: PUNCT }, { t: "data", c: ID }, { t: ".", c: PUNCT }];
const COLLECTIONS = ["posts", "authors", "tags", "comments"];
const METHODS = ["where", "orderBy", "limit", "include", "find"];
const FIELDS = ["status", "title", "author", "created_at"];

const WHERE: Seg[] = [INDENT, { t: ".", c: PUNCT }, { t: "where", c: FN }, { t: "(", c: PUNCT }, { t: "'status'", c: STR }, { t: ", ", c: PUNCT }, { t: "'=='", c: STR }, { t: ", ", c: PUNCT }, { t: "'published'", c: STR }, { t: ")", c: PUNCT }];
const ORDER: Seg[] = [INDENT, { t: ".", c: PUNCT }, { t: "orderBy", c: FN }, { t: "(", c: PUNCT }, { t: "'created_at'", c: STR }, { t: ", ", c: PUNCT }, { t: "'desc'", c: STR }, { t: ")", c: PUNCT }];
const LIMIT: Seg[] = [INDENT, { t: ".", c: PUNCT }, { t: "limit", c: FN }, { t: "(", c: PUNCT }, { t: "25", c: NUM }, { t: ")", c: PUNCT }];
const FIND: Seg[] = [INDENT, { t: ".", c: PUNCT }, { t: "find", c: FN }, { t: "();", c: PUNCT }];

type Frame = { rows: Seg[][]; popup?: Popup; hover?: boolean; hold: number };

/* One entry per beat of the animation; `hold` is how long it stays up. The
   caret always sits at the end of the last row. */
const FRAMES: Frame[] = [
    { rows: [QUERY_HEAD], hold: 700 },
    { rows: [QUERY_HEAD], popup: { kind: "field", items: COLLECTIONS }, hold: 1300 },
    { rows: [[...QUERY_HEAD, { t: "posts", c: ID }]], hold: 450 },
    { rows: [[...QUERY_HEAD, { t: "posts", c: ID }], [INDENT, { t: ".", c: PUNCT }]], popup: { kind: "method", items: METHODS }, hold: 1300 },
    { rows: [[...QUERY_HEAD, { t: "posts", c: ID }], [INDENT, { t: ".", c: PUNCT }, { t: "where", c: FN }, { t: "(", c: PUNCT }, { t: "'", c: STR }]], popup: { kind: "field", items: FIELDS }, hold: 1300 },
    { rows: [[...QUERY_HEAD, { t: "posts", c: ID }], WHERE], hold: 600 },
    { rows: [[...QUERY_HEAD, { t: "posts", c: ID }], WHERE, ORDER], hold: 600 },
    { rows: [[...QUERY_HEAD, { t: "posts", c: ID }], WHERE, ORDER, LIMIT], hold: 500 },
    { rows: [[...QUERY_HEAD, { t: "posts", c: ID }], WHERE, ORDER, LIMIT, FIND], hold: 600 },
    { rows: [[...QUERY_HEAD, { t: "posts", c: ID }], WHERE, ORDER, LIMIT, FIND], hover: true, hold: 2800 },
];
const LAST = FRAMES.length - 1;
const FADE_MS = 300;

const width = (row: Seg[]) => row.reduce((n, s) => n + s.t.length, 0);

export function SdkMiniDemo() {
    const [step, setStep] = useState(0);
    const [fading, setFading] = useState(false);

    useEffect(() => {
        // Reduced motion gets the finished file, still — not a loop.
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            setStep(LAST);
            return;
        }
        let alive = true;
        const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
        (async () => {
            while (alive) {
                for (let i = 0; i <= LAST && alive; i++) {
                    setStep(i);
                    await wait(FRAMES[i].hold);
                }
                // Fade the finished file out rather than blanking it in one frame.
                if (!alive) return;
                setFading(true);
                await wait(FADE_MS);
                if (!alive) return;
                setStep(0);
                setFading(false);
            }
        })();
        return () => { alive = false; };
    }, []);

    const frame = FRAMES[step];
    const rows = [...PREAMBLE, ...frame.rows];
    const caretRow = rows.length - 1;
    const caretCol = width(rows[caretRow]);
    const done = step === LAST;

    return (
        <div className="h-full w-full bg-[#1e1e1e] flex flex-col pointer-events-none select-none overflow-hidden relative font-mono text-[11px] [font-variant-ligatures:none]">
            <div
                className="relative flex-1 overflow-hidden pt-3 transition-opacity"
                style={{ opacity: fading ? 0 : 1, transitionDuration: `${FADE_MS}ms` }}
            >
                {rows.map((row, i) => (
                    <div key={i} className="flex h-[18px] items-center">
                        <span className="w-8 shrink-0 pr-3 text-right text-[10px] text-[#858585]">{i + 1}</span>
                        <span className="relative whitespace-pre pl-3 text-[#d4d4d4]">
                            {row.map((s, j) => <span key={j} className={s.c}>{s.t}</span>)}
                            {i === caretRow && !done && (
                                <span className="ml-px inline-block h-3 w-0.5 align-middle bg-[#d4d4d4] animate-pulse" />
                            )}
                            {i === caretRow && frame.popup && (
                                <span
                                    className="absolute top-full z-10 mt-0.5 min-w-32 rounded-sm border border-[#454545] bg-[#252526] py-0.5 shadow-xl"
                                    style={{ left: `calc(${caretCol}ch + 0.75rem)` }}
                                >
                                    {frame.popup.items.map((item, k) => (
                                        <span key={item} className={`flex items-center gap-1.5 px-1.5 py-0.5 ${k === 0 ? "bg-[#04395e] text-white" : "text-[#cccccc]"}`}>
                                            <span className={`text-[9px] ${frame.popup!.kind === "field" ? "text-[#4fc1ff]" : "text-[#b180d7]"}`}>
                                                {frame.popup!.kind === "field" ? "◇" : "ƒ"}
                                            </span>
                                            {item}{frame.popup!.kind === "method" ? "()" : ""}
                                        </span>
                                    ))}
                                </span>
                            )}
                        </span>
                    </div>
                ))}

                {/* The payoff: what `find()` resolves to, as the editor's hover shows it. */}
                {frame.hover && (
                    <div className="ml-11 mt-3 inline-block rounded-sm border border-[#454545] bg-[#252526] px-2.5 py-1.5 shadow-lg">
                        <div className="text-[#d4d4d4]">
                            <span className={KW}>const</span> <span className={ID}>data</span>: <span className={TYPE}>Post</span>[]
                        </div>
                        <div className="mt-0.5 text-[10px] text-[#858585]">
                            <span className={KW}>type</span> <span className={TYPE}>Post</span> = {"{ "}
                            <span className={ID}>id</span>: <span className={TYPE}>number</span>; <span className={ID}>title</span>: <span className={TYPE}>string</span>; <span className={ID}>status</span>: <span className={STR}>&apos;draft&apos;</span> | <span className={STR}>&apos;published&apos;</span>; …{" }"}
                        </div>
                    </div>
                )}
            </div>

            <div className="h-5 bg-[#007acc] flex items-center px-2 gap-3 text-[9px] text-white/90 shrink-0">
                <span>TypeScript</span>
                <span className="ml-auto">UTF-8</span>
                <span>Ln {caretRow + 1}, Col {caretCol + 1}</span>
            </div>
        </div>
    );
}

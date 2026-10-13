import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { tokenize } from "../components/Code";
import { ramp } from "../components/motion";
import { CHROMA, FONT, INK, RADIUS, SURFACE } from "../theme";

/**
 * The backend section's window: an editor in which the typed SDK is written.
 *
 * There is no footage of this — it is code, so it is set as code, keystroke
 * by keystroke. What it has to show is the one thing the site's own demo
 * shows: `client.data.` completes to YOUR collections, because the SDK is
 * typed from them. The snippet is the site's (rebase.pro, "Working APIs
 * against your database").
 */

const FONT_SIZE = 25;
const LINE = 44;
const CHAR = FONT_SIZE * 0.6;
const PAD_X = 44;
const GUTTER_W = 44;
const HEAD = 54;
const PAD_Y = 34;

/** Where a character cell sits in the window, in pixels. */
export const cell = (line: number, col: number) => ({
    x: PAD_X + GUTTER_W + col * CHAR,
    y: HEAD + PAD_Y + line * LINE,
});

const TOKEN_COLOR: Record<string, string> = {
    keyword: "#4E9BFF",
    string: "#34D399",
    number: "#34D399",
    comment: "#5B6068",
    type: "#36CCD6",
    property: "#E7E9EB",
    punctuation: "#6B7078",
    plain: "#B4B8BD",
};

/** The file, and when each line is typed: [text, from, to] in section
 *  frames. A line with from === to is already there when the window opens. */
const PREFIX = "const { data } = await client.data.";
const COLLECTION = "products";
const SUFFIX = ".find({";

export const TIMING = {
    typeStart: 14,
    popup: 52,
    pick: [52, 66, 80, 94],
    accept: 110,
    listen: [148, 194] as [number, number],
    toast: 204,
};

const LINES: [text: string, from: number, to: number][] = [
    ['import { createRebaseClient } from "@rebasepro/client";', 0, 0],
    ["", 0, 0],
    ["const client = createRebaseClient<Database>({ baseUrl });", 0, 0],
    ["", 0, 0],
    [PREFIX + COLLECTION + SUFFIX, TIMING.typeStart, TIMING.accept + 10],
    ['  where: { in_stock: ["==", true] },', TIMING.accept + 14, TIMING.accept + 26],
    ["});", TIMING.accept + 28, TIMING.accept + 30],
    ["", 0, 0],
    ["client.data.orders.listen({}, (res) => setRows(res.data));", ...TIMING.listen],
];

const COLLECTIONS = ["customers", "orders", "posts", "products", "tags"];

/** How much of line 5 is on screen at `frame`: typed up to the dot, then the
 *  completion lands whole, then the call is typed. */
function line5(frame: number): string {
    const typed = Math.floor(interpolate(frame, [TIMING.typeStart, TIMING.popup - 4], [0, PREFIX.length], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    }));
    if (frame < TIMING.accept) return PREFIX.slice(0, typed);
    const rest = Math.floor(interpolate(frame, [TIMING.accept + 2, TIMING.accept + 10], [0, SUFFIX.length], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
    }));
    return PREFIX + COLLECTION + SUFFIX.slice(0, rest);
}

function visible(i: number, frame: number): string | null {
    const [text, from, to] = LINES[i];
    if (i === 4) return frame < from ? null : line5(frame);
    if (from === to) return frame >= from ? text : null;
    if (frame < from) return null;
    const n = Math.floor(interpolate(frame, [from, to], [0, text.length], { extrapolateRight: "clamp" }));
    return text.slice(0, n);
}

const Highlighted: React.FC<{ text: string }> = ({ text }) => (
    <>
        {tokenize(text).map((tok, j) => (
            <span key={j} style={{ color: TOKEN_COLOR[tok.kind] }}>
                {tok.text}
            </span>
        ))}
    </>
);

export const Editor: React.FC = () => {
    const frame = useCurrentFrame();

    // The line the caret is on: the last one being typed.
    let caretLine = 4;
    if (frame >= TIMING.accept + 14) caretLine = 5;
    if (frame >= TIMING.accept + 28) caretLine = 6;
    if (frame >= TIMING.listen[0]) caretLine = 8;
    const caretText = visible(caretLine, frame) ?? "";
    const caret = cell(caretLine, caretText.length);
    const typing = LINES.some(([, from, to], i) => i !== 4 && from !== to && frame >= from && frame < to) ||
        (frame >= TIMING.typeStart && frame < TIMING.accept + 12);
    const blink = typing || Math.floor(frame / 24) % 2 === 0;

    const popupOpen = frame >= TIMING.popup && frame < TIMING.accept;
    const pick = TIMING.pick.filter((f) => frame >= f).length - 1;
    const popupAt = cell(5, PREFIX.length);
    const popupIn = ramp(frame, TIMING.popup, 10);

    const toastIn = ramp(frame, TIMING.toast, 22);

    return (
        // No ligatures: JetBrains Mono draws "==" as one long bar and "=>" as
        // an arrow, and on screen for a beat neither reads as the code typed.
        <div style={{ position: "absolute", inset: 0, background: SURFACE.sheet, fontVariantLigatures: "none" }}>
            {/* Head: the window's own chrome, kept monochrome. */}
            <div
                style={{
                    height: HEAD,
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "0 22px",
                    borderBottom: `1px solid ${SURFACE.hairline}`,
                    fontFamily: FONT.mono,
                    fontSize: 17,
                    color: INK.muted,
                }}
            >
                {[0, 1, 2].map((k) => (
                    <div key={k} style={{ width: 11, height: 11, borderRadius: 6, background: "rgba(255,255,255,0.14)" }} />
                ))}
                <span style={{ marginLeft: 14, color: INK.copy }}>app.ts</span>
                <span style={{ marginLeft: "auto" }}>typed from your collections</span>
            </div>

            {LINES.map((_, i) => {
                const text = visible(i, frame);
                const at = cell(i, 0);
                return (
                    <div
                        key={i}
                        style={{
                            position: "absolute",
                            left: PAD_X,
                            top: at.y,
                            height: LINE,
                            display: "flex",
                            alignItems: "center",
                            fontFamily: FONT.mono,
                            fontSize: FONT_SIZE,
                            whiteSpace: "pre",
                        }}
                    >
                        <span style={{ width: GUTTER_W, color: "#4A4F57", fontSize: FONT_SIZE * 0.8 }}>{i + 1}</span>
                        {text !== null && <Highlighted text={text} />}
                    </div>
                );
            })}

            {/* Caret. */}
            <div
                style={{
                    position: "absolute",
                    left: caret.x,
                    top: caret.y + 8,
                    width: 2.5,
                    height: LINE - 16,
                    background: "#E7E9EB",
                    opacity: blink ? 1 : 0,
                }}
            />

            {/* Completion list: the collections, because the SDK is typed
                from them. */}
            {popupOpen && (
                <div
                    style={{
                        position: "absolute",
                        left: popupAt.x - 12,
                        top: popupAt.y + 4,
                        width: 360,
                        padding: 6,
                        borderRadius: RADIUS.lg,
                        background: SURFACE.raised,
                        border: `1px solid ${SURFACE.hairlineStrong}`,
                        opacity: popupIn,
                        transform: `translateY(${(1 - popupIn) * -6}px)`,
                        fontFamily: FONT.mono,
                        fontSize: 22,
                    }}
                >
                    {COLLECTIONS.map((name, k) => (
                        <div
                            key={name}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                height: 42,
                                padding: "0 12px",
                                borderRadius: RADIUS.md,
                                background: k === pick ? "rgba(78,155,255,0.22)" : "transparent",
                                color: k === pick ? "#F7F8F8" : INK.copy,
                            }}
                        >
                            <span style={{ color: CHROMA.cyan, marginRight: 14, fontSize: 18 }}>◆</span>
                            {name}
                            <span style={{ marginLeft: "auto", fontSize: 16, color: INK.muted }}>collection</span>
                        </div>
                    ))}
                </div>
            )}

            {/* The listener answering: a row arrives from another client. */}
            <div
                style={{
                    position: "absolute",
                    right: 30,
                    bottom: 30,
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "16px 22px",
                    borderRadius: RADIUS.lg,
                    background: SURFACE.card,
                    border: `1px solid ${SURFACE.hairlineStrong}`,
                    fontFamily: FONT.mono,
                    fontSize: 20,
                    color: INK.copy,
                    opacity: toastIn,
                    transform: `translateY(${(1 - toastIn) * 30}px)`,
                }}
            >
                <span
                    style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        background: "#34D399",
                        boxShadow: `0 0 0 ${6 * (0.5 + 0.5 * Math.sin(frame / 6))}px rgba(52,211,153,0.18)`,
                    }}
                />
                <span style={{ color: "#F7F8F8" }}>orders</span>
                <span style={{ color: INK.muted }}>INSERT</span>
                <span>ORD-2026-0175</span>
            </div>
        </div>
    );
};

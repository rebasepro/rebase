import React from "react";
import { useCurrentFrame } from "remotion";
import { FONT } from "../theme";
import { useTone } from "../Plane";
import { ramp } from "./motion";

/**
 * Token colouring for the snippets the film shows.
 *
 * Deliberately a small hand-rolled tokenizer rather than a highlighting
 * library, for the same reason the console has one (saas/frontend/src/views/
 * project/code-highlight.ts): this colours OUR OWN code, half a dozen snippets
 * of it, in a grammar we already know completely. A general highlighter would
 * be a dependency, a bundle and a theme to maintain — and a shiki theme's
 * palette is not this palette.
 *
 * What it has to get right is narrow: a collection definition in TypeScript
 * and a policy in SQL, both legible at 22px from across a room.
 */

export type TokenKind =
    | "keyword" | "string" | "number" | "comment"
    | "type" | "property" | "punctuation" | "plain";

const TS_KEYWORDS = new Set([
    "import", "from", "export", "const", "let", "async", "await", "return",
    "function", "new", "true", "false", "null", "as", "satisfies", "type",
]);

const SQL_KEYWORDS = new Set([
    "create", "policy", "on", "for", "to", "using", "with", "check", "select",
    "insert", "update", "delete", "alter", "table", "enable", "row", "level",
    "security", "and", "or", "not", "null", "where", "from", "as",
]);

/** One pass, in precedence order: comment, string, number, word, punctuation.
 *  Anything unmatched falls through as plain, so no input is silently dropped. */
const PATTERN =
    /(\/\/[^\n]*|--[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d[\w.]*\b)|([A-Za-z_$][\w$]*)|([{}()[\];,:.<>=|&?!+\-*/@])/g;

export function tokenize(line: string, sql = false): { text: string; kind: TokenKind }[] {
    const out: { text: string; kind: TokenKind }[] = [];
    let cursor = 0;

    const push = (text: string, kind: TokenKind) => {
        if (!text) return;
        const last = out[out.length - 1];
        if (last && last.kind === kind) last.text += text;
        else out.push({ text, kind });
    };

    for (const m of line.matchAll(PATTERN)) {
        const [raw, comment, str, num, word, punct] = m;
        push(line.slice(cursor, m.index), "plain");
        cursor = m.index + raw.length;

        if (comment !== undefined) push(raw, "comment");
        else if (str !== undefined) push(raw, "string");
        else if (num !== undefined) push(raw, "number");
        else if (word !== undefined) {
            const kws = sql ? SQL_KEYWORDS : TS_KEYWORDS;
            if (kws.has(sql ? word.toLowerCase() : word)) push(raw, "keyword");
            // A capitalised word in these snippets is always a type.
            else if (!sql && /^[A-Z]/.test(word)) push(raw, "type");
            // "key:" — the shape of nearly every line of a collection.
            else if (!sql && line.slice(m.index + raw.length).trimStart().startsWith(":"))
                push(raw, "property");
            else push(raw, "plain");
        } else if (punct !== undefined) push(raw, "punctuation");
    }

    push(line.slice(cursor), "plain");
    return out;
}

/** Two hues and neutrals. No new brand colour is introduced — the accent is
 *  the one the product already uses, and green means "a literal value". */
const TOKEN_COLOR: Record<TokenKind, string> = {
    keyword: "#4E9BFF",
    string: "#34D399",
    number: "#34D399",
    comment: "#5B6068",
    type: "#36CCD6",
    property: "#E7E9EB",
    punctuation: "#6B7078",
    plain: "#B4B8BD",
};

export const Code: React.FC<{
    code: string;
    sql?: boolean;
    size?: number;
    /** Frame at which line 1 appears; each further line follows by step. */
    delay?: number;
    step?: number;
    /** Lines held at full strength — the one thing the shot is about. */
    emphasise?: number[];
    style?: React.CSSProperties;
}> = ({ code, sql = false, size = 22, delay = 0, step = 2.5, emphasise, style }) => {
    const frame = useCurrentFrame();
    const lines = code.split("\n");

    return (
        <pre
            style={{
                fontFamily: FONT.mono,
                fontSize: size,
                lineHeight: 1.65,
                margin: 0,
                letterSpacing: "-0.01em",
                ...style,
            }}
        >
            {lines.map((line, i) => {
                const t = ramp(frame, delay + i * step, 14);
                const dim = emphasise && !emphasise.includes(i) ? 0.42 : 1;
                return (
                    <div
                        key={i}
                        style={{
                            opacity: t * dim,
                            transform: `translateY(${(1 - t) * 6}px)`,
                            minHeight: size * 1.65,
                        }}
                    >
                        {tokenize(line, sql).map((tok, j) => (
                            <span key={j} style={{ color: TOKEN_COLOR[tok.kind] }}>
                                {tok.text}
                            </span>
                        ))}
                    </div>
                );
            })}
        </pre>
    );
};

/** A file name over a snippet. The snippet means something different if you do
 *  not know it is a file. */
export const CodeCaption: React.FC<{ children: React.ReactNode; delay?: number }> = ({
    children,
    delay = 0,
}) => {
    const frame = useCurrentFrame();
    /* The ground's own muted ink, not INK.muted: #797979 is 2.4:1 on the
       claim's blue, and a file name nobody can read is a frame with no
       name. See the note over TONE in theme.ts. */
    const tone = useTone();
    return (
        <div
            style={{
                fontFamily: FONT.mono,
                fontSize: 15,
                color: tone.muted,
                letterSpacing: "0.04em",
                opacity: ramp(frame, delay, 12),
            }}
        >
            {children}
        </div>
    );
};

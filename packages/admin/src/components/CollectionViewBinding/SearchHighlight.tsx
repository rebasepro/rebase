import React, { useMemo } from "react";
import type { SearchMatch } from "@rebasepro/types";

/**
 * Showing a searcher *why* a row is in their results.
 *
 * A ranked list answers "which rows" and never "why this one". When the term is
 * in the title that is self-evident; when it is in a field the list does not
 * show — a certification, a nested answer, a note — the row looks arbitrary and
 * the only way to find out is to open it. That is the whole reason this exists.
 *
 * Two jobs, and they are deliberately separate:
 *
 * 1. {@link Highlighted} marks the term inside a value the list already shows.
 * 2. {@link offSlotMatch} finds a match in a field that has no slot, so the
 *    caller can put it where the subtitle would have gone.
 */

/** `<mark>` is Postgres's delimiter, and what `ts_headline` emits. */
const MARK = /(<mark>.*?<\/mark>)/g;

/**
 * Render a `ts_headline` snippet: text with `<mark>` around each hit.
 *
 * Split-and-render rather than `dangerouslySetInnerHTML`. The text around the
 * marks is whatever a user typed into their own record, and the only markup it
 * is allowed to carry is the highlight Postgres put there. Anything else stays
 * inert text.
 */
export function Snippet({ text, className }: { text: string; className?: string }) {
    const parts = useMemo(() => text.split(MARK), [text]);
    return (
        <span className={className}>
            {parts.map((part, i) =>
                part.startsWith("<mark>")
                    ? (
                        <mark
                            key={i}
                            className="bg-amber-200/70 dark:bg-amber-400/30 text-inherit rounded-[3px] px-[1px]"
                        >
                            {part.slice(6, -7)}
                        </mark>
                    )
                    : <React.Fragment key={i}>{part}</React.Fragment>
            )}
        </span>
    );
}

/**
 * Mark every occurrence of the searched terms inside a plain value.
 *
 * Used for values the list already renders, where the server's snippet would be
 * the wrong thing to show: the snippet is truncated to a fragment and folded to
 * the indexed form, while the cell should keep the record's real text. So the
 * terms are re-matched here, on the display value.
 *
 * Deliberately dumber than the server's matching, and it has to be: this cannot
 * stem or unaccent without reimplementing the text search configuration in the
 * browser and getting it subtly different. It marks what it can find as a
 * prefix, case- and accent-insensitively, and marks nothing when it cannot —
 * a highlight that is merely absent reads as "no hit in this field", which is
 * the honest answer for a stem the browser cannot reproduce.
 */
export function Highlighted({ text, terms, className }: { text: string; terms: string[]; className?: string }) {
    const segments = useMemo(() => splitOnTerms(text, terms), [text, terms]);
    if (segments.length <= 1) return <span className={className}>{text}</span>;
    return (
        <span className={className}>
            {segments.map((seg, i) =>
                seg.hit
                    ? (
                        <mark
                            key={i}
                            className="bg-amber-200/70 dark:bg-amber-400/30 text-inherit rounded-[3px] px-[1px]"
                        >
                            {seg.text}
                        </mark>
                    )
                    : <React.Fragment key={i}>{seg.text}</React.Fragment>
            )}
        </span>
    );
}

/** Strip diacritics so `gestion` marks `gestión`, mirroring the index's unaccent. */
const fold = (value: string): string =>
    value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Segment { text: string; hit: boolean }

/**
 * Split `text` into hit / non-hit runs.
 *
 * Matches on the *folded* form but slices the original, so the marked text
 * keeps its accents and case — `Gestión`, not `gestion`. Folding is
 * length-preserving for the diacritics this handles, which is what makes the
 * indices transferable; a fold that changed length would misalign the slices.
 */
export function splitOnTerms(text: string, terms: string[]): Segment[] {
    const haystack = fold(text);
    const needles = terms.map(fold).filter(t => t.length >= 2);
    if (needles.length === 0) return [{ text, hit: false }];

    // Word-start matches only. A search for "iso" marking the "iso" inside
    // "revisor" is noise, and reads as a bug rather than a feature.
    const bounds: [number, number][] = [];
    for (const needle of needles) {
        let from = 0;
        for (;;) {
            const at = haystack.indexOf(needle, from);
            if (at === -1) break;
            const before = at === 0 ? " " : haystack[at - 1];
            if (!/[\p{L}\p{N}]/u.test(before)) bounds.push([at, at + needle.length]);
            from = at + needle.length;
        }
    }
    if (bounds.length === 0) return [{ text, hit: false }];

    // Merge overlaps so two terms hitting the same run mark it once.
    bounds.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [start, end] of bounds) {
        const last = merged[merged.length - 1];
        if (last && start <= last[1]) last[1] = Math.max(last[1], end);
        else merged.push([start, end]);
    }

    const segments: Segment[] = [];
    let cursor = 0;
    for (const [start, end] of merged) {
        if (start > cursor) segments.push({ text: text.slice(cursor, start), hit: false });
        segments.push({ text: text.slice(start, end), hit: true });
        cursor = end;
    }
    if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
    return segments;
}

/**
 * The terms a searcher typed, as things to look for in a rendered value.
 *
 * Quoted phrases stay whole; `-excluded` terms are dropped, since marking a
 * word the user asked *not* to see would be actively wrong. `websearch_to_tsquery`
 * reads the same syntax on the server.
 */
export function searchTerms(searchString: string | undefined): string[] {
    if (!searchString) return [];
    const terms: string[] = [];
    for (const [, phrase, bare] of searchString.matchAll(/"([^"]+)"|(\S+)/g)) {
        const term = phrase ?? bare;
        if (!term || term.startsWith("-")) continue;
        if (/^(or|and)$/i.test(term)) continue;
        terms.push(term);
    }
    return terms;
}

/**
 * The best match to show when the term is nowhere the list already displays.
 *
 * `shownKeys` are the property paths the row is already rendering, so a match
 * there needs no explaining — {@link Highlighted} marks it in place and the
 * subtitle keeps its own job. Anything else is invisible, and one of those is
 * what the subtitle slot gets replaced with.
 *
 * The first such match wins, and the server returns them in the order the
 * collection declared its `search` fields — so the field an author put first is
 * the one a reader sees, rather than whichever the database aggregated first.
 */
export function offSlotMatch(
    matches: SearchMatch[] | undefined,
    shownKeys: (string | undefined)[]
): SearchMatch | undefined {
    if (!matches || matches.length === 0) return undefined;
    const shown = new Set(shownKeys.filter((k): k is string => Boolean(k)));
    return matches.find(m => !shown.has(m.field));
}

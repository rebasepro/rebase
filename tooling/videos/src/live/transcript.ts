import type { Script, Timing } from "../spoken/narration";

/**
 * WHAT WAS ACTUALLY SAID — the recogniser's words, kept with the frame each
 * was first heard, so a read can be compared with the script line by line.
 *
 * Chrome hands over a session's WHOLE transcript on every update and may
 * revise its tail as it hears more, so each update is diffed against the
 * last: a word that stays the same keeps the frame it first appeared at, a
 * revised one keeps the earlier frame of the slot it replaced (it was heard
 * then, just heard wrong). A new session starts a new list.
 */
export interface HeardWord {
    text: string;
    /** The take frame it was first heard: a few hundred ms after it was said. */
    at: number;
}

export class TranscriptLog {
    private readonly sessions: HeardWord[][] = [[]];

    onSession(): void {
        if (this.current.length) this.sessions.push([]);
    }

    update(text: string, now: number): void {
        const tokens = text.split(/\s+/).filter(Boolean);
        const before = this.current;
        const next: HeardWord[] = tokens.map((t, i) => ({ text: t, at: before[i] ? Math.min(before[i].at, now) : now }));
        this.sessions[this.sessions.length - 1] = next;
    }

    words(): HeardWord[] {
        return this.sessions.flat();
    }

    text(): string {
        return this.words()
            .map((w) => w.text)
            .join(" ");
    }

    private get current(): HeardWord[] {
        return this.sessions[this.sessions.length - 1];
    }
}

/** Recognition's typical lag behind the voice, in frames. */
const LAG = 12;

/**
 * Each line's words, as heard: a word belongs to the line that had started
 * by the time it was said (heard, minus the recogniser's lag). Lines the read
 * never reached get nothing.
 */
export function heardPerLine(script: Script, timing: Timing, words: readonly HeardWord[]): string[] {
    const starts = script.map((_, k) => timing.lines[k]?.words[0] ?? null);
    return script.map((_, k) => {
        const from = starts[k];
        if (from === null) return "";
        const to = starts.slice(k + 1).find((s): s is number => s !== null) ?? Infinity;
        return words
            .filter((w) => w.at - LAG >= from - 6 && w.at - LAG < to - 6)
            .map((w) => w.text)
            .join(" ");
    });
}

const bare = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");

/** Whether what was said is the line, give or take case and punctuation. */
export function sameWords(line: string, heard: string): boolean {
    const a = line.split(/\s+/).map(bare).filter(Boolean);
    const b = heard.split(/\s+/).map(bare).filter(Boolean);
    return a.length === b.length && a.every((w, i) => w === b[i]);
}

export type DiffPart = { kind: "same" | "said" | "dropped"; text: string };

/**
 * The line and what was said, aligned word by word (longest common
 * subsequence on the bare words): what both have, what only the speaker
 * said, what they left out.
 */
export function diffWords(line: string, heard: string): DiffPart[] {
    const a = line.split(/\s+/).filter(Boolean);
    const b = heard.split(/\s+/).filter(Boolean);
    const n = a.length;
    const m = b.length;
    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
        for (let j = m - 1; j >= 0; j--) lcs[i][j] = bare(a[i]) === bare(b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    const out: DiffPart[] = [];
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
        if (i < n && j < m && bare(a[i]) === bare(b[j])) {
            out.push({ kind: "same", text: a[i] });
            i++;
            j++;
        } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
            out.push({ kind: "said", text: b[j] });
            j++;
        } else {
            out.push({ kind: "dropped", text: a[i] });
            i++;
        }
    }
    return out;
}

/**
 * The line rewritten as it was said, keeping the script's spelling,
 * capitals and punctuation wherever the words agree — the recogniser hears
 * no commas and few capitals. Words only the speaker said go in as heard; a
 * sentence still ends where the script's did. A starting point to edit, not
 * a finished line.
 */
export function suggestLine(line: string, heard: string): string {
    const parts = diffWords(line, heard);
    const words: string[] = [];
    let pendingStop = "";
    for (const p of parts) {
        if (p.kind === "dropped") {
            /* A dropped word's closing punctuation moves to what came before. */
            const tail = /[.,;:!?]+$/.exec(p.text)?.[0] ?? "";
            if (tail && words.length) pendingStop = tail;
            continue;
        }
        if (pendingStop && words.length) {
            words[words.length - 1] = words[words.length - 1].replace(/[.,;:!?]*$/, pendingStop);
            pendingStop = "";
        }
        let w = p.text;
        if (p.kind === "said") {
            const prev = words[words.length - 1];
            if (!prev || /[.!?]$/.test(prev)) w = w[0].toUpperCase() + w.slice(1);
        }
        words.push(w);
    }
    if (pendingStop && words.length) words[words.length - 1] = words[words.length - 1].replace(/[.,;:!?]*$/, pendingStop);
    const joined = words.join(" ");
    const out = joined ? joined[0].toUpperCase() + joined.slice(1) : joined;
    /* Ends a sentence if the line did. */
    return /[.!?]$/.test(line) && !/[.!?]$/.test(out) ? `${out}.` : out;
}

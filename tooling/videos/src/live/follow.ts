import { DESK_NARRATION } from "../desk/script";
import type { Timing } from "../desk/timeline";
import { COMMON, exactWord, sameWord, tokensOf, tokensOfTranscript } from "./words";

/**
 * THE FOLLOWER — where in the script the presenter is, and when each word
 * was said, from two things the page can hear:
 *
 *   the VOICE     a level meter on the microphone (listen.ts). It knows
 *                 THAT someone started speaking within a tenth of a second,
 *                 but not what they said.
 *   the WORDS     speech recognition (listen.ts). It knows what was said,
 *                 but a few hundred milliseconds late, and not always right.
 *
 * The words move a cursor through the script. The voice times the one
 * moment the film most needs on time — a line's first word, which is what
 * every camera move hangs off: when the last line is done and the voice
 * starts again, the next line has started, now, before any word of it has
 * been recognised. So the camera leaves as the presenter opens their mouth
 * rather than half a second after.
 *
 * Every frame here is a frame of the TAKE: 0 is the moment the recording
 * started. The film plays in step with it, so the same numbers are its
 * frames too.
 */

interface Token {
    text: string;
    line: number;
    word: number;
}

export interface FollowerEvent {
    frame: number;
    kind: "words" | "voice" | "session" | "advance" | "silence" | "start";
    detail: string;
}

/** How far ahead of the cursor a heard word may land. Eight tokens is a
 *  missed phrase; further than that, and a word that merely recurs later in
 *  the script would drag the film ahead of the speaker. */
const WINDOW = 8;

/** When the cursor is LOST — RESYNC_AFTER heard words in a row that
 *  matched nothing — it re-anchors on two distinctive words heard in order,
 *  the first within RESYNC_REACH tokens ahead, the second spaced in the
 *  script as it was in the speech (within a word or two). Exact matches
 *  only. Every loosening of this was measured to make the film run ahead
 *  of a normal read: "fine" for "issues" fuzzily matched "file" a line
 *  later, and with "table" after it jumped the film fourteen seconds. */
const RESYNC_AFTER = 4;
const RESYNC_REACH = 48;

/** Distinctive enough to re-anchor on: not common, and long enough that
 *  the recogniser rarely produces it by accident. */
const distinctive = (t: string) => t.length >= 4 && !COMMON.has(t);

/** A line whose last word or two were never recognised is ended by
 *  silence: at most this many words left, and this long without a voice.
 *  Conservative on purpose — ending a line early moves the camera while
 *  the presenter is still on it, which is worse than moving it late. */
const TAIL_WORDS = 2;
const TAIL_SILENCE = 24;

export class Follower {
    readonly fps: number;
    readonly tokens: Token[] = [];
    /** Index of the first token of each word, [line][word]. */
    private readonly firstToken: number[][] = [];
    /** The next token expected. Only ever moves forward. */
    cursor = 0;
    /** Where the current recognition session's alignment starts: its
     *  cursor, and how many of its tokens to skip. */
    private base = 0;
    private skip = 0;
    private lastTokens = 0;

    /** When each word was said (estimated) and heard, in take frames. */
    readonly said: (number | null)[][];
    readonly heard: (number | null)[][];
    /** When recognition itself matched each word — null for a word the
     *  voice or silence filled in. The take processor trusts these over
     *  everything else. */
    readonly recognized: (number | null)[][];
    readonly ends: ({ at: number; heard: number } | null)[];

    /** Recognition's lag behind the voice, in frames. Measured on every
     *  line whose start the voice caught. */
    latency: number;
    /** Frames a word takes to say, measured on every finished line. */
    perWord = 10;

    speaking = false;
    /** When the voice last started or stopped; -Infinity until it first
     *  does, so "silent since" never reads as "silent since frame 0". */
    private voiceSince = -Infinity;
    /** Every time the voice started, and how long the silence before it
     *  was — a line reached by recognition alone takes its start from the
     *  onset that began it. */
    private readonly onsets: { at: number; silence: number }[] = [];
    readonly events: FollowerEvent[] = [];
    /** Bumps whenever `timing()` would return something different. */
    version = 0;

    constructor(fps = 30, latency = 15) {
        this.fps = fps;
        this.latency = latency;
        DESK_NARRATION.forEach((line, l) => {
            this.firstToken.push([]);
            line.words.forEach((w, i) => {
                this.firstToken[l].push(this.tokens.length);
                for (const text of tokensOf(w)) this.tokens.push({ text, line: l, word: i });
            });
        });
        this.said = DESK_NARRATION.map((l) => l.words.map(() => null));
        this.heard = DESK_NARRATION.map((l) => l.words.map(() => null));
        this.recognized = DESK_NARRATION.map((l) => l.words.map(() => null));
        this.ends = DESK_NARRATION.map(() => null);
    }

    get done(): boolean {
        return this.cursor >= this.tokens.length;
    }

    /** The line being said, or about to be, and the next word in it. */
    position(): { line: number; word: number } {
        if (this.done) {
            const line = DESK_NARRATION.length - 1;
            return { line, word: DESK_NARRATION[line].words.length };
        }
        const t = this.tokens[this.cursor];
        return { line: t.line, word: t.word };
    }

    /* ── what the page hears ────────────────────────────────────────── */

    /** A new recognition session: the recogniser restarts itself every
     *  minute or so, and after silence. Its transcript starts empty. */
    onSession(now: number): void {
        this.base = this.cursor;
        this.skip = 0;
        this.lastTokens = 0;
        this.log(now, "session", "");
    }

    /** The whole transcript of the current session so far — final results
     *  and the interim tail, which the recogniser may still revise. Aligned
     *  from the session's start every time, so a revision only ever
     *  changes the tail. */
    onTranscript(text: string, final: boolean, now: number): void {
        const heard = tokensOfTranscript(text);
        this.lastTokens = heard.length;
        let p = this.base;
        let i = this.skip;
        let lost = 0;
        while (i < heard.length && p < this.tokens.length) {
            const h = heard[i];
            const joined = i + 1 < heard.length ? h + heard[i + 1] : null;
            let hit = -1;
            let used = 1;
            let pending = false;
            for (let j = p; j < Math.min(p + WINDOW, this.tokens.length); j++) {
                const want = this.tokens[j].text;
                if ((COMMON.has(want) || COMMON.has(h)) && j > p + 1) continue;
                let n = 0;
                if (sameWord(h, want)) n = 1;
                /* "back end" for "backend", "real time" for "realtime". */
                else if (joined && sameWord(joined, want)) n = 2;
                if (!n) continue;
                /* Into the NEXT line on one word is how the film leaves a
                   line the presenter is still finishing: a misheard last
                   word ("forms" as "table") matches the next line's. So a
                   crossing needs the word after it confirmed too — or, if
                   nothing has been heard after it yet, it waits. */
                if (this.crosses(p, j)) {
                    const confirmed = this.confirms(heard, i + n, j);
                    if (confirmed === null) {
                        pending = true;
                        break;
                    }
                    if (!confirmed) continue;
                }
                hit = j;
                used = n;
                break;
            }
            if (pending) break;
            if (hit >= 0) {
                p = hit + 1;
                lost = 0;
            } else {
                lost++;
                if (lost >= RESYNC_AFTER && distinctive(h)) {
                    const anchor = this.reanchor(heard, i, p);
                    if (anchor !== null) {
                        p = anchor.p;
                        i = anchor.i;
                        lost = 0;
                        continue;
                    }
                }
            }
            i += used;
        }
        this.log(now, "words", `${final ? "final" : "interim"}: ${text}`);
        if (p > this.cursor) this.advanceTo(p, now);
    }

    /** Whether matching script token `j` from cursor `p` leaves a line
     *  that has not been finished. A cursor at a line's first token is
     *  between lines, and matching into that line is not a crossing. */
    private crosses(p: number, j: number): boolean {
        if (p >= this.tokens.length) return false;
        const from = this.tokens[p];
        const atLineStart = this.firstToken[from.line][0] === p;
        return !atLineStart && this.tokens[j].line !== from.line;
    }

    /** Whether one of the next two heard tokens (from `i`) matches one of
     *  the next three script tokens after `j` — or null when nothing has
     *  been heard after `i` yet. */
    private confirms(heard: string[], i: number, j: number): boolean | null {
        if (i >= heard.length) return null;
        for (let a = i; a < Math.min(i + 2, heard.length); a++) {
            for (let b = j + 1; b < Math.min(j + 4, this.tokens.length); b++) {
                if (sameWord(heard[a], this.tokens[b].text)) return true;
            }
        }
        return false;
    }

    /** Heard token `i` matched nothing near the cursor. If it and a second
     *  distinctive word after it match the script in order further ahead,
     *  the presenter is there: return the new cursor (past the second word)
     *  and the heard token to continue from. */
    private reanchor(heard: string[], i: number, p: number): { p: number; i: number } | null {
        const reach = Math.min(p + RESYNC_REACH, this.tokens.length);
        for (let j = p; j < reach; j++) {
            if (!exactWord(heard[i], this.tokens[j].text)) continue;
            for (let i2 = i + 1; i2 < Math.min(i + 4, heard.length); i2++) {
                if (!distinctive(heard[i2])) continue;
                const gap = i2 - i;
                for (let j2 = j + Math.max(1, gap - 1); j2 <= Math.min(j + gap + 2, this.tokens.length - 1); j2++) {
                    if (exactWord(heard[i2], this.tokens[j2].text)) return { p: j2 + 1, i: i2 + 1 };
                }
            }
        }
        return null;
    }

    /** The voice started (speaking) or stopped, at frame `at`; `now` is when
     *  the page learned it. */
    onVoice(speaking: boolean, at: number, now: number): void {
        if (speaking === this.speaking) return;
        if (speaking) this.onsets.push({ at, silence: at - this.voiceSince });
        this.speaking = speaking;
        this.voiceSince = at;
        this.log(now, "voice", speaking ? "on" : "off");
        if (!speaking || this.done) return;
        /* A voice after a finished line is the next line starting. Mark its
           first word said NOW — before recognition names it — so the film's
           move into the next beat starts as the presenter opens their mouth. */
        const { line, word } = this.position();
        const previousEnd = line > 0 ? this.ends[line - 1] : null;
        const lineIsNext = word === 0 && this.said[line][0] === null;
        const afterPrevious = line === 0 || (previousEnd !== null && at > previousEnd.at);
        if (lineIsNext && afterPrevious) {
            this.said[line][0] = at;
            this.heard[line][0] = Math.max(at, now);
            this.version++;
        }
    }

    /** Time-based rules, called every frame or so. A line whose last words
     *  were never recognised ends on silence. */
    tick(now: number): void {
        if (this.done || this.speaking) return;
        const { line, word } = this.position();
        const total = DESK_NARRATION[line].words.length;
        const left = total - word;
        if (word === 0 || left > TAIL_WORDS || now - this.voiceSince < TAIL_SILENCE) return;
        this.log(now, "silence", `line ${line}: ${left} word(s) never heard`);
        this.finishLine(line, now, this.voiceSince);
    }

    /** The presenter pressed "next": the line being said is over, whatever
     *  recognition made of it. The next line starts with the next voice. */
    advanceLine(now: number): void {
        if (this.done) return;
        const { line } = this.position();
        this.log(now, "advance", `line ${line}`);
        /* The line ended when the voice last stopped — if it stopped during
           this line. With no voice heard since the line began (a microphone
           the level meter cannot hear), it ended at the key press. */
        const began = this.said[line][0] ?? this.lastSaid() ?? -Infinity;
        const quietSince = this.speaking ? now : this.voiceSince;
        this.finishLine(line, now, quietSince > began ? Math.min(now, quietSince) : now);
    }

    /* ── what the film gets ─────────────────────────────────────────── */

    /** The live timing: every word said so far, when, and when it was
     *  heard. See timeline.ts on why "heard" matters. */
    timing(): Timing {
        return {
            live: true,
            lines: DESK_NARRATION.map((l, k) => {
                const words: number[] = [];
                const heard: number[] = [];
                for (let w = 0; w < l.words.length; w++) {
                    const s = this.said[k][w];
                    const h = this.heard[k][w];
                    if (s === null || h === null) break;
                    words.push(s);
                    heard.push(h);
                }
                if (!words.length) return null;
                const end = this.ends[k];
                return end ? { words, heard, end: end.at, endHeard: end.heard } : { words, heard };
            }),
        };
    }

    /* ── internals ───────────────────────────────────────────────────── */

    private log(frame: number, kind: FollowerEvent["kind"], detail: string) {
        this.events.push({ frame: Math.round(frame), kind, detail });
    }

    /** Move the cursor to token `p`, marking every word it passes as said.
     *  The newest was said about `latency` ago; any passed over with it are
     *  spread back from there at the speaker's own pace. */
    private advanceTo(p: number, now: number) {
        const passed: [number, number][] = [];
        for (let t = this.cursor; t < p; t++) {
            const { line, word } = this.tokens[t];
            if (this.firstToken[line][word] === t && this.recognized[line][word] === null) this.recognized[line][word] = now;
            if (this.firstToken[line][word] === t && this.heard[line][word] === null) passed.push([line, word]);
            /* A voice-marked first word: its "said" is the voice's, already. */
            else if (this.firstToken[line][word] === t && word === 0 && this.said[line][0] !== null) {
                const sample = now - (this.said[line][0] ?? now);
                if (sample > 3 && sample < 60) this.latency = Math.round(this.latency * 0.7 + sample * 0.3);
            }
        }
        this.cursor = p;
        /* Newest first: the last word passed was said about `latency` ago,
           and each before it one word's length earlier — except across a
           line's first word, which takes the voice onset that began it (if
           one came after a real pause), and puts the words before it before
           that pause. */
        const estimates: number[] = new Array(passed.length);
        let t = now - this.latency;
        for (let k = passed.length - 1; k >= 0; k--) {
            const [, word] = passed[k];
            let said = t;
            let next = said - this.perWord;
            if (word === 0) {
                const onset = this.onsetNear(said);
                if (onset) {
                    said = onset.at;
                    next = onset.at - onset.silence - this.perWord;
                }
            }
            estimates[k] = said;
            t = next;
        }
        let previous = this.lastSaid();
        passed.forEach(([line, word], i) => {
            const said = Math.round(Math.min(now, Math.max(estimates[i], previous === null ? 0 : previous + 2)));
            this.said[line][word] = said;
            this.heard[line][word] = now;
            previous = said;
        });
        /* Lines the cursor has left are over. */
        for (let l = 0; l < DESK_NARRATION.length; l++) {
            if (this.ends[l] !== null) continue;
            const lastWord = DESK_NARRATION[l].words.length - 1;
            if (this.heard[l][lastWord] === null) continue;
            this.endLine(l, now, null);
        }
        this.version++;
    }

    /** Mark what is left of `line` as said by `until` and end it there. */
    private finishLine(line: number, now: number, until: number) {
        const total = DESK_NARRATION[line].words.length;
        const firstMissing = this.heard[line].findIndex((h) => h === null);
        if (firstMissing >= 0) {
            const last = this.lastSaid();
            const missing = total - firstMissing;
            const earliest = last === null ? 0 : last + 2;
            if (firstMissing === 0) {
                /* Nothing of the line was heard at all: it started about
                   one word-length per word before it ended. */
                const from = Math.max(earliest, Math.min(until, until - missing * this.perWord));
                for (let w = 0; w < total; w++) {
                    this.said[line][w] = Math.round(from + (Math.max(until, from) - from) * (w / missing));
                    this.heard[line][w] = now;
                }
            } else {
                const from = Math.max(earliest, last ?? earliest);
                for (let w = firstMissing; w < total; w++) {
                    const k = (w - firstMissing + 1) / (missing + 1);
                    this.said[line][w] = Math.round(from + (Math.max(until, from) - from) * k);
                    this.heard[line][w] = now;
                }
            }
        }
        this.endLine(line, now, until);
        /* The cursor jumps to the next line; recognition's alignment must
           restart from there, ignoring what it has already transcribed. */
        const next = line + 1 < DESK_NARRATION.length ? this.firstToken[line + 1][0] : this.tokens.length;
        this.cursor = Math.max(this.cursor, next);
        this.base = this.cursor;
        this.skip = this.lastTokens;
        this.version++;
    }

    private endLine(line: number, now: number, at: number | null) {
        const words = this.said[line];
        const last = words[words.length - 1] ?? now;
        const start = words[0] ?? last;
        const next = line + 1 < DESK_NARRATION.length ? this.said[line + 1][0] : null;
        let end = at ?? last + this.perWord;
        if (next !== null) end = Math.min(end, next - 1);
        end = Math.max(end, last + 1);
        this.ends[line] = { at: Math.round(end), heard: Math.round(Math.max(now, 0)) };
        /* The speaker's own pace, from the line just finished. */
        const n = words.length;
        if (n > 4 && end > start) this.perWord = Math.round(this.perWord * 0.6 + ((end - start) / n) * 0.4);
    }

    /** The voice onset that most plausibly began a line whose first word
     *  is estimated at `estimate` (a second before it to a second and a
     *  half after — the estimate is spaced back from recognition, and is
     *  rough; measured over 125 simulated reads, a wider early side picked
     *  onsets inside the previous line): the one after the LONGEST silence. The pause between two lines is the
     *  longest around; a pause between sentences inside a line is shorter,
     *  and picking the nearest onset instead picked those. */
    private onsetNear(estimate: number): { at: number; silence: number } | null {
        let best: { at: number; silence: number } | null = null;
        for (const o of this.onsets) {
            if (o.at < estimate - 30 || o.at > estimate + 45 || o.silence < 12) continue;
            if (!best || o.silence > best.silence) best = o;
        }
        return best;
    }

    private lastSaid(): number | null {
        let best: number | null = null;
        for (const line of this.said) for (const s of line) if (s !== null && (best === null || s > best)) best = s;
        return best;
    }
}

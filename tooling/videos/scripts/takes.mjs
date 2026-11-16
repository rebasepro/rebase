import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * THE TAKES ON DISK — what the recording page (scripts/live.mjs) and the
 * command line (scripts/assemble.ts) both read.
 *
 *   takes/<id>/live.json      what the page heard, and which lines it covers
 *   takes/<id>/props.json     the take's measured timing (scripts/take.mjs)
 *   takes/edits/<film>.json   which take serves each line ({ picks })
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TAKES = path.join(ROOT, "takes");
export const EDITS = path.join(TAKES, "edits");

/**
 * A film's processed takes, as src/spoken/production.ts's TakeInfo: each
 * line it covers, in the RECORDING's frames. props.json keeps the timing
 * relative to the take's trimmed head (startFrom); the assembler wants the
 * recording's own frames, so the head goes back on.
 */
export async function listTakes(film) {
    if (!existsSync(TAKES)) return [];
    const out = [];
    for (const id of (await readdir(TAKES)).filter((d) => /^take-\d{8}-\d{6}$/.test(d)).sort()) {
        const dir = path.join(TAKES, id);
        let live;
        let props;
        try {
            live = JSON.parse(await readFile(path.join(dir, "live.json"), "utf8"));
            props = JSON.parse(await readFile(path.join(dir, "props.json"), "utf8"));
        } catch {
            continue; /* not processed (or not finished): not a take yet */
        }
        if ((live.film ?? "desk") !== film || !props.take || !props.timing) continue;
        const startFrom = props.take.startFrom ?? 0;
        const lines = [];
        live.lines.forEach((l, k) => {
            const t = props.timing.lines[k];
            if (!t || !t.words.length) return;
            lines.push({ id: l.id, words: l.words, at: t.words.map((f) => f + startFrom), end: (t.end ?? t.words[t.words.length - 1] + 10) + startFrom });
        });
        if (!lines.length) continue;
        const summary = existsSync(path.join(dir, "summary.txt")) ? await readFile(path.join(dir, "summary.txt"), "utf8") : undefined;
        out.push({ id, film, recordedAt: live.recordedAt, src: props.take.src, frames: live.durationFrames, lines, simulated: !!live.simulated, summary });
    }
    return out;
}


/** Which take serves each line of a film. */
export async function readEdit(film) {
    const file = path.join(EDITS, `${film}.json`);
    return existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : { picks: {} };
}

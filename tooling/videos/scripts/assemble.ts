/**
 * A CUT, ASSEMBLED FROM ITS TAKES — the command-line twin of the recording
 * page's Render button.
 *
 *     pnpm assemble <film> [cut]            write the props, print the render
 *     pnpm assemble <film> [cut] --render   …and render it (1080p)
 *     pnpm assemble <film> --simulated      use the dry run's takes
 *
 * Reads every take of the film (takes/<id>/), the picks made on the page
 * (takes/edits/<film>.json), and assembles each cut exactly as the page
 * does (src/spoken/production.ts): the newest take that still reads a line's
 * words serves it, unless a pick says otherwise. Writes
 * takes/edits/<film>-<cut>.props.json for `remotion render --props`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILMS } from "../src/live/films";
import { assemble, type Edit, type TakeInfo } from "../src/spoken/production";
// @ts-expect-error — a plain .mjs module, shared with the recording page's server
import { EDITS, listTakes, readEdit } from "./takes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [filmId, cutId] = args.filter((a) => !a.startsWith("--"));

const film = FILMS.find((f) => f.id === filmId);
if (!film) {
    console.error(`usage: pnpm assemble <film> [cut] [--render] [--simulated]\nfilms: ${FILMS.map((f) => f.id).join(", ")}`);
    process.exit(2);
}
const cuts = film.cuts.filter((c) => c.assembles && (!cutId || c.id === cutId));
if (!cuts.length) {
    console.error(`${film.id}: no cut "${cutId}" that assembles. Cuts: ${film.cuts.filter((c) => c.assembles).map((c) => c.id).join(", ") || "none"}`);
    process.exit(2);
}

const all = (await listTakes(film.id)) as TakeInfo[];
const takes = all.filter((t) => !!t.simulated === flags.has("--simulated"));
const edit = (await readEdit(film.id)) as Edit;
const clock = (frames: number) => `${Math.floor(frames / 30 / 60)}:${String(Math.floor((frames / 30) % 60)).padStart(2, "0")}`;

mkdirSync(EDITS, { recursive: true });
let failed = false;
for (const cut of cuts) {
    const a = assemble(cut.script, takes, edit);
    const file = path.join("takes", "edits", `${film.id}-${cut.id}.props.json`);
    writeFileSync(path.join(ROOT, file), JSON.stringify({ timing: a.timing, clips: a.clips, take: null }, null, 1));
    const used = [...new Set(a.sources.filter(Boolean))];
    console.log(`\n${film.title} · ${cut.label}: ${clock(a.frames)}, ${a.clips.length} clip(s) from ${used.length} take(s)`);
    cut.script.forEach((l, k) => console.log(`  ${l.id.padEnd(12)} ${a.sources[k] ?? "— not recorded"}`));
    if (a.missing.length) console.log(`  ${a.missing.length} line(s) not recorded: the placeholder stands in for them.`);
    for (const comp of cut.compositions) {
        const command = ["pnpm", "exec", "remotion", "render", "src/index.ts", comp, `out/${comp}.mp4`, `--props=${file}`, "--timeout=120000"];
        console.log(`  ${command.join(" ")}${flags.has("--render") ? "" : " --scale=2"}`);
        if (flags.has("--render")) {
            const run = spawnSync(command[0], command.slice(1), { cwd: ROOT, stdio: "inherit" });
            if (run.status !== 0) failed = true;
        }
    }
}
process.exit(failed ? 1 : 0);

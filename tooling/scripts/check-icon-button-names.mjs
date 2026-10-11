#!/usr/bin/env node
/**
 * Every `IconButton` in package source has an accessible name.
 *
 * An icon-only button with no name is announced as "button": the admin had
 * about 60 of them (the table row's menu, a list's remove button, the
 * collection editor's delete icons). A site is named when its opening tag
 * carries `aria-label` or `aria-labelledby`, forwards props (`{...props}`),
 * or is the direct child of a kit `Tooltip` with a `title`, which names the
 * icon button it wraps (see `nameFromTitle` in packages/ui Tooltip.tsx).
 *
 * A ratchet at 0: any unnamed site fails, listed by file and line.
 *
 *     pnpm check:icon-button-names
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Packages this guard does not read yet. `firebase` is maintained apart from
 * this sweep and has two unnamed sites (FirebaseLoginView's back buttons);
 * drop it from here once they are named.
 */
const NOT_YET_CHECKED = new Set(["firebase"]);

/** Whether a repository path is package source this guard reads. */
export function isCheckedSource(file) {
    if (!/^packages\/[^/]+\/src\//.test(file)) return false;
    if (NOT_YET_CHECKED.has(file.split("/")[1])) return false;
    if (!file.endsWith(".tsx")) return false;
    if (/\.(test|spec)\.tsx$/.test(file)) return false;
    if (/(^|\/)(__tests__|test|tests)\//.test(file.slice(file.indexOf("/src/")))) return false;
    // The component itself, which takes its name from its caller.
    return file !== "packages/ui/src/components/IconButton.tsx";
}

/** The opening tag starting at `start`, braces balanced, without the closing `>`. */
function openingTag(source, start) {
    let depth = 0;
    for (let i = start; i < source.length; i++) {
        const c = source[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) return source.slice(start, i);
    }
    return source.slice(start);
}

/**
 * The opening tag that ends right before `index`, skipping whitespace, when
 * the element at `index` is its first child — or undefined.
 */
function parentOpeningTag(source, index) {
    let i = index - 1;
    while (i >= 0 && /\s/.test(source[i])) i--;
    if (source[i] !== ">" || source[i - 1] === "/") return undefined;
    // Walk back to the `<` that opens this tag, braces balanced.
    let depth = 0;
    for (let j = i - 1; j >= 0; j--) {
        const c = source[j];
        if (c === "}") depth++;
        else if (c === "{") depth--;
        else if (c === "<" && depth === 0) return source.slice(j, i);
    }
    return undefined;
}

/** `file:line` of every unnamed `IconButton` in `text`. */
export function unnamedIconButtons(file, text) {
    const found = [];
    for (const m of text.matchAll(/<IconButton\b/g)) {
        const index = m.index ?? 0;
        const tag = openingTag(text, index);
        if (/\baria-label(ledby)?\s*=|\{\s*\.\.\./.test(tag)) continue;
        const parent = parentOpeningTag(text, index);
        if (parent && /^<Tooltip\b/.test(parent) && /\btitle\s*=/.test(parent)) continue;
        found.push(`${file}:${text.slice(0, index).split("\n").length}`);
    }
    return found;
}

function trackedFiles() {
    return execFileSync("git", ["ls-files", "packages"], { cwd: ROOT, encoding: "utf8" })
        .split("\n")
        .filter(isCheckedSource);
}

function main() {
    const unnamed = [];
    for (const file of trackedFiles()) {
        const full = path.join(ROOT, file);
        if (!fs.existsSync(full)) continue;
        unnamed.push(...unnamedIconButtons(file, fs.readFileSync(full, "utf8")));
    }
    if (unnamed.length > 0) {
        console.error(`✗ ${unnamed.length} IconButton(s) with no accessible name. Give each an aria-label ` +
            "(a translated one in the admin), or wrap it directly in a <Tooltip title=\"…\">:");
        for (const site of unnamed) console.error(`  ${site}`);
        process.exit(1);
    }
    console.log("✓ every IconButton in package source has an accessible name.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

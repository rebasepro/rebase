/**
 * Moving a project's `@rebasepro/*` pins to one release.
 *
 * Every `@rebasepro/*` package ships at one version, and a project declares them
 * in several `package.json` files — the root, `backend/`, `frontend/`,
 * `config/`, and whatever else the repository holds. Bumping them by hand means
 * finding every one, keeping each range's `^` or `~`, and noticing the override
 * that quietly wins over all of them. `rebase upgrade` is that job, done the same
 * way every time; the control plane runs it too, when it rebuilds a managed
 * project on a newer release.
 *
 * Everything here is pure file work, so it can be tested against a temporary
 * directory: which specs move, the rewrite itself, and what overrides say. The
 * command in `commands/upgrade.ts` adds the registry lookup, the install and the
 * printing.
 *
 * ## The rewrite is textual
 *
 * A `package.json` is authored. Parsing it and writing `JSON.stringify` back
 * reformats the file, reorders nothing but reindents everything, and drops a
 * trailing newline or a two-space indent somebody chose — a one-line version
 * bump that arrives as a whole-file diff. So the file is scanned for the exact
 * byte range of each value, only those bytes are replaced, and the result is
 * parsed again and compared against what was intended. A file whose rewrite
 * does not parse back to exactly the intended values is not written.
 */
import fs from "fs";
import path from "path";
import { isDeepStrictEqual } from "util";
import { getPMCommands } from "./utils/package-manager";

/** The dependency blocks a pin is moved in. `peerDependencies` is not one. */
export const PIN_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"] as const;
export type PinField = typeof PIN_FIELDS[number];

/** Every framework package lives under this scope. */
export const FRAMEWORK_SCOPE = "@rebasepro/";

/** The package whose published versions stand for the release as a whole. */
export const RELEASE_PACKAGE = "@rebasepro/cli";

/** `MAJOR.MINOR.PATCH`, with an optional prerelease and build, and nothing else. */
const SEMVER =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Whether `value` is one exact version — `0.21.0`, `0.21.1-canary.g8c5a265`. */
export function isExactVersion(value: string): boolean {
    return SEMVER.test(value);
}

/** An error that carries the `--json` envelope's code and a remedy. */
export class UpgradeError extends Error {
    constructor(message: string, readonly code: string, readonly hint?: string) {
        super(message);
        this.name = "UpgradeError";
    }
}

/* ─── which specs move ─────────────────────────────────────────────────────── */

export type SpecClass =
    /** A plain version, optionally `^` or `~`: moved, keeping the prefix. */
    | { kind: "movable"; prefix: "" | "^" | "~"; version: string }
    /** A path on this machine. As a pin it is left alone; as an override it wins over every pin. */
    | { kind: "local"; protocol: "link:" | "file:" | "portal:" }
    /** Anything else, with the reason it is left alone. */
    | { kind: "other"; reason: string };

/**
 * What a dependency spec is, as far as moving it goes.
 *
 * Only a plain version is moved, because only a plain version has an obvious
 * answer: `^0.19.1` becomes `^0.21.0`. A `>=` floor, a `||` union or a partial
 * `^0.19` could each be rewritten several ways, and a tag or a workspace link
 * already means something other than "this release" — so each is reported with
 * its reason and left as written.
 */
export function classifySpec(spec: string): SpecClass {
    const movable = /^([\^~]?)(.+)$/.exec(spec);
    if (movable && isExactVersion(movable[2])) {
        return { kind: "movable", prefix: movable[1] as "" | "^" | "~", version: movable[2] };
    }
    for (const protocol of ["link:", "file:", "portal:"] as const) {
        if (spec.startsWith(protocol)) return { kind: "local", protocol };
    }
    return { kind: "other", reason: otherReason(spec) };
}

function otherReason(spec: string): string {
    const trimmed = spec.trim();
    if (trimmed.startsWith("workspace:")) return "a workspace: link, resolved inside this repository rather than from the registry";
    if (trimmed.startsWith("npm:")) return "an npm: alias; move the aliased version by hand";
    if (/^(git\+|git:|github:|gitlab:|bitbucket:|git@)/.test(trimmed) || /^https?:\/\//.test(trimmed)) {
        return "a git or URL dependency, not a registry version";
    }
    if (trimmed === "" || trimmed === "*" || /^[xX]$/.test(trimmed)) return "a wildcard, which already takes whatever the registry has";
    if (trimmed.includes("||")) return "a union of ranges, with no single version to move";
    if (/^[<>=]/.test(trimmed) || /\s-\s/.test(trimmed)) return "a comparator range, with no single version to move";
    if (/^[\^~]?v?\d/.test(trimmed)) return "not a plain MAJOR.MINOR.PATCH version";
    return "a dist-tag, not a version";
}

/**
 * The `@rebasepro/*` package an override key targets, or null.
 *
 * pnpm and npm key an override by name, optionally narrowed: `@rebasepro/x@<1`,
 * `parent>@rebasepro/x`; yarn's `resolutions` by a path, `**\/@rebasepro/x`. The
 * target is the last segment either way.
 */
export function overrideTarget(key: string): string | null {
    const match = /(?:^|[/>])(@rebasepro\/[^/@>\s]+)(?:@[^/>]*)?$/.exec(key);
    return match ? match[1] : null;
}

/* ─── finding the files ────────────────────────────────────────────────────── */

export interface ProjectFiles {
    /** Absolute paths, in a stable order. */
    packageJsons: string[];
    workspaceYamls: string[];
}

/**
 * Directories the walk never enters: installed packages, build output (`dist`,
 * `dist-bundle`, `dist-bundle-admin`, …) and anything hidden (`.git`,
 * `.rebase`, an editor's worktrees). None of them hold a manifest anybody
 * authored for this project, and `dist-bundle/package.json` in particular is a
 * generated copy that `rebase build` rewrites anyway.
 */
function skipDirectory(name: string): boolean {
    return name === "node_modules" || name.startsWith("dist") || name.startsWith(".");
}

/** Every `package.json` and `pnpm-workspace.yaml` under the project root. */
export function discoverProjectFiles(projectRoot: string): ProjectFiles {
    const found: ProjectFiles = { packageJsons: [], workspaceYamls: [] };
    const walk = (dir: string): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            // `isDirectory()` is false for a symlink, so a linked workspace
            // package is not walked twice and a cycle cannot form.
            if (entry.isDirectory()) {
                if (!skipDirectory(entry.name)) walk(full);
            } else if (entry.isFile()) {
                if (entry.name === "package.json") found.packageJsons.push(full);
                else if (entry.name === "pnpm-workspace.yaml") found.workspaceYamls.push(full);
            }
        }
    };
    walk(projectRoot);
    return found;
}

/* ─── the result ───────────────────────────────────────────────────────────── */

export interface ChangedPin {
    /** Relative to the project root, POSIX separators. */
    file: string;
    name: string;
    field: PinField;
    from: string;
    to: string;
}

export interface SkippedSpec {
    file: string;
    name: string;
    /** A dependency block, or the override block the entry sits in. */
    field: string;
    spec: string;
    reason: string;
}

export type OverrideAction = "bumped" | "kept-local" | "removed-local";

export interface OverrideFinding {
    file: string;
    /** The override key as written — `@rebasepro/types`, or a narrowed one. */
    name: string;
    spec: string;
    action: OverrideAction;
    /** The new value, for a bumped override. */
    to?: string;
}

export interface UnreadableFile {
    file: string;
    reason: string;
}

export interface UpgradePlan {
    target: string;
    changed: ChangedPin[];
    skipped: SkippedSpec[];
    overrides: OverrideFinding[];
    unreadable: UnreadableFile[];
    /** The files whose content changes, with the new content. */
    writes: Array<{ file: string; absolute: string; content: string }>;
}

export interface PlanOptions {
    /** Remove `link:`/`file:` overrides of framework packages instead of reporting them. */
    dropLocalOverrides?: boolean;
}

/** Project-relative, POSIX. What every file path in the output looks like. */
function relativeTo(projectRoot: string, absolute: string): string {
    return path.relative(projectRoot, absolute).split(path.sep).join("/");
}

/**
 * Work out every change the upgrade makes, without writing anything.
 *
 * `--dry-run` prints this; a real run writes `writes` and nothing else.
 */
export function planUpgrade(projectRoot: string, target: string, options: PlanOptions = {}): UpgradePlan {
    if (!isExactVersion(target)) {
        throw new UpgradeError(`"${target}" is not an exact version.`, "target_invalid");
    }
    const plan: UpgradePlan = { target, changed: [], skipped: [], overrides: [], unreadable: [], writes: [] };
    const files = discoverProjectFiles(projectRoot);

    for (const absolute of files.packageJsons) {
        const file = relativeTo(projectRoot, absolute);
        const original = fs.readFileSync(absolute, "utf8");
        const content = planPackageJson(file, original, target, options, plan);
        if (content !== null && content !== original) plan.writes.push({ file, absolute, content });
    }

    for (const absolute of files.workspaceYamls) {
        const file = relativeTo(projectRoot, absolute);
        const original = fs.readFileSync(absolute, "utf8");
        const content = planWorkspaceYaml(file, original, target, options, plan);
        if (content !== original) plan.writes.push({ file, absolute, content });
    }

    return plan;
}

/** Write what the plan changes. Nothing else on disk is touched. */
export function applyUpgradePlan(plan: UpgradePlan): void {
    for (const write of plan.writes) fs.writeFileSync(write.absolute, write.content, "utf8");
}

/* ─── package.json ─────────────────────────────────────────────────────────── */

/** Override blocks in a `package.json`, as paths from the root object. */
const JSON_OVERRIDE_BLOCKS: ReadonlyArray<readonly string[]> = [["pnpm", "overrides"], ["overrides"], ["resolutions"]];

function planPackageJson(
    file: string,
    original: string,
    target: string,
    options: PlanOptions,
    plan: UpgradePlan
): string | null {
    const bom = original.startsWith("﻿") ? "﻿" : "";
    const text = original.slice(bom.length);

    let parsed: unknown;
    let tree: JsonNode;
    try {
        parsed = JSON.parse(text);
        tree = scanJson(text);
    } catch (err) {
        plan.unreadable.push({ file, reason: `not valid JSON: ${err instanceof Error ? err.message : String(err)}` });
        return null;
    }
    if (!isRecord(parsed) || tree.kind !== "object") {
        plan.unreadable.push({ file, reason: "not a JSON object" });
        return null;
    }

    const expected = structuredClone(parsed);
    const edits: TextEdit[] = [];
    /** Override members to remove, as [block path, key]. */
    const removals: Array<[readonly string[], string]> = [];

    for (const field of PIN_FIELDS) {
        const block = memberValue(tree, [field]);
        if (block?.kind !== "object") continue;
        for (const member of block.members) {
            if (!member.key.startsWith(FRAMEWORK_SCOPE)) continue;
            if (member.value.kind !== "string") {
                plan.skipped.push({ file, name: member.key, field, spec: text.slice(member.value.start, member.value.end), reason: "not a string" });
                continue;
            }
            const spec = member.value.value;
            const cls = classifySpec(spec);
            if (cls.kind === "movable") {
                const to = `${cls.prefix}${target}`;
                if (to === spec) continue;
                edits.push({ start: member.value.start, end: member.value.end, replacement: JSON.stringify(to) });
                setPath(expected, [field, member.key], to);
                plan.changed.push({ file, name: member.key, field, from: spec, to });
            } else {
                const reason = cls.kind === "local"
                    ? `a local ${cls.protocol} path, which points at a checkout on this machine rather than a release`
                    : cls.reason;
                plan.skipped.push({ file, name: member.key, field, spec, reason });
            }
        }
    }

    for (const blockPath of JSON_OVERRIDE_BLOCKS) {
        const block = memberValue(tree, blockPath);
        if (block?.kind !== "object") continue;
        const field = blockPath.join(".");
        for (const member of block.members) {
            if (!overrideTarget(member.key)) continue;
            if (member.value.kind !== "string") {
                plan.skipped.push({
                    file,
                    name: member.key,
                    field,
                    spec: text.slice(member.value.start, member.value.end),
                    reason: "a nested override, which has no single version to move; edit it by hand"
                });
                continue;
            }
            const spec = member.value.value;
            const cls = classifySpec(spec);
            if (cls.kind === "movable") {
                const to = `${cls.prefix}${target}`;
                if (to === spec) continue;
                edits.push({ start: member.value.start, end: member.value.end, replacement: JSON.stringify(to) });
                setPath(expected, [...blockPath, member.key], to);
                plan.overrides.push({ file, name: member.key, spec, action: "bumped", to });
            } else if (cls.kind === "local") {
                if (options.dropLocalOverrides) {
                    removals.push([blockPath, member.key]);
                    deletePath(expected, [...blockPath, member.key]);
                    plan.overrides.push({ file, name: member.key, spec, action: "removed-local" });
                } else {
                    plan.overrides.push({ file, name: member.key, spec, action: "kept-local" });
                }
            } else {
                plan.skipped.push({ file, name: member.key, field, spec, reason: cls.reason });
            }
        }
    }

    if (edits.length === 0 && removals.length === 0) return original;

    let next = applyEdits(text, edits);
    for (const [blockPath, key] of removals) {
        next = removeJsonMember(next, blockPath, key);
    }
    // An override block that only held local links is removed with them, and
    // `pnpm` with it when nothing else was in it — an empty `{}` left behind is
    // a line of diff that says nothing.
    for (const blockPath of JSON_OVERRIDE_BLOCKS) {
        if (!removals.some(([removedFrom]) => removedFrom === blockPath)) continue;
        for (let depth = blockPath.length; depth > 0; depth--) {
            const containerPath = blockPath.slice(0, depth);
            const node = memberValue(scanJson(next), containerPath);
            if (node?.kind !== "object" || node.members.length > 0) break;
            next = removeJsonMember(next, containerPath.slice(0, -1), containerPath[containerPath.length - 1]);
            deletePath(expected, containerPath);
        }
    }

    // The rewrite is only kept if it says exactly what was meant — every value
    // that was supposed to change, and nothing else.
    let reparsed: unknown;
    try {
        reparsed = JSON.parse(next);
    } catch {
        reparsed = undefined;
    }
    if (!isDeepStrictEqual(reparsed, expected)) {
        throw new UpgradeError(
            `Could not rewrite ${file} without disturbing it; nothing was written.`,
            "rewrite_failed",
            "Move its @rebasepro versions by hand, then run `rebase upgrade` again."
        );
    }
    return bom + next;
}

/* ─── a JSON scanner that keeps byte offsets ───────────────────────────────── */

interface JsonMember {
    key: string;
    keyStart: number;
    value: JsonNode;
}

type JsonNode =
    | { kind: "object"; start: number; end: number; members: JsonMember[] }
    | { kind: "array"; start: number; end: number }
    | { kind: "string"; start: number; end: number; value: string }
    | { kind: "scalar"; start: number; end: number };

/**
 * The structure of a JSON document, with where each value starts and ends.
 *
 * `JSON.parse` answers what a file says; this answers where it says it, which is
 * what a rewrite that leaves every other byte alone needs. Throws on anything
 * that is not JSON — callers have already parsed the same text, so that never
 * happens in practice.
 */
function scanJson(text: string): JsonNode {
    let i = 0;
    const WHITESPACE = " \t\n\r";
    const skipWhitespace = (): void => {
        while (i < text.length && WHITESPACE.includes(text[i])) i++;
    };
    const unexpected = (): never => {
        throw new Error(`unexpected ${i < text.length ? `"${text[i]}"` : "end of input"} at offset ${i}`);
    };
    const readString = (): { kind: "string"; start: number; end: number; value: string } => {
        const start = i;
        if (text[i] !== "\"") unexpected();
        i++;
        while (i < text.length && text[i] !== "\"") i += text[i] === "\\" ? 2 : 1;
        if (i >= text.length) unexpected();
        i++;
        return { kind: "string", start, end: i, value: JSON.parse(text.slice(start, i)) as string };
    };
    const readValue = (): JsonNode => {
        skipWhitespace();
        const start = i;
        if (text[i] === "{") {
            i++;
            const members: JsonMember[] = [];
            skipWhitespace();
            if (text[i] === "}") {
                i++;
                return { kind: "object", start, end: i, members };
            }
            for (;;) {
                skipWhitespace();
                const key = readString();
                skipWhitespace();
                if (text[i] !== ":") unexpected();
                i++;
                members.push({ key: key.value, keyStart: key.start, value: readValue() });
                skipWhitespace();
                if (text[i] === ",") {
                    i++;
                    continue;
                }
                if (text[i] === "}") {
                    i++;
                    return { kind: "object", start, end: i, members };
                }
                unexpected();
            }
        }
        if (text[i] === "[") {
            i++;
            skipWhitespace();
            if (text[i] === "]") {
                i++;
                return { kind: "array", start, end: i };
            }
            for (;;) {
                readValue();
                skipWhitespace();
                if (text[i] === ",") {
                    i++;
                    continue;
                }
                if (text[i] === "]") {
                    i++;
                    return { kind: "array", start, end: i };
                }
                unexpected();
            }
        }
        if (text[i] === "\"") return readString();
        while (i < text.length && !",:{}[]\"".includes(text[i]) && !WHITESPACE.includes(text[i])) i++;
        if (i === start) unexpected();
        return { kind: "scalar", start, end: i };
    };
    const root = readValue();
    skipWhitespace();
    if (i !== text.length) unexpected();
    return root;
}

/** The value at a path of object keys, or undefined. The last duplicate wins, as in `JSON.parse`. */
function memberValue(root: JsonNode, keys: readonly string[]): JsonNode | undefined {
    let node: JsonNode | undefined = root;
    for (const key of keys) {
        if (node?.kind !== "object") return undefined;
        const members: JsonMember[] = node.members.filter(m => m.key === key);
        node = members[members.length - 1]?.value;
    }
    return node;
}

interface TextEdit {
    start: number;
    end: number;
    replacement: string;
}

/** Apply non-overlapping edits, last first so the earlier offsets stay valid. */
function applyEdits(text: string, edits: TextEdit[]): string {
    let out = text;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
        out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
    }
    return out;
}

/**
 * Remove one member from the object at `objectPath`, taking its comma with it.
 *
 * Rescans rather than trusting offsets from before an earlier edit. A middle or
 * first member takes everything up to the next key, so the next member inherits
 * its indentation; the last takes the comma and whitespace after the previous
 * value, so the closing brace keeps its line; an only member leaves `{}`.
 */
function removeJsonMember(text: string, objectPath: readonly string[], key: string): string {
    const container = memberValue(scanJson(text), objectPath);
    if (container?.kind !== "object") return text;
    const index = container.members.findIndex(m => m.key === key);
    if (index === -1) return text;
    const members = container.members;
    const member = members[index];
    if (members.length === 1) {
        return text.slice(0, container.start + 1) + text.slice(container.end - 1);
    }
    if (index < members.length - 1) {
        return text.slice(0, member.keyStart) + text.slice(members[index + 1].keyStart);
    }
    return text.slice(0, members[index - 1].value.end) + text.slice(member.value.end);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setPath(root: Record<string, unknown>, keys: string[], value: unknown): void {
    let node: Record<string, unknown> = root;
    for (const key of keys.slice(0, -1)) {
        const next = node[key];
        if (!isRecord(next)) return;
        node = next;
    }
    node[keys[keys.length - 1]] = value;
}

function deletePath(root: Record<string, unknown>, keys: readonly string[]): void {
    let node: Record<string, unknown> = root;
    for (const key of keys.slice(0, -1)) {
        const next = node[key];
        if (!isRecord(next)) return;
        node = next;
    }
    delete node[keys[keys.length - 1]];
}

/* ─── pnpm-workspace.yaml ──────────────────────────────────────────────────── */

interface YamlOverride {
    /** Index into the file's lines. */
    line: number;
    key: string;
    value: string;
    /** Where the value's text sits within the line, quotes excluded. */
    valueStart: number;
    valueEnd: number;
}

interface YamlOverridesBlock {
    /** The `overrides:` line. */
    keyLine: number;
    /** The block's lines, `keyLine` excluded: indented, blank or comment-only. */
    lines: number[];
    entries: YamlOverride[];
    /** Lines in the block that are neither an entry, nor blank, nor a comment. */
    otherContent: number;
}

/** Lines, each without its `\r`, and whether the file used them. */
function splitLines(text: string): string[] {
    return text.split("\n").map(line => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

/**
 * A YAML scalar at the start of `rest`: its text, and where that text sits.
 *
 * Double- and single-quoted and plain scalars, which is every shape an override
 * value is written in. A double-quoted one with an escape in it is refused
 * rather than decoded: no version or path needs one, and getting the decoding
 * wrong would rewrite a value this does not understand.
 */
function readYamlScalar(rest: string): { value: string; start: number; end: number } | null {
    if (rest.startsWith("\"")) {
        const close = rest.indexOf("\"", 1);
        if (close === -1 || rest.slice(1, close).includes("\\")) return null;
        if (!/^\s*(#.*)?$/.test(rest.slice(close + 1))) return null;
        return { value: rest.slice(1, close), start: 1, end: close };
    }
    if (rest.startsWith("'")) {
        const close = rest.indexOf("'", 1);
        if (close === -1 || rest[close + 1] === "'") return null;
        if (!/^\s*(#.*)?$/.test(rest.slice(close + 1))) return null;
        return { value: rest.slice(1, close), start: 1, end: close };
    }
    const comment = rest.search(/\s#/);
    const plain = (comment === -1 ? rest : rest.slice(0, comment)).trimEnd();
    if (plain === "" || /^[[{&*!|>%@`]/.test(plain)) return null;
    return { value: plain, start: 0, end: plain.length };
}

/**
 * The top-level `overrides:` block of a `pnpm-workspace.yaml`, read line by line.
 *
 * Deliberately narrow. The file is YAML, and the CLI carries no YAML parser; the
 * shape pnpm documents and every project writes is a block mapping of one
 * scalar per line, which a line reader handles exactly. Anything else in the
 * block is counted rather than guessed at, and an inline `overrides: { … }` is
 * reported as not handled.
 */
function readYamlOverrides(lines: string[]): YamlOverridesBlock | null {
    const keyLine = lines.findIndex(line => /^overrides:\s*(#.*)?$/.test(line));
    if (keyLine === -1) return null;

    const block: YamlOverridesBlock = { keyLine, lines: [], entries: [], otherContent: 0 };
    for (let index = keyLine + 1; index < lines.length; index++) {
        const line = lines[index];
        if (line.trim() !== "" && !/^\s/.test(line) && !line.startsWith("#")) break;
        block.lines.push(index);
        if (line.trim() === "" || /^\s*#/.test(line)) continue;

        const entry = /^(\s+)("[^"]*"|'[^']*'|[^\s"'#][^:#]*?)\s*:(\s+|$)/.exec(line);
        const valueOffset = entry ? entry[0].length : -1;
        const scalar = entry ? readYamlScalar(line.slice(valueOffset)) : null;
        if (!entry || !scalar) {
            block.otherContent++;
            continue;
        }
        const rawKey = entry[2];
        const key = /^["']/.test(rawKey) ? rawKey.slice(1, -1) : rawKey;
        block.entries.push({
            line: index,
            key,
            value: scalar.value,
            valueStart: valueOffset + scalar.start,
            valueEnd: valueOffset + scalar.end
        });
    }
    return block;
}

function planWorkspaceYaml(
    file: string,
    original: string,
    target: string,
    options: PlanOptions,
    plan: UpgradePlan
): string {
    const lines = splitLines(original);
    const crlf = original.includes("\r\n");
    const block = readYamlOverrides(lines);

    if (!block) {
        const inline = lines.find(line => /^overrides:\s*[^\s#]/.test(line));
        if (inline && inline.includes(FRAMEWORK_SCOPE)) {
            plan.skipped.push({
                file,
                name: "overrides",
                field: "overrides",
                spec: inline.slice("overrides:".length).trim(),
                reason: "an inline overrides map, which this does not rewrite; write it as a block, or edit it by hand"
            });
        }
        return original;
    }

    const next = [...lines];
    const removed = new Set<number>();
    const expected = new Map<string, string>();

    for (const entry of block.entries) {
        if (!overrideTarget(entry.key)) {
            expected.set(entry.key, entry.value);
            continue;
        }
        const cls = classifySpec(entry.value);
        if (cls.kind === "movable") {
            const to = `${cls.prefix}${target}`;
            expected.set(entry.key, to);
            if (to === entry.value) continue;
            const line = lines[entry.line];
            next[entry.line] = line.slice(0, entry.valueStart) + to + line.slice(entry.valueEnd);
            plan.overrides.push({ file, name: entry.key, spec: entry.value, action: "bumped", to });
        } else if (cls.kind === "local") {
            if (options.dropLocalOverrides) {
                removed.add(entry.line);
                plan.overrides.push({ file, name: entry.key, spec: entry.value, action: "removed-local" });
            } else {
                expected.set(entry.key, entry.value);
                plan.overrides.push({ file, name: entry.key, spec: entry.value, action: "kept-local" });
            }
        } else {
            expected.set(entry.key, entry.value);
            plan.skipped.push({ file, name: entry.key, field: "overrides", spec: entry.value, reason: cls.reason });
        }
    }

    // A block the removals emptied goes too, key line included: `overrides:`
    // with nothing under it is `overrides: null`, which pnpm reads as a value.
    const survivors = block.entries.filter(entry => !removed.has(entry.line)).length + block.otherContent;
    if (removed.size > 0 && survivors === 0) removed.add(block.keyLine);

    const kept = next.filter((_, index) => !removed.has(index));
    const content = kept.join(crlf ? "\r\n" : "\n");

    // Read back with the same reader, and hold it to what was meant: the same
    // entries, in the same order, with only the intended values changed, and
    // every line outside the block untouched.
    const after = readYamlOverrides(splitLines(content));
    const afterEntries = after ? after.entries.map(e => [e.key, e.value]) : [];
    if (!isDeepStrictEqual(afterEntries, [...expected.entries()])) {
        throw new UpgradeError(
            `Could not rewrite ${file} without disturbing it; nothing was written.`,
            "rewrite_failed",
            "Move its @rebasepro overrides by hand, then run `rebase upgrade` again."
        );
    }
    return content;
}

/* ─── the install ──────────────────────────────────────────────────────────── */

export type Installer = "pnpm" | "npm" | "yarn" | "bun";

/** Lockfiles, in the order they are looked for in each directory. */
const LOCKFILES: ReadonlyArray<[string, Installer]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"]
];

/**
 * The package manager this project installs with, from what is on disk.
 *
 * A lockfile is the project's own statement, so it wins. The search starts at
 * the project root and walks up, because a project inside a workspace has its
 * lockfile at the workspace root; it stops at the repository's root, so a stray
 * lockfile in a home directory is never read as this project's choice. With no
 * lockfile anywhere, a `pnpm-workspace.yaml` still says pnpm; otherwise npm,
 * the one every Node install has.
 */
export function detectInstaller(projectRoot: string): Installer {
    let dir = path.resolve(projectRoot);
    let workspaceYaml = false;
    for (;;) {
        for (const [lockfile, installer] of LOCKFILES) {
            if (fs.existsSync(path.join(dir, lockfile))) return installer;
        }
        if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) workspaceYaml = true;
        const parent = path.dirname(dir);
        if (parent === dir || fs.existsSync(path.join(dir, ".git"))) break;
        dir = parent;
    }
    return workspaceYaml ? "pnpm" : "npm";
}

/**
 * The install command for each package manager — pnpm's and npm's from the
 * helpers every other command uses, yarn's and bun's spelled the same way.
 */
export function installCommand(installer: Installer): [string, string[]] {
    const [bin, ...args] = installer === "pnpm" || installer === "npm"
        ? getPMCommands(installer).install
        : [installer, "install"];
    return [bin, args];
}

/* ─── the target ───────────────────────────────────────────────────────────── */

/**
 * The exact version `--to` names.
 *
 * An exact version is used as written, with no network call: the control plane
 * passes one when it rebuilds a project, and that rebuild must not depend on a
 * registry lookup succeeding for anything but the install itself. Anything
 * else is a dist-tag, asked of the registry through `npmView` — which runs npm
 * in the project, so its `.npmrc` and the user's registry config apply.
 */
export async function resolveTarget(
    requested: string,
    npmView: (spec: string) => Promise<string>
): Promise<string> {
    const trimmed = requested.trim();
    const bare = trimmed.replace(/^v(?=\d)/, "");
    if (isExactVersion(bare)) return bare;

    if (!/^[A-Za-z][\w.-]*$/.test(trimmed)) {
        throw new UpgradeError(
            `"${requested}" is neither an exact version nor a dist-tag.`,
            "target_invalid",
            "Pass an exact version such as 0.21.0, or a dist-tag such as latest or canary."
        );
    }

    let answer: string;
    try {
        answer = (await npmView(`${RELEASE_PACKAGE}@${trimmed}`)).trim();
    } catch (err) {
        const detail = err instanceof Error ? firstLine(err.message) : String(err);
        throw new UpgradeError(
            `Could not resolve "${trimmed}" on the npm registry${detail ? `: ${detail}` : "."}`,
            "target_unresolved",
            "Check the tag and your registry access, or pass an exact version with --to."
        );
    }
    if (!isExactVersion(answer)) {
        throw new UpgradeError(
            `The registry has no single version for ${RELEASE_PACKAGE}@${trimmed}` +
                `${answer ? ` (it answered "${firstLine(answer)}")` : ""}.`,
            "target_unresolved",
            "Check the tag, or pass an exact version with --to."
        );
    }
    return answer;
}

function firstLine(text: string): string {
    return text.split("\n").map(line => line.trim()).filter(Boolean)[0] ?? "";
}

/**
 * Whether moving from `from` to `to` goes backwards, for the one-word note the
 * summary prints. Prerelease identifiers compare as SemVer orders them: a
 * release outranks its own prereleases.
 */
export function isDowngrade(from: string, to: string): boolean {
    const a = SEMVER.exec(from.replace(/^[\^~]/, ""));
    const b = SEMVER.exec(to.replace(/^[\^~]/, ""));
    if (!a || !b) return false;
    for (let i = 1; i <= 3; i++) {
        const diff = Number(a[i]) - Number(b[i]);
        if (diff !== 0) return diff > 0;
    }
    const preA = a[4];
    const preB = b[4];
    if (preA === preB) return false;
    if (preA === undefined) return true;
    if (preB === undefined) return false;
    const partsA = preA.split(".");
    const partsB = preB.split(".");
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const x = partsA[i];
        const y = partsB[i];
        if (x === undefined) return false;
        if (y === undefined) return true;
        if (x === y) continue;
        const nx = /^\d+$/.test(x) ? Number(x) : NaN;
        const ny = /^\d+$/.test(y) ? Number(y) : NaN;
        if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx > ny;
        if (!Number.isNaN(nx)) return false;
        if (!Number.isNaN(ny)) return true;
        return x > y;
    }
    return false;
}

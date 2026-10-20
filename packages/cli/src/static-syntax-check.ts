/**
 * A syntax check over a static app's built output, run before it is deployed.
 *
 * Why it exists: a static app's files are served exactly as they are. A project
 * whose "build" only copies hand-written `.js` into the output folder (no
 * bundler, so nothing ever parsed them) deployed a file with a syntax error.
 * The deploy succeeded, because nothing on the way checks JavaScript, and the
 * live page died on load. Its developer's fix was to run `node --check` before
 * every deploy. This does the same job, for every file, before anything is
 * uploaded.
 *
 * What is checked:
 *   - every `.js`, `.mjs` and `.cjs` file under the output directory;
 *   - every inline `<script>` in an `.html`/`.htm` file that a browser would
 *     run as JavaScript: no `type`, a JavaScript MIME type, or `module`.
 *     JSON, import maps, templates and any other `type` are left alone, and so
 *     is a `<script src>`, whose body a browser ignores.
 *
 * Parsing uses acorn rather than `vm.Script`: V8's module parser reports
 * no position, and a check that says "somewhere in this file" is not much help.
 *
 * Pure apart from reading the directory, so the deploy decides what a failure
 * means and the tests can drive it with a fixture.
 */
import fs from "fs";
import path from "path";
import { parse, type Options } from "acorn";

/** One syntax error, located the way an editor wants it: 1-based line and column. */
export interface StaticSyntaxError {
    /** The file, relative to the directory the caller asked to show paths from. */
    file: string;
    line: number;
    column: number;
    message: string;
    /** The offending source line, trimmed to something printable. */
    excerpt?: string;
}

export interface StaticSyntaxReport {
    /** JavaScript files plus inline scripts parsed. */
    checked: number;
    errors: StaticSyntaxError[];
}

/** How a source is run: a classic script, a module, or unknown (a `.js` file). */
export type ScriptKind = "script" | "module" | "auto";

const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);

/** The `type` values the HTML spec runs as a classic script. */
const CLASSIC_SCRIPT_TYPES = new Set([
    "",
    "text/javascript",
    "application/javascript",
    "application/ecmascript",
    "application/x-ecmascript",
    "application/x-javascript",
    "text/ecmascript",
    "text/javascript1.0",
    "text/javascript1.1",
    "text/javascript1.2",
    "text/javascript1.3",
    "text/javascript1.4",
    "text/javascript1.5",
    "text/jscript",
    "text/livescript",
    "text/x-ecmascript",
    "text/x-javascript"
]);

interface ParseFailure {
    line: number;
    /** 0-based, as acorn reports it. */
    column: number;
    /** Offset into the source, used to pick the more informative of two parses. */
    pos: number;
    message: string;
}

function tryParse(source: string, options: Options): ParseFailure | null {
    try {
        parse(source, options);
        return null;
    } catch (err) {
        if (!(err instanceof SyntaxError)) throw err;
        // acorn's SyntaxError carries `loc` and `pos` beside the message.
        const loc = "loc" in err && typeof err.loc === "object" && err.loc !== null ? err.loc : undefined;
        const line = loc && "line" in loc && typeof loc.line === "number" ? loc.line : 1;
        const column = loc && "column" in loc && typeof loc.column === "number" ? loc.column : 0;
        return {
            line,
            column,
            pos: "pos" in err && typeof err.pos === "number" ? err.pos : 0,
            // acorn appends " (line:column)"; the caller prints its own.
            message: err.message.replace(/\s*\(\d+:\d+\)$/, "")
        };
    }
}

/**
 * Parse one source and return its first syntax error, or null.
 *
 * A `.js` file can be loaded either way — `<script src>` runs it as a classic
 * script, `<script type="module">` or an `import` as a module — and each mode
 * rejects code the other accepts (`import` in a script, `with` in a module).
 * So `auto` accepts a source that parses either way, and when neither does,
 * reports the parse that got further: that is the one that tripped over the
 * actual mistake rather than over the choice of mode.
 */
export function findSyntaxError(source: string, kind: ScriptKind, cjs = false): ParseFailure | null {
    const base: Options = { ecmaVersion: "latest",
locations: true,
allowHashBang: true };
    const asScript = (): ParseFailure | null => tryParse(source, {
        ...base,
        sourceType: "script",
        allowReturnOutsideFunction: cjs
    });
    const asModule = (): ParseFailure | null => tryParse(source, { ...base,
sourceType: "module" });

    if (kind === "script") return asScript();
    if (kind === "module") return asModule();

    const script = asScript();
    if (!script) return null;
    const module = asModule();
    if (!module) return null;
    return module.pos > script.pos ? module : script;
}

/** An inline script found in an HTML document, positioned in that document. */
export interface InlineScript {
    source: string;
    kind: "script" | "module";
    /** 1-based line of the script body's first character. */
    line: number;
    /** 0-based column of that character. */
    column: number;
}

function attribute(attrs: string, name: string): string | undefined {
    const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
    if (!match) return undefined;
    return match[1] ?? match[2] ?? match[3] ?? "";
}

function hasAttribute(attrs: string, name: string): boolean {
    return new RegExp(`(?:^|\\s)${name}(?:\\s*=|\\s|$)`, "i").test(attrs);
}

/**
 * The inline scripts of an HTML document that a browser would run as
 * JavaScript, each with the position its body starts at.
 *
 * HTML comments are blanked first, keeping every newline, so a commented-out
 * `<script>` is not checked and the line numbers of everything after it are
 * still right.
 */
export function inlineScripts(html: string): InlineScript[] {
    const uncommented = html.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));
    const scripts: InlineScript[] = [];
    const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    for (const match of uncommented.matchAll(pattern)) {
        const attrs = match[1];
        const body = match[2];
        if (hasAttribute(attrs, "src")) continue;
        if (body.trim() === "") continue;

        const type = (attribute(attrs, "type") ?? "").trim().toLowerCase();
        let kind: InlineScript["kind"];
        if (type === "module") kind = "module";
        else if (CLASSIC_SCRIPT_TYPES.has(type)) kind = "script";
        else continue; // JSON, importmap, a template, or anything else a browser does not run.

        const bodyStart = (match.index ?? 0) + match[0].indexOf(">") + 1;
        const before = uncommented.slice(0, bodyStart);
        const line = before.split("\n").length;
        const column = bodyStart - (before.lastIndexOf("\n") + 1);
        scripts.push({ source: body,
kind,
line,
column });
    }
    return scripts;
}

/** Markup a server-side template leaves in a script it has not rendered yet. */
const TEMPLATE_MARKERS = /\{\{|\{%|<%|<\?/;

function excerptOf(source: string, line: number, column: number): string | undefined {
    const text = source.split("\n")[line - 1];
    if (text === undefined) return undefined;
    const clean = text.replace(/\t/g, " ").replace(/\r$/, "");
    // A minified bundle is one line of megabytes: show the neighbourhood.
    if (clean.length <= 120) return clean.trimEnd();
    const start = Math.max(0, column - 60);
    return `${start > 0 ? "…" : ""}${clean.slice(start, start + 120)}…`;
}

function walk(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules") continue;
            walk(full, out);
        } else if (entry.isFile()) {
            out.push(full);
        }
    }
}

/**
 * Parse every JavaScript file and inline script under `dir`.
 *
 * `displayRoot` is what reported paths are relative to: the project root, so
 * an error reads `web/cloud.js:42:7` and can be opened as written.
 */
export function checkStaticSyntax(dir: string, displayRoot: string = dir): StaticSyntaxReport {
    const files: string[] = [];
    walk(dir, files);
    files.sort();

    const errors: StaticSyntaxError[] = [];
    let checked = 0;
    for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        const shown = path.relative(displayRoot, file).split(path.sep).join("/");

        if (SCRIPT_EXTENSIONS.has(ext)) {
            const source = fs.readFileSync(file, "utf8");
            checked++;
            const kind: ScriptKind = ext === ".mjs" ? "module" : ext === ".cjs" ? "script" : "auto";
            const failure = findSyntaxError(source, kind, ext === ".cjs");
            if (failure) {
                errors.push({
                    file: shown,
                    line: failure.line,
                    column: failure.column + 1,
                    message: failure.message,
                    excerpt: excerptOf(source, failure.line, failure.column)
                });
            }
        } else if (HTML_EXTENSIONS.has(ext)) {
            const html = fs.readFileSync(file, "utf8");
            for (const script of inlineScripts(html)) {
                checked++;
                const failure = findSyntaxError(script.source, script.kind);
                if (!failure) continue;
                // An unrendered template is not JavaScript yet; whether it will
                // be is for whatever renders it to say.
                if (TEMPLATE_MARKERS.test(script.source)) continue;
                const line = script.line + failure.line - 1;
                const column = failure.line === 1 ? script.column + failure.column : failure.column;
                errors.push({
                    file: shown,
                    line,
                    column: column + 1,
                    message: `${failure.message} (inline <script${script.kind === "module" ? " type=\"module\"" : ""}>)`,
                    excerpt: excerptOf(html, line, column)
                });
            }
        }
    }
    return { checked,
errors };
}

/** The errors as the lines a person reads: `file:line:col  message`, then the line itself. */
export function formatSyntaxErrors(errors: StaticSyntaxError[], limit = 10): string[] {
    const lines: string[] = [];
    for (const error of errors.slice(0, limit)) {
        lines.push(`${error.file}:${error.line}:${error.column}  ${error.message}`);
        if (error.excerpt !== undefined) lines.push(`    ${error.line} | ${error.excerpt}`);
    }
    if (errors.length > limit) lines.push(`…and ${errors.length - limit} more`);
    return lines;
}

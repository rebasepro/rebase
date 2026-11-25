/**
 * Skills over MCP: the `io.modelcontextprotocol/skills` extension (SEP-2640).
 *
 * A skill is a folder holding a `SKILL.md` (YAML frontmatter with `name` and
 * `description`, then instructions) and any supporting files it links to,
 * as https://agentskills.io/specification lays out. An MCP server serves one
 * as resources: `skills/list` and `skills/get` answer each skill's entry — its
 * `SKILL.md` URI, its frontmatter verbatim, and a manifest naming every file
 * with its SHA-256 digest and size — and `resources/read` answers each file.
 * A host loads a skill only when it needs it, checks every byte it reads
 * against the manifest, and binds the user's approval to those digests.
 *
 * This module is the catalog: it walks a folder of skill folders once,
 * through a {@link McpSkillFiles} adapter, and holds the entries — metadata
 * only. A file's bytes are read when a client asks for them, and are served
 * only if they still match the entry the client was given. It names no Node
 * module: it sits on the request path (`contracts/portable-core.txt`), and the
 * adapter over a real folder (`mcp-skills-node.ts`) is imported at boot.
 *
 * What it refuses, it refuses per skill, with a warning: a skill that breaks a
 * rule — no frontmatter, a name that is not its folder's, a symlink inside,
 * over the spec's 512 files or 16 MiB — is left out and the rest are served.
 * Hidden files (`.gitkeep`, `.DS_Store`) are neither listed nor served.
 *
 * @module
 */

/** The extension's identifier, the key under `capabilities.extensions`. */
export const SKILLS_EXTENSION_ID = "io.modelcontextprotocol/skills";

/** The publication limits the specification sets per skill, which hosts must accept. */
export const SKILL_LIMITS = { files: 512,
bytes: 16 * 1024 * 1024 } as const;

/**
 * Claude Code's own, tighter limits: it does not load a skill over them. A
 * skill past these is still served — other hosts take it — with a warning.
 */
const CLAUDE_CODE_LIMITS = { fileBytes: 100 * 1024,
skillBytes: 400 * 1024 } as const;

/** One child of a folder, as an adapter reports it. */
export interface McpSkillFileEntry {
    name: string;
    /** `unsupported` is a symlink or other special file: the skill holding one is left out. */
    kind: "file" | "directory" | "unsupported";
}

/** Storage for a catalog: two operations over relative, `/`-separated paths, `""` being the root. */
export interface McpSkillFiles {
    list(dir: string): Promise<McpSkillFileEntry[]>;
    read(path: string): Promise<Uint8Array>;
}

/**
 * Where an endpoint's skills come from, asked once, on the first request
 * that needs them. `undefined` serves none.
 */
export type McpSkillsSource = () => Promise<McpSkillFiles | undefined>;

/** One file of a skill, as its entry names it. */
export interface McpSkillResource {
    uri: string;
    /** `sha256:` and 64 lowercase hex digits, over the raw bytes. */
    digest: string;
    size: number;
}

/** A skill as `skills/list` and `skills/get` answer it. */
export interface McpSkillEntry {
    /** The `SKILL.md` URI. Its last folder is the skill's name. */
    uri: string;
    /** The `SKILL.md` frontmatter, verbatim. */
    frontmatter: { name: string; description: string } & Record<string, unknown>;
    /** Every file of the skill, `SKILL.md` included, each once. */
    resources: McpSkillResource[];
}

/** A file's content as `resources/read` answers it. */
export type McpSkillContent =
    | { uri: string; mimeType: string; text: string }
    | { uri: string; mimeType: string; blob: string };

/** A problem found while building the catalog. `path` names the file or folder. */
export interface McpSkillWarning {
    path: string;
    message: string;
}

export interface McpSkillCatalog {
    /** Every skill served, sorted by URI. */
    readonly entries: readonly McpSkillEntry[];
    /** The entry whose `SKILL.md` is at `uri`. */
    get(uri: string): McpSkillEntry | undefined;
    /**
     * A file of a served skill, when its bytes still match its entry. A file
     * that is not part of any entry is `undefined`; one that changed on disk
     * since the catalog was built throws {@link McpSkillChangedError}.
     */
    read(uri: string): Promise<McpSkillContent | undefined>;
}

/** A served file whose bytes no longer match the entry clients were given. */
export class McpSkillChangedError extends Error {
    constructor(readonly uri: string) {
        super(`The skill file ${uri} changed since the server read it. Restart the server to serve the new version.`);
        this.name = "McpSkillChangedError";
    }
}

const BASE_URI = "skill://";

/**
 * A skill's name: lowercase letters, digits and hyphens, 1–64 of them, not
 * starting, ending or doubling a hyphen — the Agent Skills rule.
 */
const SKILL_NAME = /^(?!-)(?!.*--)[a-z0-9-]{1,64}(?<!-)$/;

/**
 * Build the catalog from a folder of skill folders. Each direct child holding
 * a `SKILL.md` is one skill, served at `skill://<folder>/…`; a child without
 * one is skipped silently (a `README` next to the skills is not a mistake).
 */
export async function loadSkillCatalog(
    files: McpSkillFiles,
    options: { onWarning?: (warning: McpSkillWarning) => void } = {}
): Promise<McpSkillCatalog> {
    const warn = options.onWarning ?? (() => undefined);
    const entries: McpSkillEntry[] = [];
    const sources = new Map<string, { path: string; resource: McpSkillResource }>();

    const children = (await files.list("")).filter(child => child.kind === "directory" && !child.name.startsWith("."));
    for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
        const skill = await loadSkill(files, child.name, warn);
        if (!skill) continue;
        entries.push(skill.entry);
        for (const [uri, path] of skill.paths) {
            const resource = skill.entry.resources.find(r => r.uri === uri);
            if (resource) sources.set(uri, { path,
resource });
        }
    }
    entries.sort((a, b) => a.uri.localeCompare(b.uri));
    const byUri = new Map(entries.map(entry => [entry.uri, entry]));

    return {
        entries,
        get: uri => byUri.get(uri),
        async read(uri) {
            const source = sources.get(uri);
            if (!source) return undefined;
            const bytes = await files.read(source.path);
            if (bytes.byteLength !== source.resource.size || await sha256Digest(bytes) !== source.resource.digest) {
                throw new McpSkillChangedError(uri);
            }
            const mimeType = mimeTypeOf(source.path);
            const text = isTextMimeType(mimeType) ? utf8(bytes) : undefined;
            return text !== undefined
                ? { uri,
mimeType,
text }
                : { uri,
mimeType,
blob: base64(bytes) };
        }
    };
}

async function loadSkill(
    files: McpSkillFiles,
    folder: string,
    warn: (warning: McpSkillWarning) => void
): Promise<{ entry: McpSkillEntry; paths: Map<string, string> } | undefined> {
    const listing = await files.list(folder);
    if (!listing.some(entry => entry.name === "SKILL.md" && entry.kind === "file")) return undefined;

    const refuse = (message: string, path = folder) => {
        warn({ path,
message: `${message} The skill "${folder}" is not served.` });
        return undefined;
    };

    // Every file under the folder, hidden ones aside. A symlink is refused
    // rather than followed: it could name a file outside the folder.
    const walked: string[] = [];
    const pending = [folder];
    for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
        for (const entry of await files.list(dir)) {
            if (entry.name.startsWith(".")) continue;
            const path = `${dir}/${entry.name}`;
            if (entry.kind === "unsupported") return refuse("It contains a symlink or special file.", path);
            if (entry.kind === "directory") pending.push(path);
            else walked.push(path);
        }
    }
    walked.sort();
    if (walked.length > SKILL_LIMITS.files) {
        return refuse(`It has ${walked.length} files; a skill may have at most ${SKILL_LIMITS.files}.`);
    }

    const resources: McpSkillResource[] = [];
    const paths = new Map<string, string>();
    let skillMd: Uint8Array | undefined;
    let total = 0;
    for (const path of walked) {
        const bytes = await files.read(path);
        total += bytes.byteLength;
        if (total > SKILL_LIMITS.bytes) {
            return refuse(`It is over ${SKILL_LIMITS.bytes} bytes, the most a skill may hold.`);
        }
        if (bytes.byteLength > CLAUDE_CODE_LIMITS.fileBytes) {
            warn({ path,
message: `Over ${CLAUDE_CODE_LIMITS.fileBytes / 1024} KB: Claude Code will not load the skill "${folder}".` });
        }
        const uri = `${BASE_URI}${path}`;
        resources.push({ uri,
digest: await sha256Digest(bytes),
size: bytes.byteLength });
        paths.set(uri, path);
        if (path === `${folder}/SKILL.md`) skillMd = bytes;
    }
    if (total > CLAUDE_CODE_LIMITS.skillBytes) {
        warn({ path: folder,
message: `Over ${CLAUDE_CODE_LIMITS.skillBytes / 1024} KB in all: Claude Code will not load the skill "${folder}".` });
    }

    const markdown = skillMd && utf8(skillMd);
    if (markdown === undefined) return refuse("Its SKILL.md is not UTF-8 text.", `${folder}/SKILL.md`);
    let frontmatter: Record<string, unknown>;
    try {
        frontmatter = parseSkillFrontmatter(markdown);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return refuse(`Its SKILL.md frontmatter cannot be read: ${reason}.`, `${folder}/SKILL.md`);
    }
    const { name, description } = frontmatter;
    if (typeof name !== "string" || typeof description !== "string" || description.trim() === "") {
        return refuse("Its SKILL.md frontmatter needs a `name` and a `description`, both text.", `${folder}/SKILL.md`);
    }
    if (name !== folder) return refuse(`Its name "${name}" is not its folder's name.`, `${folder}/SKILL.md`);
    if (!SKILL_NAME.test(name)) {
        return refuse("A skill's name is 1–64 lowercase letters, digits and single hyphens.", `${folder}/SKILL.md`);
    }

    return {
        entry: { uri: `${BASE_URI}${folder}/SKILL.md`,
frontmatter: { ...frontmatter,
name,
description },
resources },
        paths
    };
}

// ─── Frontmatter ─────────────────────────────────────────────────────────

/**
 * The YAML frontmatter of a `SKILL.md`, as the JSON a host compares against
 * its own reading of the file.
 *
 * A subset of YAML, the part frontmatter is written in: block mappings and
 * sequences, plain, quoted and block (`|`, `>`) scalars, flow sequences of
 * scalars, comments, and the core schema's typing of plain scalars (`true`,
 * `12`, `null`). Anything else — anchors, aliases, tags, flow mappings with
 * content, complex keys — throws, and the skill is not served: a host would
 * read such a file its own way, and an entry it disagrees with is one it
 * refuses to load.
 */
export function parseSkillFrontmatter(markdown: string): Record<string, unknown> {
    // A byte-order mark is not part of the frontmatter. Compared by code, not
    // written as a character: the bundle keeps its source one byte per char.
    const unmarked = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown;
    const text = unmarked.replace(/\r\n?/g, "\n");
    const lines = text.split("\n");
    if (lines[0]?.trimEnd() !== "---") throw new Error("it does not start with a `---` line");
    const close = lines.findIndex((line, index) => index > 0 && (line.trimEnd() === "---" || line.trimEnd() === "..."));
    if (close < 0) throw new Error("the frontmatter has no closing `---` line");
    const parser = new FrontmatterParser(lines.slice(1, close));
    const value = parser.document();
    if (value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) throw new Error("the frontmatter is not a mapping");
    return value as Record<string, unknown>;
}

interface Line {
    indent: number;
    text: string;
}

class FrontmatterParser {
    private readonly lines: (Line | null)[];
    private index = 0;

    constructor(raw: string[]) {
        this.lines = raw.map(line => {
            if (/^\s*\t/.test(line)) throw new Error("it indents with a tab");
            const trimmed = line.trimStart();
            if (trimmed === "" || trimmed.startsWith("#")) return null;
            return { indent: line.length - trimmed.length,
text: line.trimEnd().slice(line.length - trimmed.length) };
        });
    }

    document(): unknown {
        this.skipBlank();
        if (this.index >= this.lines.length) return null;
        const first = this.lines[this.index] as Line;
        const value = this.block(first.indent);
        this.skipBlank();
        if (this.index < this.lines.length) throw new Error(`unexpected content on line ${this.index + 2}`);
        return value;
    }

    private skipBlank(): void {
        while (this.index < this.lines.length && this.lines[this.index] === null) this.index++;
    }

    private peek(): Line | undefined {
        this.skipBlank();
        return this.lines[this.index] ?? undefined;
    }

    /** A block node whose lines sit at exactly `indent`. */
    private block(indent: number): unknown {
        const line = this.peek();
        if (!line || line.indent !== indent) return null;
        return line.text === "-" || line.text.startsWith("- ") ? this.sequence(indent) : this.mapping(indent);
    }

    private sequence(indent: number): unknown[] {
        const items: unknown[] = [];
        for (let line = this.peek(); line && line.indent === indent && (line.text === "-" || line.text.startsWith("- ")); line = this.peek()) {
            const rest = line.text.slice(1).trimStart();
            this.index++;
            if (rest === "") {
                const next = this.peek();
                items.push(next && next.indent > indent ? this.block(next.indent) : null);
            } else if (/^[^\s"'[{][^:]*:(\s|$)/.test(rest) || /^["'].*["']\s*:(\s|$)/.test(rest)) {
                throw new Error("a mapping inside a sequence item is not supported");
            } else {
                items.push(this.inlineValue(rest, indent));
            }
        }
        return items;
    }

    private mapping(indent: number): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        for (let line = this.peek(); line && line.indent === indent; line = this.peek()) {
            const { key, rest } = splitKey(line.text);
            if (Object.prototype.hasOwnProperty.call(result, key)) throw new Error(`the key "${key}" appears twice`);
            this.index++;
            if (rest === "") {
                const next = this.peek();
                // A sequence may sit at the key's own indent, a mapping must be deeper.
                const nested = next && (next.indent > indent || (next.indent === indent && (next.text === "-" || next.text.startsWith("- "))));
                result[key] = nested ? this.block(next.indent) : null;
            } else {
                result[key] = this.inlineValue(rest, indent);
            }
        }
        const stray = this.peek();
        if (stray && stray.indent > indent) throw new Error(`unexpected indentation on line ${this.index + 2}`);
        return result;
    }

    /** The value after `key:` or `- `, with any continuation lines deeper than `parentIndent`. */
    private inlineValue(rest: string, parentIndent: number): unknown {
        if (/^[&*!]/.test(rest)) throw new Error("anchors, aliases and tags are not supported");
        const header = /^([|>])([+-]?)(\d?)([+-]?)\s*(#.*)?$/.exec(rest);
        if (header) return this.blockScalar(header[1] as "|" | ">", header[2] || header[4], parentIndent, header[3]);
        if (rest.startsWith("\"") || rest.startsWith("'")) return this.quoted(rest, parentIndent);
        if (rest.startsWith("[")) return flowSequence(stripComment(rest));
        if (rest.startsWith("{")) {
            if (/^\{\s*\}\s*(#.*)?$/.test(rest)) return {};
            throw new Error("flow mappings are not supported");
        }
        // A plain scalar, folded across deeper continuation lines.
        let value = stripComment(rest);
        let multiLine = false;
        for (let next = this.peekRaw(); next && next.indent > parentIndent; next = this.peekRaw()) {
            if (next.text.startsWith("#")) break;
            value += ` ${stripComment(next.text)}`;
            multiLine = true;
            this.index++;
        }
        return multiLine ? value : typedPlain(value);
    }

    /** The next line without skipping blanks: a blank line ends a folded plain scalar's line run. */
    private peekRaw(): Line | undefined {
        return this.lines[this.index] ?? undefined;
    }

    private quoted(rest: string, parentIndent: number): string {
        const quote = rest[0];
        let source = rest;
        // A quoted scalar may run on: join continuation lines until it closes.
        let end = closesQuote(source, quote);
        while (end === false) {
            const next = this.lines[this.index];
            if (next === undefined) throw new Error("a quoted value is never closed");
            this.index++;
            if (next === null) { source += "\n"; continue; }
            if (next.indent <= parentIndent) throw new Error("a quoted value is never closed");
            source += source.endsWith("\n") ? next.text : ` ${next.text}`;
            end = closesQuote(source, quote);
        }
        if (stripComment(source.slice(end + 1)) !== "") throw new Error("text follows a quoted value");
        const body = source.slice(1, end);
        if (quote === "'") return body.replace(/''/g, "'").replace(/ ?\n ?/g, "\n");
        return unescapeDoubleQuoted(body);
    }

    private blockScalar(style: "|" | ">", chomp: string, parentIndent: number, explicit: string): string {
        const collected: string[] = [];
        let indent = explicit ? parentIndent + Number(explicit) : -1;
        while (this.index < this.lines.length) {
            const line = this.lines[this.index];
            if (line === null) { collected.push(""); this.index++; continue; }
            if (indent < 0) indent = line.indent;
            if (line.indent < indent || line.indent <= parentIndent) break;
            collected.push(" ".repeat(line.indent - indent) + line.text);
            this.index++;
        }
        // Trailing blank lines belong to the chomping, not the content.
        let trailing = 0;
        while (collected.length > 0 && collected[collected.length - 1] === "") { collected.pop(); trailing++; }
        let body: string;
        if (style === "|") {
            body = collected.join("\n");
        } else {
            body = "";
            collected.forEach((line, i) => {
                if (i === 0) { body = line; return; }
                const previous = collected[i - 1];
                if (line === "") body += "\n";
                else if (previous === "" || line.startsWith(" ") || previous.startsWith(" ")) body += (previous === "" ? "" : "\n") + line;
                else body += ` ${line}`;
            });
        }
        if (collected.length === 0) return "";
        if (chomp === "-") return body;
        if (chomp === "+") return `${body}\n${"\n".repeat(trailing)}`;
        return `${body}\n`;
    }
}

function splitKey(text: string): { key: string; rest: string } {
    if (text.startsWith("?")) throw new Error("complex keys are not supported");
    if (text.startsWith("\"") || text.startsWith("'")) {
        const end = closesQuote(text, text[0]);
        if (end === false || text[end + 1] !== ":") throw new Error(`cannot read the key in "${text}"`);
        const raw = text.slice(1, end);
        return { key: text[0] === "'" ? raw.replace(/''/g, "'") : unescapeDoubleQuoted(raw),
rest: text.slice(end + 2).trim() };
    }
    const match = /^([^#:][^:]*?)\s*:(?:\s+(.*))?$/.exec(text) ?? /^([^#:][^:]*?)\s*:$/.exec(text);
    if (!match) throw new Error(`expected "key: value", found "${text}"`);
    return { key: match[1],
rest: (match[2] ?? "").trim() };
}

/** Index of the closing quote, or `false` when the scalar does not close in `source`. */
function closesQuote(source: string, quote: string): number | false {
    for (let i = 1; i < source.length; i++) {
        if (quote === "\"" && source[i] === "\\") { i++; continue; }
        if (source[i] !== quote) continue;
        if (quote === "'" && source[i + 1] === "'") { i++; continue; }
        return i;
    }
    return false;
}

/** A double-quoted scalar's body, its escapes resolved — the JSON subset of YAML's escapes. */
function unescapeDoubleQuoted(body: string): string {
    let parsed: unknown;
    try {
        parsed = JSON.parse(`"${body.replace(/\n/g, "\\n").replace(/\\\//g, "/")}"`);
    } catch {
        throw new Error("a double-quoted value uses an escape this reader does not support");
    }
    if (typeof parsed !== "string") throw new Error("a double-quoted value could not be read");
    return parsed;
}

function stripComment(text: string): string {
    const hash = text.search(/\s#/);
    return (hash >= 0 ? text.slice(0, hash) : text).trim();
}

function flowSequence(text: string): unknown[] {
    if (!text.endsWith("]")) throw new Error("a flow sequence must open and close on one line");
    const inner = text.slice(1, -1).trim();
    if (inner === "") return [];
    const items: unknown[] = [];
    let i = 0;
    while (i < inner.length) {
        while (inner[i] === " ") i++;
        let item: unknown;
        if (inner[i] === "\"" || inner[i] === "'") {
            const end = closesQuote(inner.slice(i), inner[i]);
            if (end === false) throw new Error("a quoted item in a flow sequence is never closed");
            const raw = inner.slice(i + 1, i + end);
            item = inner[i] === "'" ? raw.replace(/''/g, "'") : unescapeDoubleQuoted(raw);
            i += end + 1;
        } else {
            const comma = inner.indexOf(",", i);
            const raw = (comma < 0 ? inner.slice(i) : inner.slice(i, comma)).trim();
            if (/[[\]{}]/.test(raw)) throw new Error("nested flow collections are not supported");
            item = typedPlain(raw);
            i = comma < 0 ? inner.length : comma;
        }
        items.push(item);
        while (inner[i] === " ") i++;
        if (i < inner.length) {
            if (inner[i] !== ",") throw new Error("expected a comma in a flow sequence");
            i++;
        }
    }
    return items;
}

/** YAML 1.2 core-schema typing of a plain scalar. */
function typedPlain(value: string): unknown {
    if (/^(null|Null|NULL|~)?$/.test(value)) return null;
    if (/^(true|True|TRUE)$/.test(value)) return true;
    if (/^(false|False|FALSE)$/.test(value)) return false;
    if (/^[-+]?[0-9]+$/.test(value)) return Number(value);
    if (/^0o[0-7]+$/.test(value)) return parseInt(value.slice(2), 8);
    if (/^0x[0-9a-fA-F]+$/.test(value)) return parseInt(value.slice(2), 16);
    if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(value)) return Number(value);
    if (/^[-+]?\.(inf|Inf|INF)$/.test(value)) return value.startsWith("-") ? -Infinity : Infinity;
    if (/^\.(nan|NaN|NAN)$/.test(value)) return NaN;
    return value;
}

// ─── Bytes ───────────────────────────────────────────────────────────────

async function sha256Digest(bytes: Uint8Array): Promise<string> {
    // A copy, so the digest is taken over a plain ArrayBuffer whatever backs `bytes`.
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
    return `sha256:${Array.from(digest, b => b.toString(16).padStart(2, "0")).join("")}`;
}

function utf8(bytes: Uint8Array): string | undefined {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return undefined;
    }
}

function base64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

const MIME_TYPES: Record<string, string> = {
    md: "text/markdown",
    markdown: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    yaml: "application/yaml",
    yml: "application/yaml",
    toml: "application/toml",
    csv: "text/csv",
    html: "text/html",
    css: "text/css",
    xml: "application/xml",
    js: "text/javascript",
    mjs: "text/javascript",
    cjs: "text/javascript",
    ts: "text/typescript",
    tsx: "text/typescript",
    jsx: "text/javascript",
    py: "text/x-python",
    sh: "text/x-shellscript",
    sql: "application/sql",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf"
};

function mimeTypeOf(path: string): string {
    const dot = path.lastIndexOf(".");
    const ext = dot > path.lastIndexOf("/") ? path.slice(dot + 1).toLowerCase() : "";
    return MIME_TYPES[ext] ?? (ext === "" ? "text/plain" : "application/octet-stream");
}

function isTextMimeType(mimeType: string): boolean {
    return mimeType.startsWith("text/")
        || ["application/json", "application/yaml", "application/toml", "application/xml", "application/sql", "image/svg+xml"].includes(mimeType);
}

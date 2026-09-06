/**
 * The MCP server's tool surface, read out of `packages/mcp/src/index.ts`.
 *
 * Same reasoning as `cli-commands.mjs`: a list copied into a README is the
 * staleness bug the verifiers exist to catch. The npm README claimed "CLI Tools
 * (6)" for eleven of them and had no section at all for storage, cron or
 * functions — nine tools a reader of that page did not know existed — while
 * `update_user` was documented as taking `userId` for an argument the schema
 * has always called `uid`. Nobody runs a table, so nothing failed.
 *
 * The source is parsed rather than imported: importing `index.ts` means a
 * TypeScript loader, a built `dist/`, an MCP `Server` instance and a read of
 * the developer's own `~/.rebase/projects.json`, all so a docs check can list
 * some strings. Brace-matching over the literal is enough, and it fails loudly
 * (zero tools) rather than quietly if the file is ever restructured.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** Declaration order in `ALL_TOOLS`, with the heading each group is written under. */
const GROUPS = [
    { const: "CLI_TOOLS", title: "Schema & database", note: "Spawn the Rebase CLI in the active project directory." },
    { const: "SCHEMA_TOOLS", title: "Schema planning", note: "Ask the backend what a change would do. No CLI, no files written." },
    { const: "DATA_TOOLS", title: "Documents", note: "CRUD over a collection through `@rebasepro/client`." },
    { const: "ADMIN_TOOLS", title: "Users & roles", note: "" },
    { const: "DEV_TOOLS", title: "Dev server", note: "" },
    { const: "STORAGE_TOOLS", title: "Storage", note: "" },
    { const: "CRON_TOOLS", title: "Cron", note: "" },
    { const: "FUNCTION_TOOLS", title: "Functions", note: "" },
    { const: "PROJECT_TOOLS", title: "Project registry", note: "" }
];

/** The body of the array literal whose `[` sits at `open`. */
function arrayLiteralAt(text, open) {
    if (text[open] !== "[") return "";
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (c === "[" || c === "{") depth++;
        else if (c === "]" || c === "}") {
            depth--;
            if (depth === 0) return text.slice(open + 1, i);
        } else if (c === '"' || c === "'" || c === "`") {
            // Skip the string so a bracket inside a description does not count.
            const quote = c;
            i++;
            while (i < text.length && text[i] !== quote) {
                if (text[i] === "\\") i++;
                i++;
            }
        }
    }
    return "";
}

/**
 * The body of the array literal *assigned* at or after `from`.
 *
 * `indexOf("[")` is not enough on its own: the annotation in
 * `const CLI_TOOLS: (ToolDef & { cmd: string[] })[] = [` holds two brackets
 * before the one that opens the value. `= [` is the unambiguous landmark.
 */
function assignedArrayAt(text, from) {
    const assign = /=\s*\[/.exec(text.slice(from));
    if (!assign) return "";
    return arrayLiteralAt(text, from + assign.index + assign[0].length - 1);
}

/** Split an array-literal body into its top-level `{ … }` elements. */
function objectsIn(body) {
    const out = [];
    let depth = 0;
    let start = -1;
    for (let i = 0; i < body.length; i++) {
        const c = body[i];
        if (c === '"' || c === "'" || c === "`") {
            const quote = c;
            i++;
            while (i < body.length && body[i] !== quote) {
                if (body[i] === "\\") i++;
                i++;
            }
            continue;
        }
        if (c === "{") {
            if (depth === 0) start = i;
            depth++;
        } else if (c === "}") {
            depth--;
            if (depth === 0 && start !== -1) {
                out.push(body.slice(start, i + 1));
                start = -1;
            }
        } else if (c === "[") depth++;
        else if (c === "]") depth--;
    }
    return out;
}

/** The value of a double-quoted `key: "…"` at the top level of an object literal. */
function stringField(objectSource, key) {
    const re = new RegExp(`(?:^|[,{\\s])${key}\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`);
    const m = re.exec(objectSource);
    return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : null;
}

/** A `required: ["a", "b"]` list, in source order. */
function requiredIn(objectSource) {
    const m = /required\s*:\s*\[([^\]]*)\]/.exec(objectSource);
    if (!m) return [];
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/**
 * The source with `//` and block comments blanked out, newlines kept.
 *
 * `arrayLiteralAt` treats `'` as a string opener wherever it finds one, and a
 * comment inside a literal is allowed to hold an apostrophe — "the schema
 * editor's planner". One of those swallowed the `]` that closes
 * `READ_ONLY_TOOLS`, so the parse ran to the end of the file, every tool name
 * in it landed in the read-only set, and the generated README dropped the ⚠
 * from every gated tool while still explaining what ⚠ means. The gate could
 * not see it: generator and check read the same parse.
 */
function withoutComments(text) {
    return text
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
        .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + " ".repeat(m.length - lead.length));
}

/** A `new Set<string>([...])` declaration's string members. */
function setMembers(text, name) {
    const source = withoutComments(text);
    const marker = `export const ${name} = new Set<string>(`;
    const at = source.indexOf(marker);
    if (at === -1) return new Set();
    const body = arrayLiteralAt(source, source.indexOf("[", at + marker.length - 1));
    return new Set([...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
}

/**
 * @returns {{ groups: Array<{title: string, note: string, tools: Array<{name: string, description: string, required: string[], gated: boolean}>}>, total: number }}
 */
export function loadMcpTools(root) {
    const text = readFileSync(path.join(root, "packages", "mcp", "src", "index.ts"), "utf8");
    const readOnly = setMembers(text, "READ_ONLY_TOOLS");
    const localOnly = setMembers(text, "LOCAL_ONLY_TOOLS");

    const groups = [];
    let total = 0;
    for (const group of GROUPS) {
        const at = text.indexOf(`const ${group.const}`);
        if (at === -1) continue;
        const tools = objectsIn(assignedArrayAt(text, at))
            .map((src) => {
                const name = stringField(src, "name");
                if (!name) return null;
                return {
                    name,
                    description: stringField(src, "description") ?? "",
                    required: requiredIn(src),
                    gated: !readOnly.has(name) && !localOnly.has(name)
                };
            })
            .filter(Boolean);
        total += tools.length;
        groups.push({ title: group.title, note: group.note, tools });
    }
    return { groups, total };
}

/**
 * The generated half of `packages/mcp/README.md`.
 *
 * One sentence per tool: the README is a reference, and a description that
 * runs to three clauses in a table cell is one nobody reads. The first
 * sentence of the tool's own description is what the model sees anyway.
 */
export function renderMcpToolTables(root) {
    const { groups, total } = loadMcpTools(root);
    const lines = [];
    lines.push(
        `${total} tools, in ${groups.length} groups. Tools marked ⚠ are refused against a non-local`,
        "target unless `REBASE_MCP_ALLOW_REMOTE_WRITES=true` — see the gate above."
    );
    for (const group of groups) {
        lines.push("", `### ${group.title} (${group.tools.length})`, "");
        if (group.note) lines.push(group.note, "");
        lines.push("| Tool | Required | Description |", "|---|---|---|");
        for (const tool of group.tools) {
            const first = /^.*?[.](?:\s|$)/.exec(tool.description)?.[0]?.trim() ?? tool.description;
            const required = tool.required.length
                ? tool.required.map((r) => `\`${r}\``).join(", ")
                : "—";
            lines.push(`| \`${tool.name}\`${tool.gated ? " ⚠" : ""} | ${required} | ${first.replace(/[.]$/, "")} |`);
        }
    }
    return lines.join("\n");
}

/** The markers the generated block sits between. */
export const MCP_TOOLS_BEGIN = "<!-- generated: mcp tool tables — pnpm generate:mcp-readme -->";
export const MCP_TOOLS_END = "<!-- /generated: mcp tool tables -->";

/**
 * Splice a freshly rendered block into a README, or `null` when the markers
 * are missing — a caller that cannot find them should say so rather than
 * append a second copy.
 */
export function spliceMcpToolTables(readme, rendered) {
    const start = readme.indexOf(MCP_TOOLS_BEGIN);
    const end = readme.indexOf(MCP_TOOLS_END);
    if (start === -1 || end === -1 || end < start) return null;
    return (
        readme.slice(0, start + MCP_TOOLS_BEGIN.length) +
        "\n\n" +
        rendered +
        "\n\n" +
        readme.slice(end)
    );
}

/**
 * Every `parseCommandArgs({ spec, command })` call in the CLI's source, read
 * statically: the command it names and the flags its spec declares.
 *
 * Shared by `help-coverage.test.ts` (every flag a parser reads is in its help)
 * and `printed-commands.test.ts` (every flag the CLI prints is one a parser
 * reads), so the two guards cannot disagree about what a command accepts.
 * Test support only — nothing in the CLI imports it.
 */
import fs from "fs";
import path from "path";

export interface ParsedCommandSpec {
    /** The command words, as the call names them: `"build"`, `"skills install"`. */
    command: string;
    /** Canonical long flags: the value is a type, not another flag's name. */
    flags: string[];
    /** Every spelling the parser accepts, aliases and short flags included. */
    accepted: string[];
    file: string;
}

/** Source with comments blanked, so a commented-out flag is not a flag. */
function uncommented(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** The text of the `{ … }` that opens at `open`, braces balanced. */
function braced(source: string, open: number): string {
    let depth = 0;
    for (let i = open; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
    }
    throw new Error("unbalanced braces");
}

/** The parser calls in one file. Throws on a call it cannot read, so a new shape fails loudly. */
export function parsedCommands(file: string): ParsedCommandSpec[] {
    const source = uncommented(fs.readFileSync(file, "utf8"));
    const out: ParsedCommandSpec[] = [];
    for (const call of source.matchAll(/parseCommandArgs\(\{/g)) {
        const body = braced(source, (call.index ?? 0) + "parseCommandArgs(".length);
        const command = /command:\s*"([^"]+)"/.exec(body)?.[1];
        if (!command) throw new Error(`${path.basename(file)}: a parseCommandArgs call names no command`);
        let spec: string;
        const inline = /spec:\s*\{/.exec(body);
        if (inline) {
            spec = braced(body, inline.index + inline[0].length - 1);
        } else {
            const named = /spec:\s*([A-Z_][A-Z0-9_]*)/.exec(body)?.[1];
            if (!named) throw new Error(`${path.basename(file)}: cannot read the spec of "${command}"`);
            const declared = new RegExp(`const ${named}\\b[^=]*=\\s*\\{`).exec(source);
            if (!declared) throw new Error(`${path.basename(file)}: ${named} is not declared in this file`);
            spec = braced(source, declared.index + declared[0].length - 1);
        }
        out.push({
            command,
            flags: [...spec.matchAll(/"(--[a-z][a-z0-9-]*)"\s*:\s*(?!")/g)].map(m => m[1]),
            accepted: [...spec.matchAll(/"(--?[a-zA-Z][a-zA-Z0-9-]*)"\s*:/g)].map(m => m[1]),
            file
        });
    }
    return out;
}

/** Every parser call under `src/` that the dispatch reaches: `cli.ts` and the command modules. */
export function allParsedCommands(commandsDir: string): ParsedCommandSpec[] {
    const files = [
        path.join(commandsDir, "..", "cli.ts"),
        ...fs.readdirSync(commandsDir)
            .filter(name => name.endsWith(".ts") && !name.includes(".test."))
            .map(name => path.join(commandsDir, name))
    ];
    return files.flatMap(parsedCommands);
}

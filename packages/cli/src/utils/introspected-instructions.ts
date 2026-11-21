/**
 * The project's `ai-instructions.md`, once `rebase schema introspect` has made
 * the code the schema.
 *
 * A headless scaffold ships the headless rules: "There is no `backend/schema/`",
 * "The database is the schema", "Do not create `backend/schema/`". Introspection
 * writes exactly that directory, and from then on the server serves the tables
 * `backend/schema/index.ts` exports — so every session an assistant opened
 * afterwards was told to change tables with SQL in a project whose tables are
 * files, and that the one directory it should edit must not exist.
 *
 * A file still exactly as the scaffold wrote it is replaced with the
 * backend-only schema-in-code rules (`templates/overlays/headless-schema/`).
 * One that has been edited is the developer's, and is left alone: the command
 * says which of its rules no longer hold instead.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { resolveSchemaDir } from "./schema-dir";

const INSTRUCTIONS_FILE = "ai-instructions.md";

/** Phrases only the headless rules carry: any of them says the file still describes a headless project. */
const HEADLESS_CLAIMS = [
    "There is no `backend/schema/`",
    "**The database is the schema.**",
    "Do not create `backend/schema/`"
];

/** What {@link adoptSchemaInCodeInstructions} did. */
export type InstructionsAfterIntrospect =
    /** The schema directory has no `index.ts`, or the project has no instructions to speak of. */
    | { kind: "unchanged" }
    /** The headless rules were still as shipped, and are now the schema-in-code ones. */
    | { kind: "rewritten"; file: string }
    /** The file was edited and still says the database is the schema: left alone, and said. */
    | { kind: "stale"; file: string };

/** Where this CLI's templates are, from the module's own location (src or dist). */
export function cliTemplatesDir(from: string = path.dirname(fileURLToPath(import.meta.url))): string | null {
    let dir = from;
    const top = path.parse(dir).root;
    while (dir !== top) {
        if (fs.existsSync(path.join(dir, "templates", "overlays", "baas", INSTRUCTIONS_FILE))) return path.join(dir, "templates");
        dir = path.dirname(dir);
    }
    return null;
}

const normalized = (text: string): string => text.replace(/\r\n/g, "\n");

/**
 * Bring the project's `ai-instructions.md` in line with a `backend/schema/`
 * that now exists.
 *
 * @param templatesDir the CLI's `templates/` directory — {@link cliTemplatesDir}.
 */
export function adoptSchemaInCodeInstructions(projectRoot: string, templatesDir: string): InstructionsAfterIntrospect {
    if (!fs.existsSync(path.join(resolveSchemaDir(projectRoot), "index.ts"))) return { kind: "unchanged" };

    const file = path.join(projectRoot, INSTRUCTIONS_FILE);
    let current: string;
    try {
        current = normalized(fs.readFileSync(file, "utf-8"));
    } catch {
        return { kind: "unchanged" };
    }

    let headless: string | null = null;
    try {
        headless = normalized(fs.readFileSync(path.join(templatesDir, "overlays", "baas", INSTRUCTIONS_FILE), "utf-8"));
    } catch {
        // No copy to compare against: an untouched file reads as an edited one.
    }

    if (headless !== null && current === headless) {
        const schemaInCode = fs.readFileSync(path.join(templatesDir, "overlays", "headless-schema", INSTRUCTIONS_FILE), "utf-8");
        fs.writeFileSync(file, schemaInCode, "utf-8");
        return { kind: "rewritten", file };
    }

    return HEADLESS_CLAIMS.some(claim => current.includes(claim)) ? { kind: "stale", file } : { kind: "unchanged" };
}

/** The lines `rebase schema introspect` prints for each outcome, or none. */
export function instructionsAfterIntrospectLines(result: InstructionsAfterIntrospect, projectRoot: string): string[] {
    if (result.kind === "unchanged") return [];
    const name = path.relative(projectRoot, result.file) || INSTRUCTIONS_FILE;
    if (result.kind === "rewritten") {
        return [
            `✓ ${name} now describes tables declared in backend/schema/: it still had the headless rules, which said the database is the schema.`
        ];
    }
    return [
        `⚠ ${name} still describes a headless project ("the database is the schema", "there is no backend/schema/"), and you have edited it, so it was left as it is.`,
        "  Those rules no longer apply: the server now serves the tables backend/schema/index.ts exports. Change a table in its file, not with SQL.",
        "  The schema-in-code rules this CLI writes for such a project are in @rebasepro/cli's templates/overlays/headless-schema/ai-instructions.md."
    ];
}

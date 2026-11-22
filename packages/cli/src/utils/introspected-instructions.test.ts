/**
 * `ai-instructions.md` after `rebase schema introspect` has written
 * `backend/schema/` into a headless project.
 *
 * From a migration report: the project's instructions still said "headless,
 * no `backend/schema/`" after introspection had written `backend/schema/`.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { adoptSchemaInCodeInstructions, cliTemplatesDir, instructionsAfterIntrospectLines } from "./introspected-instructions";

const templates = cliTemplatesDir();
if (!templates) throw new Error("the CLI's templates/ directory was not found");
const TEMPLATES: string = templates;
const HEADLESS = fs.readFileSync(path.join(TEMPLATES, "overlays", "baas", "ai-instructions.md"), "utf-8");
const SCHEMA_IN_CODE = fs.readFileSync(path.join(TEMPLATES, "overlays", "headless-schema", "ai-instructions.md"), "utf-8");

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-introspected-instructions-"));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function introspected(): void {
    fs.mkdirSync(path.join(root, "backend", "schema"), { recursive: true });
    fs.writeFileSync(path.join(root, "backend", "schema", "index.ts"), "export { trips } from \"./trips\";\n");
}

const instructions = () => fs.readFileSync(path.join(root, "ai-instructions.md"), "utf-8");

describe("ai-instructions.md after introspection", () => {
    it("replaces the headless rules, still as the scaffold wrote them, with the schema-in-code ones", () => {
        fs.writeFileSync(path.join(root, "ai-instructions.md"), HEADLESS);
        introspected();

        const result = adoptSchemaInCodeInstructions(root, TEMPLATES);

        expect(result.kind).toBe("rewritten");
        expect(instructions()).toBe(SCHEMA_IN_CODE);
        expect(instructions()).not.toContain("There is no `backend/schema/`");
        expect(instructions()).not.toContain("The database is the schema.**");
        expect(instructionsAfterIntrospectLines(result, root)[0]).toContain("ai-instructions.md now describes tables declared in backend/schema/");
    });

    it("leaves a file that was edited, and says which of its rules no longer hold", () => {
        const edited = `${HEADLESS}\n## Ours\n\n- Trips are owned by their organizer.\n`;
        fs.writeFileSync(path.join(root, "ai-instructions.md"), edited);
        introspected();

        const result = adoptSchemaInCodeInstructions(root, TEMPLATES);

        expect(result.kind).toBe("stale");
        expect(instructions()).toBe(edited);
        const said = instructionsAfterIntrospectLines(result, root).join("\n");
        expect(said).toContain("ai-instructions.md still describes a headless project");
        expect(said).toContain("no longer apply");
    });

    it("does nothing until backend/schema/index.ts exists", () => {
        fs.writeFileSync(path.join(root, "ai-instructions.md"), HEADLESS);
        expect(adoptSchemaInCodeInstructions(root, TEMPLATES)).toEqual({ kind: "unchanged" });
        expect(instructions()).toBe(HEADLESS);
    });

    it("does nothing to instructions that already describe tables in code, or to a project with none", () => {
        introspected();
        expect(adoptSchemaInCodeInstructions(root, TEMPLATES)).toEqual({ kind: "unchanged" });

        const template = fs.readFileSync(path.join(TEMPLATES, "template", "ai-instructions.md"), "utf-8");
        fs.writeFileSync(path.join(root, "ai-instructions.md"), template);
        expect(adoptSchemaInCodeInstructions(root, TEMPLATES)).toEqual({ kind: "unchanged" });
        expect(instructions()).toBe(template);
    });
});

describe("the schema-in-code rules a headless project gets", () => {
    const scripts = Object.keys((JSON.parse(fs.readFileSync(path.join(TEMPLATES, "overlays", "baas", "package.json"), "utf-8")) as {
        scripts?: Record<string, string>;
    }).scripts ?? {});

    it("name every script the headless package.json declares", () => {
        for (const name of scripts) expect(SCHEMA_IN_CODE, name).toContain(`\`pnpm ${name}`);
    });

    it("name no script it does not declare: the commands it lacks are spelled `rebase …`", () => {
        const named = [...SCHEMA_IN_CODE.matchAll(/`pnpm ([\w:-]+)/g)].map(match => match[1]);
        expect(named.length).toBeGreaterThan(0);
        for (const name of named) expect(scripts, `pnpm ${name}`).toContain(name);
    });

    it("say nothing a backend-only project does not have", () => {
        expect(SCHEMA_IN_CODE).not.toMatch(/frontend\//);
        expect(SCHEMA_IN_CODE).not.toContain("customizeTable");
    });
});

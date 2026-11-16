import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { legacyCollectionsDir, legacyLayoutRefusal } from "./legacy-layout";

let root: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-legacy-layout-"));
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function write(relative: string): void {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "export {};\n");
}

describe("legacyCollectionsDir", () => {
    it("finds config/collections when there is no tables directory", () => {
        write("config/collections/index.ts");
        expect(legacyCollectionsDir(root, "backend/schema")).toBe("config/collections");
    });

    it("is not legacy mid-migration, with both directories", () => {
        write("config/collections/index.ts");
        write("backend/schema/index.ts");
        expect(legacyCollectionsDir(root, "backend/schema")).toBeUndefined();
    });

    it("reads the tables directory the manifest names", () => {
        write("config/collections/index.ts");
        write("db/tables/index.ts");
        expect(legacyCollectionsDir(root, "db/tables")).toBeUndefined();
        expect(legacyCollectionsDir(root, "backend/schema")).toBe("config/collections");
    });

    it("is not legacy with neither: a project that introspects its database", () => {
        write("config/people.ts");
        expect(legacyCollectionsDir(root, "backend/schema")).toBeUndefined();
    });
});

describe("legacyLayoutRefusal", () => {
    it("names the command in the message itself, not only the hint", () => {
        const { message, hint } = legacyLayoutRefusal("config/collections", "backend/schema");
        expect(message).toContain("`rebase migrate collections-to-tables`");
        expect(message).toContain("backend/schema");
        expect(hint).toContain("--dry-run");
    });
});

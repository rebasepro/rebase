/**
 * The spelling of the relative imports the codemod writes itself: decided once
 * from the legacy sources, so a project built with a plain `tsc` (NodeNext)
 * and run on Node gets `./users.js`, and every other project keeps `./users`.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";

import { generatedSpecifier, projectSpecifierStyle } from "./modules";

describe("projectSpecifierStyle", () => {
    it("is js when the relative specifiers carry a JavaScript extension", () => {
        expect(projectSpecifierStyle(["@rebasepro/types", "./users.js", "../lib/text.js"])).toBe("js");
        expect(projectSpecifierStyle(["./users.mjs", "./Field.jsx"])).toBe("js");
    });

    it("is extensionless for extensionless specifiers, and for none at all", () => {
        expect(projectSpecifierStyle(["./users", "../lib/text"])).toBe("extensionless");
        expect(projectSpecifierStyle(["@rebasepro/types", "react"])).toBe("extensionless");
        expect(projectSpecifierStyle([])).toBe("extensionless");
    });

    it("goes with the majority, and keeps extensionless on a tie", () => {
        expect(projectSpecifierStyle(["./users.js", "./posts.js", "./tags"])).toBe("js");
        expect(projectSpecifierStyle(["./users.js", "./posts", "./tags"])).toBe("extensionless");
        expect(projectSpecifierStyle(["./users.js", "./posts"])).toBe("extensionless");
    });

    it("counts a directory import as extensionless", () => {
        expect(projectSpecifierStyle(["./users.js", "..", "./lib/"])).toBe("extensionless");
    });

    it("ignores a specifier with another extension (a JSON file, a dotted module name)", () => {
        expect(projectSpecifierStyle(["./users.js", "./labels.json", "./users.schema", "./data.ts"])).toBe("js");
        expect(projectSpecifierStyle(["./labels.json", "./users.schema"])).toBe("extensionless");
    });
});

describe("generatedSpecifier", () => {
    const schema = path.join(path.sep, "p", "backend", "schema");

    it("writes a TypeScript module without its extension, or with .js", () => {
        expect(generatedSpecifier(path.join(schema, "index.ts"), path.join(schema, "users.ts"), "extensionless")).toBe("./users");
        expect(generatedSpecifier(path.join(schema, "index.ts"), path.join(schema, "users.ts"), "js")).toBe("./users.js");
        expect(generatedSpecifier(path.join(schema, "posts.ts"), path.join(schema, "..", "lib", "locales.ts"), "js")).toBe("../lib/locales.js");
        const cms = path.join(path.sep, "p", "frontend", "src", "cms");
        expect(generatedSpecifier(path.join(cms, "index.ts"), path.join(cms, "posts.tsx"), "js")).toBe("./posts.js");
        expect(generatedSpecifier(path.join(cms, "posts.tsx"), path.join(schema, "posts.ts"), "extensionless")).toBe("../../../backend/schema/posts");
    });

    it("keeps a JavaScript target's own extension, and maps .mts to .mjs", () => {
        expect(generatedSpecifier(path.join(schema, "index.ts"), path.join(schema, "legacy.js"), "extensionless")).toBe("./legacy.js");
        expect(generatedSpecifier(path.join(schema, "index.ts"), path.join(schema, "legacy.js"), "js")).toBe("./legacy.js");
        expect(generatedSpecifier(path.join(schema, "index.ts"), path.join(schema, "users.mts"), "js")).toBe("./users.mjs");
    });
});

import { describe, it, expect } from "vitest";

import { analyseFunctionSource, summarisePortability } from "./function-portability";

const analyse = (source: string) => analyseFunctionSource(source, "fn", "backend/functions/fn.ts");

describe("analyseFunctionSource", () => {
    it("calls a function that imports only the portable surface portable", () => {
        const result = analyse(`
            import { defineFunction, requireAuth, getUser } from "@rebasepro/server/functions";
            export default defineFunction((app) => {
                app.get("/", requireAuth, (c) => c.json({ uid: getUser(c)?.uid }));
            });
        `);
        expect(result.issues).toEqual([]);
        expect(result.portable).toBe(true);
    });

    it("flags Node built-ins, in both spellings", () => {
        const result = analyse(`
            import fs from "fs";
            import { join } from "node:path";
            export default fs && join;
        `);
        expect(result.issues.map(i => i.kind)).toEqual(["node-builtin", "node-builtin"]);
        expect(result.portable).toBe(false);
    });

    it("flags packages that need Node, with the reason", () => {
        const result = analyse(`import { Pool } from "pg";\nexport default Pool;`);
        expect(result.issues[0].kind).toBe("node-only-package");
        expect(result.issues[0].message).toContain("database TCP socket");
    });

    it("does not flag a type-only import, which is erased", () => {
        const result = analyse(`
            import type { Pool } from "pg";
            import { defineFunction } from "@rebasepro/server/functions";
            export default defineFunction(() => undefined);
            export type P = Pool;
        `);
        expect(result.issues).toEqual([]);
    });

    it("nudges the root barrel import without calling it unportable", () => {
        const result = analyse(`import { defineFunction } from "@rebasepro/server";\nexport default defineFunction(() => undefined);`);
        expect(result.issues[0].kind).toBe("root-barrel-import");
        // The same code either way — it reaches the surface through a heavier
        // door, and that is a suggestion, not a defect.
        expect(result.portable).toBe(true);
        expect(result.issues[0].actionable).toBe(false);
    });

    it("flags process.env at module scope as actionable", () => {
        const result = analyse(`
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
export default stripe;
        `.trim());
        const env = result.issues.find(i => i.kind === "module-scope-env");
        expect(env).toBeDefined();
        // This one is a live bug on Node too: an unset variable takes the file
        // down at import, and the loader reports only "skipped".
        expect(env?.actionable).toBe(true);
    });

    it("does not flag process.env read inside a handler", () => {
        const result = analyse(`
import { defineFunction } from "@rebasepro/server/functions";
export default defineFunction((app) => {
    app.get("/", (c) => {
        const key = process.env.STRIPE_SECRET_KEY;
        return c.json({ configured: Boolean(key) });
    });
});
        `.trim());
        expect(result.issues.filter(i => i.kind === "module-scope-env")).toEqual([]);
    });

    it("does not match inside comments or strings", () => {
        const result = analyse(`
// import fs from "fs";
/* import { Pool } from "pg"; */
const note = "process.env.NOT_REAL";
export default note;
        `.trim());
        expect(result.issues).toEqual([]);
    });

    it("ignores relative imports, which are the project's own files", () => {
        const result = analyse(`import { helper } from "../lib/helper";\nexport default helper;`);
        expect(result.issues).toEqual([]);
    });
});

describe("summarisePortability", () => {
    it("says nothing when there is nothing to say", () => {
        expect(summarisePortability([
            { name: "a", file: "f/a.ts", issues: [], portable: true }
        ])).toEqual([]);
        expect(summarisePortability([])).toEqual([]);
    });

    it("always surfaces an actionable finding", () => {
        const lines = summarisePortability([{
            name: "a",
            file: "backend/functions/a.ts",
            issues: [{ kind: "module-scope-env", line: 3, message: "reads process.env at module scope.", actionable: true }],
            portable: true
        }]);
        expect(lines.join("\n")).toContain("backend/functions/a.ts:3");
    });

    it("collapses Node-only functions to a count and their names", () => {
        const lines = summarisePortability([
            { name: "reports", file: "f/reports.ts", issues: [{ kind: "node-builtin", line: 1, message: "x", actionable: false }], portable: false },
            { name: "hello", file: "f/hello.ts", issues: [], portable: true }
        ]);
        expect(lines.join("\n")).toContain("1 of 2 function(s) depend on Node: reports");
    });
});

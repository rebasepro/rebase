/**
 * `test/e2e/scaffold.sql` is a recording, and a recording goes stale silently.
 *
 * `scaffold-baseline.e2e.test.ts` asserts that a stock Rebase project reports
 * exactly three criticals — a product decision about the scaffold's
 * `defaultSecurityRules`. It asserts that against a pg_dump taken once, so
 * editing a template collection changes the product and not the test: the
 * suite goes on passing and describes a scaffold nobody ships any more.
 *
 * This pins the recording to its source. It lives in the unit suite on
 * purpose: the e2e suite skips itself without Docker, and this failure has to
 * reach the person editing the template.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** The collections a `rebase init` scaffold actually ships (not `presets/`). */
const TEMPLATE = path.join(__dirname, "../../cli/templates/template/config/collections");

/**
 * Bump this ONLY together with a re-recorded `scaffold.sql` and a re-checked
 * `EXPECTED_BASELINE` — the header of that file has the recipe.
 */
const RECORDED = "1559e12af3993ff5";

describe("the recorded scaffold fixture", () => {
    it("was recorded from the template the CLI still ships", () => {
        const files = readdirSync(TEMPLATE).filter((f) => f.endsWith(".ts")).sort();
        expect(files).toEqual(["authors.ts", "index.ts", "posts.ts", "tags.ts", "users.ts"]);

        const digest = createHash("sha256");
        for (const file of files) {
            digest.update(file);
            digest.update(readFileSync(path.join(TEMPLATE, file)));
        }

        expect(
            digest.digest("hex").slice(0, 16),
            "The scaffold template changed since test/e2e/scaffold.sql was recorded. " +
                "Re-record it (recipe in that file's header), re-check EXPECTED_BASELINE " +
                "in scaffold-baseline.e2e.test.ts, then update RECORDED here."
        ).toBe(RECORDED);
    });
});

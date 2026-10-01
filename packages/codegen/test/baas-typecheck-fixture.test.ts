import { describe, it, expect } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import { CollectionConfig } from "@rebasepro/types";
import { generateTypedefs } from "../src/generate-types";
import { collections } from "../../../tests/e2e/baas-typecheck/src/typed-sdk/collections";

/**
 * The generated `Database` the typed-SDK probes are written against is this
 * generator's output, not a hand-written imitation of it.
 *
 * `tests/e2e/baas-typecheck/src/typed-sdk/probes.ts` asserts — with
 * `@ts-expect-error`, in a program `pnpm check:baas-types` runs — what a typed
 * client refuses and accepts. Those assertions are only about the real SDK if
 * the `Database` they read is what `rebase generate-sdk` writes today. So the
 * file is checked in (the type program cannot run the generator) and this
 * fails the moment the generator's output and the checked-in copy differ.
 *
 * To refresh it after a deliberate codegen change:
 *
 *     REBASE_WRITE_FIXTURE=1 pnpm --filter @rebasepro/codegen exec jest test/baas-typecheck-fixture.test.ts
 *
 * then re-run `pnpm check:baas-types`: a probe that starts failing is the
 * generator change showing up where an app developer would see it.
 */
const FIXTURE = path.resolve(__dirname, "../../../tests/e2e/baas-typecheck/src/typed-sdk/database.types.ts");

describe("the baas-typecheck typed-SDK fixture", () => {
    it("is what the generator emits for its collections", () => {
        const generated = generateTypedefs(collections as unknown as CollectionConfig[]);
        if (process.env.REBASE_WRITE_FIXTURE === "1") {
            fs.writeFileSync(FIXTURE, generated, "utf-8");
        }
        const checkedIn = fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE, "utf-8") : "";
        expect(checkedIn).toBe(generated);
    });
});

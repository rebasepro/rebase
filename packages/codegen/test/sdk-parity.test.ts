import { describe, it, expect, jest } from "@jest/globals";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AnyCollectionConfig, CollectionConfig } from "@rebasepro/types";
import { generateTypedefs } from "../src/generate-types";
import { LEGACY_FIXTURES } from "./fixtures/legacy-collections";
import { collections as baasCollections } from "./fixtures/legacy-baas-collections";

/**
 * The SDK the collection generator wrote, recorded per fixture set under
 * `fixtures/sdk-golden/`, so the descriptor generator that replaces it can be
 * held to the same bytes.
 *
 * To record (only ever from the collection generator):
 *
 *     REBASE_WRITE_SDK_GOLDEN=1 pnpm --filter @rebasepro/codegen exec jest test/sdk-parity.test.ts
 */
const GOLDEN_DIR = path.resolve(__dirname, "fixtures", "sdk-golden");
const WRITE = process.env.REBASE_WRITE_SDK_GOLDEN === "1";

const SETS: Record<string, () => CollectionConfig[]> = {
    ...LEGACY_FIXTURES,
    // `defineCollection` results each carry their own row type, which a bare
    // `CollectionConfig` (invariant in it) does not accept.
    "baas-typed-sdk": () => {
        const schema: AnyCollectionConfig[] = baasCollections;
        return schema;
    }
};

function goldenPath(name: string): string {
    return path.join(GOLDEN_DIR, `${name}.ts.txt`);
}

describe("the recorded SDK goldens", () => {
    it.each(Object.keys(SETS))("%s is what the collection generator writes", name => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        let generated: string;
        try {
            generated = generateTypedefs(SETS[name]());
        } catch (error) {
            generated = `THROWS: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`;
        } finally {
            warn.mockRestore();
        }
        if (WRITE) {
            fs.mkdirSync(GOLDEN_DIR, { recursive: true });
            fs.writeFileSync(goldenPath(name), generated, "utf-8");
        }
        expect(fs.readFileSync(goldenPath(name), "utf-8")).toBe(generated);
    });
});

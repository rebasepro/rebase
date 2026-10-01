/**
 * Every value the scaffold's `.env` offers for a variable boot validates is one
 * boot accepts.
 *
 * `rebase init` copies `packages/cli/templates/template/.env.example` into every
 * new project's `.env`, comments and all, so its comments are the first — often
 * the only — reference for what a variable takes. `REBASE_MIGRATE_ON_BOOT` was
 * documented there as `ensure` / `migrate` / `off`, while the boot schema is
 * `z.enum(["none", "ensure", "push", ""])`: a user who set `migrate`, as their
 * own `.env` told them to, got a backend that refused to start.
 *
 * So for each variable whose boot schema is an enum, two things in the file are
 * parsed with **that schema** rather than compared with a copy of it: the value
 * the `NAME=value` line (commented or not) assigns, and every value the comment
 * block above it lists in the `#   value   what it does` shape.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "@jest/globals";
import { z } from "zod";
import { rebaseEnvSchema } from "../src/env";
import { bootEnvExtension } from "../src/boot/env";

const TEMPLATE_ENV = path.resolve(__dirname, "..", "..", "cli", "templates", "template", ".env.example");

const shape: Record<string, z.ZodType> = { ...rebaseEnvSchema.shape, ...bootEnvExtension.shape };

/** The labels of the enum under a field's optional / default / transform wrappers, if it is one. */
function enumLabels(field: z.ZodType): string[] | undefined {
    let current: z.ZodType = field;
    for (let depth = 0; depth < 8; depth++) {
        if (current instanceof z.ZodEnum) return current.options.map(String);
        if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) {
            current = current.unwrap() as z.ZodType;
        } else if (current instanceof z.ZodDefault) {
            current = current.removeDefault() as z.ZodType;
        } else if (current instanceof z.ZodPipe) {
            // `.transform()` puts the enum on the way in; `z.preprocess()` puts
            // it on the way out, after a normalising step (LOG_LEVEL).
            current = (current.in instanceof z.ZodTransform ? current.out : current.in) as z.ZodType;
        } else {
            return undefined;
        }
    }
    return undefined;
}

interface Offer {
    name: string;
    line: number;
    /** What the `NAME=value` line assigns, inline comment stripped. */
    assigned: string;
    /** The values the comment block above it lists, one per `#   value   …` line. */
    listed: string[];
}

/** Every `NAME=value` line of the file, with the value list of the comment block above it. */
function offers(text: string): Offer[] {
    const out: Offer[] = [];
    let block: string[] = [];
    text.split("\n").forEach((raw, index) => {
        const line = raw.trimEnd();
        const assignment = /^#?\s*([A-Z][A-Z0-9_]+)=(.*)$/.exec(line);
        if (assignment) {
            const listed = block
                .map(comment => /^#\s{2,}([a-z0-9][\w.-]*)\s{2,}\S/.exec(comment)?.[1])
                .filter((value): value is string => value !== undefined);
            out.push({
                name: assignment[1],
                line: index + 1,
                assigned: assignment[2].replace(/\s+#.*$/, "").trim(),
                listed
            });
            block = [];
            return;
        }
        if (line.startsWith("#")) block.push(line);
        else block = [];
    });
    return out;
}

const enumOffers = (): (Offer & { labels: string[] })[] =>
    offers(fs.readFileSync(TEMPLATE_ENV, "utf8")).flatMap(offer => {
        const field = shape[offer.name];
        const labels = field ? enumLabels(field) : undefined;
        return labels ? [{ ...offer, labels }] : [];
    });

describe("the scaffold's .env offers only values boot accepts", () => {
    it("finds the enum variables it is guarding, with their value lists", () => {
        // The guard is only as good as its parse. If the file is reorganised so
        // that nothing is found, this says so rather than passing on nothing.
        const found = enumOffers();
        expect(found.map(offer => offer.name)).toEqual(expect.arrayContaining([
            "NODE_ENV", "LOG_LEVEL", "STORAGE_TYPE", "REBASE_MIGRATE_ON_BOOT"
        ]));
        expect(found.find(offer => offer.name === "REBASE_MIGRATE_ON_BOOT")?.listed.length).toBeGreaterThanOrEqual(2);
    });

    it("assigns, and lists, only values the boot schema parses", () => {
        const refused = enumOffers().flatMap(offer =>
            [offer.assigned, ...offer.listed]
                .filter(value => value !== "")
                .filter(value => !shape[offer.name].safeParse(value).success)
                .map(value => `.env.example:${offer.line} ${offer.name}=${value} — boot accepts ${
                    offer.labels.filter(label => label !== "").join(" | ")}`));
        expect(refused).toEqual([]);
    });
});

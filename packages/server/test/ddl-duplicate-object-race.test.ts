import { describe, expect, it } from "@jest/globals";

import { isDuplicateObjectRace } from "../src/boot/ddl-bootstrap";

/**
 * "Someone beat me to it" and "this statement is wrong" both arrive as a unique
 * violation on a `pg_catalog` index. Telling them apart is the whole job of
 * this predicate, and one case was on the wrong side of the line.
 *
 * The error shapes below are recorded from PGlite, not invented:
 *
 *     CREATE TYPE dup AS ENUM ('draft', 'draft');
 *     → 23505, constraint pg_enum_typid_label_index
 *
 *     ALTER TYPE ok1 ADD VALUE 'draft';        (label already there)
 *     → 42710, no constraint
 *
 * The second is the concurrent-boot case this predicate exists for, and it
 * comes through on its SQLSTATE alone — so excluding the enum *index* costs
 * that path nothing.
 */
const pgError = (fields: Record<string, unknown>): Error => Object.assign(new Error("db"), fields);

describe("isDuplicateObjectRace", () => {
    it("accepts the catalog race a lost CREATE TABLE raises", () => {
        expect(isDuplicateObjectRace(pgError({ code: "23505", constraint: "pg_type_typname_nsp_index" }))).toBe(true);
    });

    it("accepts a duplicate_object SQLSTATE outright", () => {
        // `ALTER TYPE … ADD VALUE` for a label a peer already added.
        expect(isDuplicateObjectRace(pgError({ code: "42710" }))).toBe(true);
    });

    // A collection with two enum entries carrying the same `id` generates
    // `CREATE TYPE … AS ENUM ('draft', 'draft')`. One statement violates the
    // index on its own; no peer is involved. Read as a race, the type was never
    // created and the column silently degraded to TEXT.
    it("refuses the enum label index, which no race produces", () => {
        expect(isDuplicateObjectRace(pgError({
            code: "23505",
            constraint: "pg_enum_typid_label_index",
            detail: "Key (enumtypid, enumlabel)=(16385, draft) already exists."
        }))).toBe(false);
    });

    it("refuses it when only the detail text names the index", () => {
        expect(isDuplicateObjectRace(pgError({
            code: "23505",
            detail: "Key (enumtypid, enumlabel)=(16385, draft) already exists in pg_enum_typid_label_index."
        }))).toBe(false);
    });

    it("leaves a violation of the user's own constraint alone", () => {
        expect(isDuplicateObjectRace(pgError({ code: "23505", constraint: "users_email_key" }))).toBe(false);
    });

    it("looks through the cause chain, where the driver puts it", () => {
        const wrapped = Object.assign(new Error("apply failed"), {
            cause: pgError({ code: "23505", constraint: "pg_enum_typid_label_index" })
        });
        expect(isDuplicateObjectRace(wrapped)).toBe(false);
    });
});

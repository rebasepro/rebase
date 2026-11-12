import { describe, expect, it } from "@jest/globals";
import { col, defineTable, json, rel } from "@rebasepro/types";
import type { ColumnType, JsonShape } from "@rebasepro/types";

import { compileTables } from "../src/schema/compile-tables";
import {
    arrayElementType,
    isByteaType,
    isDateOnlyType,
    isEnumType,
    isGeopointColumn,
    isIlikeSearchable,
    isInstantType,
    isIntegerFamilyType,
    isJsNumberType,
    isNativeArrayType,
    isSerialType,
    isTimeOfDayType,
    isVectorType
} from "../src/table/column-types";
import { createStampKeys, databaseOwnsDefault, defaultOnCreate, stampOf, updateStampKeys } from "../src/table/write-values";
import { belongsToForColumn, relationOf, relationsOfKind } from "../src/table/relations";
import { isSoftDeleteRestore, softDeleteColumn, tenantOf } from "../src/table/table-options";
import { formatJsonPath, jsonPositions, walkJsonShape } from "../src/table/json-shape";

/**
 * The descriptor helpers other than keys and access (those have their own
 * files): type predicates, stamps and defaults, relations, table options and
 * the JSON shape walker.
 */

const teams = defineTable("teams", {
    columns: { id: col.uuid().primaryKey().defaultRandom() },
    rls: "admin-only"
});

const players = defineTable("players", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.varchar(),
        status: col.enum(["active", "benched"]),
        position: col.text().oneOf(["keeper", "defender", "forward"]),
        rating: col.numeric(5, 2),
        goals: col.integer().default(0),
        region: col.text().dbDefault(),
        kickoff: col.time(),
        born: col.date(),
        location: col.geopoint(),
        nicknames: col.array(col.text()),
        createdAt: col.timestamptz().onCreateNow(),
        createdBy: col.text().onCreateUser(),
        updatedAt: col.timestamptz().onUpdateNow(),
        updatedBy: col.uuid().onUpdateUser(),
        deletedAt: col.timestamptz(),
        tenantId: col.text().column("org"),
        profile: col.jsonb(json.object({
            bio: json.string(),
            checkedAt: json.date().onUpdateNow(),
            links: json.array(json.object({ url: json.string().required() })),
            blocks: json.oneOf({ quote: json.object({ by: json.string() }), text: json.string() })
        }))
    },
    relations: {
        team: rel.belongsTo(() => teams, { localKey: "team_ref" }),
        rivals: rel.manyToMany(() => players)
    },
    softDelete: true,
    tenant: { field: "tenantId", from: { claim: "org" } },
    rls: "admin-only"
});

const [, playersT] = compileTables([teams, players]);
const column = (key: string) => {
    const found = playersT.columns.find(c => c.key === key);
    if (!found) throw new Error(`no column ${key}`);
    return found;
};
const type = (key: string): ColumnType => column(key).type;

describe("column type predicates", () => {
    it("answers what the property kind used to be worked out from", () => {
        expect(isJsNumberType(type("rating"))).toBe(true);
        expect(isJsNumberType(type("goals"))).toBe(true);
        expect(isJsNumberType(type("name"))).toBe(false);
        expect(isIntegerFamilyType(type("goals"))).toBe(true);
        expect(isIntegerFamilyType(type("rating"))).toBe(false);
        expect(isSerialType({ kind: "bigserial" })).toBe(true);
        expect(isTimeOfDayType(type("kickoff"))).toBe(true);
        expect(isDateOnlyType(type("born"))).toBe(true);
        expect(isInstantType(type("createdAt"))).toBe(true);
        expect(isNativeArrayType(type("nicknames"))).toBe(true);
        expect(arrayElementType(type("nicknames"))).toEqual({ kind: "text" });
        expect(arrayElementType(type("name"))).toBeUndefined();
        expect(isEnumType(type("status"))).toBe(true);
        expect(isVectorType({ kind: "vector", dimensions: 3 })).toBe(true);
        expect(isByteaType({ kind: "bytea" })).toBe(true);
        expect(isGeopointColumn(column("location"))).toBe(true);
        expect(isGeopointColumn(column("profile"))).toBe(false);
    });

    it("searches text kinds with ILIKE, never an enum, a text `.oneOf()` or anything else", () => {
        expect(isIlikeSearchable(column("name"))).toBe(true);
        expect(isIlikeSearchable(column("createdBy"))).toBe(true);
        expect(isIlikeSearchable(column("status"))).toBe(false);
        expect(isIlikeSearchable(column("position"))).toBe(false);
        expect(isIlikeSearchable(column("id"))).toBe(false);
        expect(isIlikeSearchable(column("updatedBy"))).toBe(false);
        expect(isIlikeSearchable(column("goals"))).toBe(false);
    });
});

describe("stamps and defaults", () => {
    it("reads each stamp, and splits create stamps from update stamps", () => {
        expect(stampOf(column("createdAt"))).toEqual({ on: "create", value: "now" });
        expect(stampOf(column("updatedBy"))).toEqual({ on: "update", value: "user" });
        expect(stampOf(column("name"))).toBeUndefined();
        expect(createStampKeys(playersT)).toEqual(["createdAt", "createdBy"]);
        expect(updateStampKeys(playersT)).toEqual(["updatedAt", "updatedBy"]);
    });

    it("applies a literal default, and leaves the database's defaults to the database", () => {
        expect(defaultOnCreate(column("goals"))).toEqual({ value: 0 });
        expect(defaultOnCreate(column("id"))).toBeUndefined();
        expect(defaultOnCreate(column("region"))).toBeUndefined();
        expect(databaseOwnsDefault(column("region"))).toBe(true);
        expect(databaseOwnsDefault(column("goals"))).toBe(false);
    });
});

describe("relations", () => {
    it("finds a relation by its exact name", () => {
        expect(relationOf(playersT, "team")?.target).toBe("teams");
        expect(relationOf(playersT, "Team")).toBeUndefined();
    });

    it("finds the belongsTo of a foreign-key column by key or SQL name", () => {
        expect(belongsToForColumn(playersT, "team_ref")?.name).toBe("team");
        expect(belongsToForColumn(playersT, "teamRef")?.name).toBe("team");
        expect(belongsToForColumn(playersT, "name")).toBeUndefined();
    });

    it("lists the relations of one kind", () => {
        expect(relationsOfKind(playersT, "manyToMany").map(r => r.name)).toEqual(["rivals"]);
        expect(relationsOfKind(playersT, "belongsTo").map(r => r.localField)).toEqual(["teamRef"]);
    });
});

describe("table options", () => {
    it("reads the soft-delete column with both its names", () => {
        expect(softDeleteColumn(playersT)).toMatchObject({ key: "deletedAt", column: "deleted_at" });
        expect(softDeleteColumn(compileTables([teams])[0])).toBeUndefined();
        expect(isSoftDeleteRestore(playersT, { deletedAt: null })).toBe(true);
        expect(isSoftDeleteRestore(playersT, { name: "x" })).toBe(false);
    });

    it("reads tenancy with its bypass roles defaulted", () => {
        expect(tenantOf(playersT)).toEqual({ field: "tenantId", from: { claim: "org" }, bypassRoles: ["admin"] });
        expect(tenantOf(compileTables([teams])[0])).toBeUndefined();
    });
});

describe("walkJsonShape", () => {
    const shape = column("profile").json;
    if (!shape) throw new Error("profile has no shape");

    it("visits every position, root first, depth first in declaration order", () => {
        const seen: string[] = [];
        walkJsonShape(shape, ({ shape: node, path }) => { seen.push(`${formatJsonPath(path) || "<root>"}:${node.kind}`); });
        expect(seen).toEqual([
            "<root>:object",
            "bio:string",
            "checkedAt:date",
            "links:array",
            "links[]:object",
            "links[].url:string",
            "blocks:oneOf",
            "blocks.quote:object",
            "blocks.quote.by:string",
            "blocks.text:string"
        ]);
    });

    it("skips what lies below a position the visitor declines", () => {
        const seen: string[] = [];
        walkJsonShape(shape, ({ shape: node, path }) => {
            seen.push(formatJsonPath(path));
            return node.kind !== "array";
        });
        expect(seen).not.toContain("links[]");
        expect(seen).toContain("blocks.quote");
    });

    it("finds positions across a table's JSON columns", () => {
        const stamped = jsonPositions(playersT, (node: JsonShape) => node.kind === "date" && node.stamp !== undefined);
        expect(stamped.map(p => [p.column.key, p.path])).toEqual([["profile", [{ field: "checkedAt" }]]]);
    });
});

import { buildCollectionFromTableMetadata } from "../src/util/pg-column-to-property";
import type {
    BooleanProperty,
    DateProperty,
    MapProperty,
    NumberProperty,
    StringProperty,
    TableColumnInfo,
    TableMetadata
} from "@rebasepro/types";

/**
 * A column with a DEFAULT, imported from a table (the collection editor's
 * "create from table").
 *
 * `is_active boolean NOT NULL DEFAULT true` came back as a required boolean
 * with no default: the New form offered `false` and sent it, so the database's
 * `true` never applied, and the first push planned `DROP DEFAULT`. A literal
 * default is now the property's `defaultValue` — which the planner writes back
 * as the same DEFAULT, the form pre-fills, and the API counts as supplied.
 *
 * `required` is NOT relaxed: it is what keeps the planner's NOT NULL.
 */
const column = (
    name: string,
    data_type: string,
    udt_name: string,
    column_default: string | null,
    is_nullable = "NO",
    extra: Partial<TableColumnInfo> = {}
): TableColumnInfo => ({
    column_name: name,
    data_type,
    udt_name,
    is_nullable,
    column_default,
    character_maximum_length: null,
    ...extra
});

const props = buildCollectionFromTableMetadata("items", {
    columns: [
        column("id", "uuid", "uuid", "gen_random_uuid()"),
        column("is_active", "boolean", "bool", "true"),
        column("is_hidden", "boolean", "bool", "false", "YES"),
        column("stock", "integer", "int4", "0"),
        column("offset_by", "integer", "int4", "'-3'::integer"),
        column("penalty", "integer", "int4", "(-1)"),
        column("ratio", "numeric", "numeric", "'1.5'::numeric"),
        column("status", "character varying", "varchar", "'draft'::character varying"),
        column("motto", "text", "text", "'it''s fine'::text", "YES"),
        column("stage", "USER-DEFINED", "item_stage", "'open'::item_stage", "NO", { enum_values: ["open", "closed"] }),
        column("settings", "jsonb", "jsonb", "'{\"theme\": \"dark\"}'::jsonb"),
        column("published_at", "timestamp with time zone", "timestamptz", "now()"),
        column("seen_at", "timestamp with time zone", "timestamptz", "CURRENT_TIMESTAMP", "YES"),
        column("slug", "text", "text", "lower(md5((random())::text))"),
        column("title", "text", "text", null)
    ]
} as TableMetadata).properties;

describe("importing a column default", () => {
    it("carries a literal default as the property's defaultValue", () => {
        expect((props.isActive as BooleanProperty).defaultValue).toBe(true);
        expect((props.isHidden as BooleanProperty).defaultValue).toBe(false);
        expect((props.stock as NumberProperty).defaultValue).toBe(0);
        expect((props.offsetBy as NumberProperty).defaultValue).toBe(-3);
        expect((props.penalty as NumberProperty).defaultValue).toBe(-1);
        expect((props.ratio as NumberProperty).defaultValue).toBe(1.5);
        expect((props.status as StringProperty).defaultValue).toBe("draft");
        expect((props.motto as StringProperty).defaultValue).toBe("it's fine");
        expect((props.stage as StringProperty).defaultValue).toBe("open");
        expect((props.settings as MapProperty).defaultValue).toEqual({ theme: "dark" });
    });

    it("keeps a NOT NULL column required — it is the planner's NOT NULL", () => {
        expect((props.isActive as BooleanProperty).validation?.required).toBe(true);
        expect((props.status as StringProperty).validation?.required).toBe(true);
        expect((props.title as StringProperty).validation?.required).toBe(true);
        expect((props.motto as StringProperty).validation?.required).toBeUndefined();
    });

    it("reads a now() default as a create timestamp, which the planner writes back as now()", () => {
        expect((props.publishedAt as DateProperty).autoValue).toBe("on_create");
        expect((props.seenAt as DateProperty).autoValue).toBe("on_create");
        expect((props.publishedAt as DateProperty).defaultValue).toBeUndefined();
    });

    it("leaves an expression default, and a key's generator, to the database", () => {
        expect((props.slug as StringProperty).defaultValue).toBeUndefined();
        expect(props.id).not.toHaveProperty("defaultValue");
        expect(props.title).not.toHaveProperty("defaultValue");
    });

    it("does not offer an enum default that is not one of the enum's values", () => {
        const odd = buildCollectionFromTableMetadata("items", {
            columns: [column("stage", "USER-DEFINED", "item_stage", "'gone'::item_stage", "NO", { enum_values: ["open"] })]
        } as TableMetadata).properties;
        expect((odd.stage as StringProperty).defaultValue).toBeUndefined();
    });
});

/**
 * Two columns whose import changed them on the first push.
 */
describe("importing column shapes the planner must reproduce", () => {
    const shapes = buildCollectionFromTableMetadata("items", {
        columns: [
            column("note", "character varying", "varchar", null, "YES"),
            column("code", "character varying", "varchar", null, "YES", { character_maximum_length: 40 }),
            column("settings", "jsonb", "jsonb", null, "NO"),
            column("extra", "jsonb", "jsonb", null, "YES"),
            column("tags", "ARRAY", "_text", null, "NO")
        ]
    } as TableMetadata).properties;

    it("imports an unbounded varchar as unbounded, never VARCHAR(255)", () => {
        // `columnType: "varchar"` with no `max` plans VARCHAR(255): a narrowing
        // of a column that may already hold longer values. TEXT is the
        // unbounded string column the planner writes.
        expect((shapes.note as StringProperty).columnType).toBe("text");
        expect((shapes.note as StringProperty).validation?.max).toBeUndefined();
        // A declared width is still a varchar of that width.
        expect((shapes.code as StringProperty).columnType).toBe("varchar");
        expect((shapes.code as StringProperty).validation?.max).toBe(40);
    });

    it("keeps NOT NULL on a jsonb or array column", () => {
        expect((shapes.settings as MapProperty).validation?.required).toBe(true);
        expect((shapes.extra as MapProperty).validation).toBeUndefined();
        expect((shapes.tags as { validation?: { required?: boolean } }).validation?.required).toBe(true);
    });
});

